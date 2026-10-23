/* What every browser suite otherwise repeats: a server for the built site,
   the two mobile engines, one report per engine, a screenshot on failure and
   the exit code. */
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

// The phone the suites emulate. The service worker is blocked so a test sees
// the server, not a cache, unless a suite asks for it.
const PHONE = Object.freeze({
  serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
});
const SMALL_PHONE = Object.freeze({ ...PHONE, viewport: { width: 390, height: 844 } });

// A directory link that needs no privilege on Windows.
const link = (target, at) => fs.symlinkSync(path.resolve(target), at, process.platform === "win32" ? "junction" : "dir");

/* What to clean up however the process ends. On Linux and macOS a child
   outlives a Node process that crashes, so a static server would keep its
   port and the directory it serves (on Windows, libuv's job object already
   ends it with Node); and a suite killed mid-run must not leave a copy of
   the built site in the system temp. The exit event runs only synchronous
   code: kill() signals at once, and the directories go after the servers
   that hold them. */
const servers = new Set(), temporary = new Set();
const removeTemporary = () => { for (const d of temporary) { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); temporary.delete(d); } };
process.once("exit", () => {
  for (const server of servers) server.kill();
  removeTemporary();
});
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]])
  process.once(signal, () => process.exit(code));

/* Python's http.server serving `directory` on a port the system picks, or on
   `port` for a suite that stops and restarts its origin. `pages: true` serves
   the site under /GridPuzzle/ through the _preview link, as GitHub Pages does.
   Resolves to { origin, base, close } once it answers; close() resolves when
   the server has exited. */
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

/* A temporary directory holding the built site twice: `candidate` is the
   site as built, `baseline` a copy in which `files` (under web/) come from
   `commit`, so a suite can compare the scanner with the one before a change
   in the same browser with the same fonts and runtimes. */
function baselineSite(commit, files) {
  const build = JSON.parse(fs.readFileSync("_site/build-info.json")).build,
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-baseline-"));
  temporary.add(directory);
  fs.cpSync("_site", path.join(directory, "baseline"), { recursive: true });
  link("_site", path.join(directory, "candidate"));
  for (const file of files)
    fs.writeFileSync(path.join(directory, "baseline", file),
      execFileSync("git", ["show", `${commit}:web/${file}`], { encoding: "utf8" })
        .replaceAll("__BUILD_ID__", build).replaceAll("./vendor/", `./vendor/${build}/`));
  return { directory, remove: () => { fs.rmSync(directory, { recursive: true, force: true }); temporary.delete(directory); } };
}

/* Watches `browser`, the contexts it has and opens and their pages for what
   ends a suite's pages without the suite asking: a page that crashes, a
   page or context that closes without a close() call on it, its context or
   the browser, and the browser's disconnection without browser.close().
   Called as the browser is launched, it adds each to `ended` as
   { event, seconds, url }: "page crashed", "page closed", "context closed"
   or "browser disconnected", the seconds since launch, and a page's URL.
   Playwright gives a crash no reason, only the page, and the call a crash
   interrupts fails with "Target crashed" in Chromium but in WebKit with
   "Target page, context or browser has been closed", as a lost browser's
   calls do. close() on each watched object notes the call first, so that
   what the suite or its owner closes is no news; after browser.close()
   nothing is recorded. check(name) fails when anything ended, and
   lead(error) puts what ended at the head of a failure's message and
   stack, once a lost browser's news is in when the failure says that its
   target is gone. */
// Playwright's word that the target of a call is gone: a lost browser's
// calls and a crashed WebKit page's fail with the first, a crashed Chromium
// page's with the second, and calls on a page as it crashes with the third.
const GONE = /Target page, context or browser has been closed|Target crashed|Page crashed/;
function watch(browser, { grace = 1000 } = {}) {
  const started = Date.now(), ended = [], asked = new WeakSet();
  const unasked = (...targets) => !targets.some((target) => asked.has(target));
  const note = (event, page) => ended.push({ event, seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(page && { url: page.url() }) });
  const ask = (target) => {
    const close = target.close;
    target.close = (...args) => { asked.add(target); return close.apply(target, args); };
  };
  const watchPage = (page) => {
    ask(page);
    page.on("crash", () => { if (unasked(browser)) note("page crashed", page); });
    page.on("close", () => { if (unasked(page, page.context(), browser)) note("page closed", page); });
  };
  const watchContext = (context) => {
    ask(context);
    context.pages().forEach(watchPage);
    context.on("page", watchPage);
    context.on("close", () => { if (unasked(context, browser)) note("context closed"); });
  };
  ask(browser);
  browser.contexts().forEach(watchContext);
  browser.on("context", watchContext);
  browser.on("disconnected", () => { if (unasked(browser)) note("browser disconnected"); });
  // Playwright can fail the call a lost browser interrupted before it reports
  // the closes behind it (WebKit: the page's close 2 ms and the disconnection
  // 25 ms after the call failed), so a failure that says its target is gone
  // waits for them: until the browser has disconnected, for at most `grace`
  // ms. Any other failure is led at once, so that the screenshot and what a
  // suite captures after it show the page as the failure left it.
  const settled = () => new Promise((resolve) => {
    if (!browser.isConnected()) return resolve();
    const done = () => { clearTimeout(timer); browser.off("disconnected", done); resolve(); };
    const timer = setTimeout(done, grace);
    browser.on("disconnected", done);
  });
  return {
    ended,
    check(name) { assert.deepEqual(ended, [], `${name}: a page crashed or closed, or the browser disconnected`); },
    async lead(error) {
      if (GONE.test(String(error?.message ?? error))) await settled();
      if (!ended.length) return error;
      if (!(error instanceof Error)) error = new Error(String(error));
      const line = ended.map(({ event, seconds, url }) => `${event} ${seconds} s after launch${url ? ` (${url})` : ""}`).join("; ");
      error.stack = `${line}\n${error.stack}`;
      error.message = `${line}\n${error.message}`;
      return error;
    },
  };
}

/* Runs `suite(page, report, name, browser)` in Chromium and WebKit (or the
   engines BROWSER_ENGINES selects), each on a fresh context, and writes the
   reports to `file` (under browser-artifacts unless it names a directory)
   after each engine. A page error fails the engine, and so does anything
   watch() records, which also leads the failure; a failing engine gets a
   screenshot, and every engine runs before the first failure is rethrown.
   `report` starts as { browser, version, errors, ended } (ended as watch()
   records it, for the browser and every context and page the suite opens
   on it); the suite adds what it measures. */
async function engines(file, suite, { context = PHONE, timeout = 20000, screenshot = path.basename(file, ".json") } = {}) {
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
    const watched = watch(browser);
    const report = { browser: name, version: browser.version(), errors: [], ended: watched.ended };
    reports.push(report);
    console.log(`${name} ${report.version}`);
    let page;
    try {
      page = await (await browser.newContext(context)).newPage();
      page.setDefaultTimeout(timeout);
      page.on("pageerror", (error) => report.errors.push(error.message));
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
      await browser.close();
      fs.writeFileSync(out, JSON.stringify(reports, null, 2) + "\n");
    }
  }
  if (failures.length) throw failures[0];
  return reports;
}

/* A suite's entry point: run it when the file is the main module, print the
   failure and set the exit code. */
function main(module_, run) {
  if (require.main === module_) run().catch((error) => { console.error(error); process.exitCode = 1; });
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

module.exports = { PHONE, SMALL_PHONE, serve, baselineSite, engines, main, sleep, stubCamera, selectedEngines, watch };
