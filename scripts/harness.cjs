/* What every browser suite otherwise repeats: a server for the built site,
   the two mobile engines, one report per engine, a screenshot on failure, a
   close that cannot wait for ever, temporary directories that go as the
   process exits, on a signal too, and the exit code. */
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { exitIfUnclosed, watch } = require("./watch.cjs");

/* The engines a run covers: BROWSER_ENGINES, a comma- or space-separated
   subset of chromium and webkit ("webkit" alone in CI's per-engine jobs), or
   both when it is unset or empty. An unknown name stops the run instead of
   silently testing nothing. */
const ENGINES = ["chromium", "webkit"];
function selectedEngines(value = process.env.BROWSER_ENGINES) {
  const names = String(value ?? "").split(/[\s,]+/).filter(Boolean);
  if (!names.length) return [...ENGINES];
  const unknown = names.filter((name) => !ENGINES.includes(name));
  if (unknown.length) throw new Error(`BROWSER_ENGINES names no engine ${unknown.join(", ")}; use ${ENGINES.join(" and/or ")}`);
  return ENGINES.filter((name) => names.includes(name));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Whether a process runs. A zombie has ended: a container's first process
// may never collect it.
function running(pid) {
  try { return process.platform === "linux" ? !fs.readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ") : process.kill(pid, 0); }
  catch { return false; }
}

// The phone the suites emulate. The service worker is blocked so a test sees
// the server, not a cache, unless a suite asks for it.
const PHONE = Object.freeze({
  serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
});
const SMALL_PHONE = Object.freeze({ ...PHONE, viewport: { width: 390, height: 844 } });

// A directory link that needs no privilege on Windows.
const link = (target, at) => fs.symlinkSync(path.resolve(target), at, process.platform === "win32" ? "junction" : "dir");

/* What to clean up as the process exits, at its end or on a signal. On Linux
   and macOS a child outlives a Node process that crashes, so a static server
   would keep its port and the directory it serves (on Windows, libuv's job
   object already ends it with Node); and a suite that ends mid-run, on a
   signal or a failure outside its try, must not leave its temporary
   directories (temporaryDirectory(), below) in the system temp. The exit
   event runs only synchronous code: kill() signals at once, and the
   directories go after the servers that may serve them. A server can still
   be ending as its directory goes: on Windows a file it was serving stays
   open until it has ended, and the removal tries again five times, each
   after a wait 100 ms longer than the last, before it throws; on Linux and
   macOS a directory in use goes all the same, and the server only reads from
   it. A process killed outright (SIGKILL, or TerminateProcess on Windows)
   runs none of this. */
const servers = new Set(), temporary = new Set();
const removeTemporary = () => { for (const d of temporary) { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); temporary.delete(d); } };
process.once("exit", () => {
  for (const server of servers) server.kill();
  removeTemporary();
});
/* A signal ends a suite's process through process.exit(), with 128 and the
   signal's number, so that what listens for the exit runs: the clean-up
   above, and Playwright's, which kills every browser it launched. A signal
   nothing listens for ends the process at once instead, with neither run:
   SIGBREAK, Ctrl+Break, which only Windows raises, has no other listener,
   and Playwright listens for SIGHUP, a terminal that goes away or on Windows
   a console window that closes, only while a browser is up, and then closes
   it under the running suite, which fails on a lost browser and starts the
   next engine. Playwright's handlers, on in every suite's launch, never act
   now: these are added first, as a suite loads the harness, and end the
   process in the same emit. Node lets every platform listen for SIGBREAK,
   but os.constants.signals names it (21) only on Windows, hence the codes
   written out. */
for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143], ["SIGBREAK", 149]])
  process.once(signal, () => process.exit(code));

