/* What every browser suite otherwise repeats: a server for the built site,
   the two mobile engines, one report per engine, a screenshot on failure and
   the exit code. */
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, webkit } = require("playwright");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The phone the suites emulate. The service worker is blocked so a test sees
// the server, not a cache, unless a suite asks for it.
const PHONE = Object.freeze({
  serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
});
const SMALL_PHONE = Object.freeze({ ...PHONE, viewport: { width: 390, height: 844 } });

// A directory link that needs no privilege on Windows.
const link = (target, at) => fs.symlinkSync(path.resolve(target), at, process.platform === "win32" ? "junction" : "dir");

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
  const base = origin + prefix;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(2000) })).ok) return { origin, base, close };
    } catch {}
    await sleep(100);
  }
  await close();
  throw Error(`${base} did not answer`);
}

/* A temporary directory holding the built site twice: `candidate` is the
   site as built, `baseline` a copy in which `files` (under web/) come from
   `commit`, so a suite can compare the scanner with the one before a change
   in the same browser with the same fonts and runtimes. */
function baselineSite(commit, files) {
  const build = JSON.parse(fs.readFileSync("_site/build-info.json")).build,
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-baseline-"));
  fs.cpSync("_site", path.join(directory, "baseline"), { recursive: true });
  link("_site", path.join(directory, "candidate"));
  for (const file of files)
    fs.writeFileSync(path.join(directory, "baseline", file),
      execFileSync("git", ["show", `${commit}:web/${file}`], { encoding: "utf8" })
        .replaceAll("__BUILD_ID__", build).replaceAll("./vendor/", `./vendor/${build}/`));
  return { directory, remove: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

/* Runs `suite(page, report, name, browser)` in Chromium and WebKit, each on
   a fresh context, and writes the reports to `file` (under browser-artifacts
   unless it names a directory) after each engine. A page error fails the
   engine, a failing engine gets a screenshot, and both engines run before the
   first failure is rethrown. `report` starts as { browser, version, errors };
   the suite adds what it measures. */
async function engines(file, suite, { context = PHONE, timeout = 20000, screenshot = path.basename(file, ".json") } = {}) {
  const out = file.includes("/") ? file : `browser-artifacts/${file}`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync("browser-artifacts", { recursive: true });
  const reports = [], failures = [];
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    const report = { browser: name, version: browser.version(), errors: [] };
    reports.push(report);
    let page;
    try {
      page = await (await browser.newContext(context)).newPage();
      page.setDefaultTimeout(timeout);
      page.on("pageerror", (error) => report.errors.push(error.message));
      await suite(page, report, name, browser);
      assert.deepEqual(report.errors, [], `${name}: uncaught page errors`);
      report.status = "passed";
    } catch (error) {
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

module.exports = { PHONE, SMALL_PHONE, serve, baselineSite, engines, main, sleep };