/* Python's http.server serving `directory` on a port the system picks, or on
   `port` for a suite that stops and restarts its origin. `pages: true` serves
   the site under /GridPuzzle/ through the _preview link, as GitHub Pages does.
   Resolves to { origin, base, close } once it answers; close() resolves when
   the server has exited. Until then the server holds the process for ever, so
   a suite does what can fail before this call or after close(), which goes in
   the finally of the try that follows this call. */
async function serve({ directory = "_site", pages = false, port = 0 } = {}) {
  let prefix = "/";
  if (pages) {
    fs.mkdirSync("_preview", { recursive: true });
    if (!fs.existsSync("_preview/GridPuzzle")) link(directory, "_preview/GridPuzzle");
    directory = "_preview";
    prefix = "/GridPuzzle/";
  }
  const server = spawn("python", ["-u", "-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", directory],
    { stdio: ["ignore", "pipe", "ignore"] });
  servers.add(server);
  server.once("exit", () => servers.delete(server));
  const close = () => new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    server.once("exit", resolve);
    server.kill();
  });
  const origin = await new Promise((resolve, reject) => {
    let out = "";
    const listen = (chunk) => {
      out += chunk;
      const port = /port (\d+)/.exec(out);
      if (!port) return;
      server.stdout.off("data", listen);
      server.stdout.resume();
      resolve(`http://127.0.0.1:${port[1]}`);
    };
    server.stdout.on("data", listen);
    server.on("error", reject);
    server.on("exit", (code) => reject(Error(`The static server exited with ${code} before it served anything`)));
  });
  const base = origin + prefix, deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      // HEAD: a response body left unread makes Node 24 assert when the
      // timeout signal fires, and the check only needs the status.
      if ((await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(2000) })).ok) return { origin, base, close };
    } catch {}
    await sleep(100);
  }
  await close();
  throw Error(`${base} did not answer within a minute`);
}

/* A folder of a suite's own under the system temp, its name starting with
   `prefix`: { directory, remove }. The harness removes it as the process
   exits, on a signal too, after it has stopped its servers (above), so that
   a suite can serve it. remove(), for the suite's own finally, removes it
   there and forgets it; a removal that fails leaves it to the process's exit,
   which tries again. */
function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.add(directory);
  return { directory, remove: () => { fs.rmSync(directory, { recursive: true, force: true }); temporary.delete(directory); } };
}

/* A temporary directory (temporaryDirectory()) holding the built site twice:
   `candidate` is the site as built, `baseline` a copy in which `files` (under
   web/) come from `commit`, so a suite can compare the scanner with the one
   before a change in the same browser with the same fonts and runtimes. */
function baselineSite(commit, files) {
  const build = JSON.parse(fs.readFileSync("_site/build-info.json")).build,
    site = temporaryDirectory("gridpuzzle-baseline-"), { directory } = site;
  fs.cpSync("_site", path.join(directory, "baseline"), { recursive: true });
  link("_site", path.join(directory, "candidate"));
  for (const file of files)
    fs.writeFileSync(path.join(directory, "baseline", file),
      execFileSync("git", ["show", `${commit}:web/${file}`], { encoding: "utf8" })
        .replaceAll("__BUILD_ID__", build).replaceAll("./vendor/", `./vendor/${build}/`));
  return site;
}

/* Runs `suite(page, report, name, browser)` in Chromium and WebKit (or the
   engines BROWSER_ENGINES selects), each on a fresh context, and writes the
   reports to `file` (under browser-artifacts unless it names a directory)
   after each engine. A page error fails the engine, on the suite's page or
   on any other page it opens in the engine's browser, and so does anything
   else watch() records, which also leads the failure; a failing engine gets
   a screenshot, and every engine runs before the first failure is rethrown.
   A close that rejects or runs past watch.cjs's CLOSE_LIMIT (or `closeLimit`
   ms) adds its failure to the report's cleanupErrors and fails the engine if
   nothing else did; a suite's failure stays first, and the report is written
   and the next engine run all the same. `report` starts as
   { browser, version, errors, ended, cleanupErrors } (the first two lists as
   watch() records them, for the browser and every context and page the suite
   opens on it); the suite adds what it measures. */
async function engines(file, suite, { context = PHONE, timeout = 20000, screenshot = path.basename(file, ".json"), closeLimit } = {}) {
  const selected = selectedEngines();
  // Loaded here, not at the top, so the engine selection can be tested
  // without Playwright installed.
  const playwright = require("playwright");
  const out = file.includes("/") ? file : `browser-artifacts/${file}`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync("browser-artifacts", { recursive: true });
  const reports = [], failures = [];
  for (const name of selected) {
    const browser = await playwright[name].launch({ headless: true });
    const watched = watch(browser, { closeLimit });
    const report = { browser: name, version: browser.version(), errors: watched.errors, ended: watched.ended,
      cleanupErrors: watched.cleanupErrors };
    reports.push(report);
    console.log(`${name} ${report.version}`);
    let page;
    try {
      page = await (await browser.newContext(context)).newPage();
      page.setDefaultTimeout(timeout);
      await suite(page, report, name, browser);
      assert.deepEqual(report.errors, [], `${name}: uncaught page errors`);
      watched.check(name);
      report.status = "passed";
    } catch (thrown) {
      const error = await watched.lead(thrown);
      report.status = "failed";
      report.failure = error.stack;
      failures.push(error);
      console.error(name, error);
      if (page) await page.screenshot({ path: `browser-artifacts/${name}-${screenshot}-failure.png`, fullPage: true }).catch(() => {});
    } finally {
      const unclosed = await watched.close(name);
      if (unclosed && report.status === "passed") {
        report.status = "failed";
        report.failure = unclosed.stack;
        failures.push(unclosed);
      }
      fs.writeFileSync(out, JSON.stringify(reports, null, 2) + "\n");
    }
  }
  if (failures.length) throw failures[0];
  return reports;
}

/* A suite's entry point: run it when the file is the main module, print the
   failure and set the exit code. The process then ends by itself, once what
   the suite started has stopped, unless a browser would not close:
   exitIfUnclosed() ends it then. */
function main(module_, run) {
  if (require.main === module_)
    run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => exitIfUnclosed(module_));
}

/* The camera the page's getUserMedia hands out, so a suite can test the app's
   camera wiring without CI camera hardware. Runs in the page. It creates
   navigator.mediaDevices where the browser has none (WebKit on Windows).
   `answer` is "denied" (the permission is refused), "tracks" (a stream whose
   tracks count stop() calls in window.__camera.stopped) or "canvas" (a 12 fps
   capture of the canvas at window.__cameraCanvas, kept in
   window.__camera.stream). window.__camera.restore() puts everything back. */
function installCamera(answer) {
  const installed = !navigator.mediaDevices;
  if (installed) Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
  const media = navigator.mediaDevices, original = Object.getOwnPropertyDescriptor(media, "getUserMedia");
  const camera = window.__camera = { stopped: 0, stream: null };
  const answers = {
    denied: async () => { throw new DOMException("Denied in acceptance test", "NotAllowedError"); },
    tracks: async () => ({ getTracks: () => [{ stop() { camera.stopped++; } }] }),
    canvas: async () => (camera.stream = window.__cameraCanvas.captureStream(12)),
  };
  Object.defineProperty(media, "getUserMedia", { configurable: true, value: answers[answer] });
  camera.restore = () => {
    if (original) Object.defineProperty(media, "getUserMedia", original);
    else delete media.getUserMedia;
    if (installed) delete navigator.mediaDevices;
    delete window.__camera;
  };
}
const stubCamera = (page, answer) => page.evaluate(installCamera, answer);

module.exports = { PHONE, SMALL_PHONE, serve, baselineSite, engines, exitIfUnclosed, main, running, sleep, stubCamera, selectedEngines, temporaryDirectory, watch };
