/* The harness itself, in real browsers: what ends a suite's page reaches the
   engine's report and leads its failure. Each case runs engines() on a
   suite that fails or ends a page on purpose and checks the reports
   engines() writes, the error it throws, what it prints and the screenshots
   it takes:
   - the suite fails on its own while its page is there: nothing leads the
     failure, and the screenshot is taken at once, not after the wait a
     failure that says its target is gone makes for a lost browser's news;
   - the suite's page crashes while the suite waits for it (Chromium, through
     a CDP session's Page.crash; Playwright has no way to crash a WebKit page,
     so there the suite passes, after Chromium's failure);
   - a page in a context the suite opened crashes and the suite carries on,
     which still fails it (in WebKit the suite closes that context itself,
     which is no news);
   - the suite's page, a tab it opens beside it and a page in a context it
     opened each throw an uncaught error and the suite carries on, which
     fails it with each error in the report, the other pages' with their
     URLs;
   - the browser goes away while the suite waits (Browser.close() called past
     the harness, which takes it for a lost browser);
   - the browser will not close, which the last two cases check in a process
     of their own, since what counts is how that process ends: its close never
     settles, with the browser left running or after it was closed past the
     harness. */
const assert = require("node:assert/strict");
const { ChildProcess, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const { serve, engines, main, selectedEngines, sleep } = require("./harness.cjs");

const CLOSED = "Target page, context or browser has been closed";
// The line watch() leads a failure with.
const said = (ended) => ended.map(({ event, seconds, url }) => `${event} ${seconds} s after launch${url ? ` (${url})` : ""}`).join("; ");

/* engines() on `suite`, with its reports in browser-artifacts/harness-<name>.json:
   what it threw, its reports by engine, what it printed through console.error
   and whether an engine's failure screenshot was taken. */
async function attempt(name, suite) {
  const file = `harness-${name}.json`, shot = (engine) => `browser-artifacts/${engine}-harness-${name}-failure.png`;
  for (const old of [`browser-artifacts/${file}`, ...selectedEngines().map(shot)]) fs.rmSync(old, { force: true });
  const printed = [], print = console.error;
  console.error = (...args) => printed.push(util.format(...args));
  let thrown = null;
  try { await engines(file, suite, { timeout: 30000 }); }
  catch (error) { thrown = error; }
  finally { console.error = print; }
  const reports = JSON.parse(fs.readFileSync(`browser-artifacts/${file}`, "utf8"));
  assert.deepEqual(reports.map((report) => report.browser), selectedEngines(), `${name}: every engine runs`);
  for (const report of reports) assert.deepEqual(report.cleanupErrors, [], `${name}: ${report.browser} closes`);
  return { thrown, printed, reports: Object.fromEntries(reports.map((report) => [report.browser, report])),
    shot: (engine) => fs.existsSync(shot(engine)) };
}

/* A failed engine whose failure `said` leads: in its report, in what
   engines() printed for it and, for the first engine to fail, in what it
   threw. */
function led(result, engine, first, rest) {
  const report = result.reports[engine], line = said(report.ended);
  assert.equal(report.status, "failed", engine);
  assert.ok(report.failure.startsWith(`${line}\n${rest}`), `${engine}: ${report.failure}`);
  assert.ok(result.printed.some((text) => text.startsWith(`${engine} ${line}\n${rest}`)), `${engine}: ${result.printed.join("\n")}`);
  if (first) assert.ok(result.thrown.message.startsWith(`${line}\n`), `${engine}: rethrown ${result.thrown.message}`);
  return report;
}

// What the harness says of a close it gave up on, in a report and on stderr.
const UNCLOSED = "browser: browser cleanup timed out";
// A run that has not ended after this long hangs. It takes a few seconds, and
// half a minute on a loaded machine.
const ENDS_WITHIN = 120000;

/* What the last two cases run, in a process of their own: a suite that makes
   the harness's close of each browser never settle, `open` with the browser
   left running, `behind` once the browser has been closed past the harness.
   The report keeps the processes this one has started by then. */
async function unclosableSuite(how, directory) {
  const server = await serve({ directory });
  try {
    await engines(`harness-unclosing-${how}.json`, async (page, report, name, browser) => {
      await page.goto(server.base);
      report.processes = process._getActiveHandles().filter((handle) => handle instanceof ChildProcess).map(({ pid }) => pid);
      if (how === "behind") await Object.getPrototypeOf(browser).close.call(browser);
      browser.close = () => new Promise(() => {});
    }, { closeLimit: 1000 });
  } finally { await server.close(); }
}

// Whether a process runs. A zombie has ended: a container's first process
// may never collect it.
function running(pid) {
  try { return process.platform === "linux" ? !fs.readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ") : process.kill(pid, 0); }
  catch { return false; }
}

/* Runs unclosableSuite() in a process of its own and checks how that run
   ended: by itself, with exit code 1, a report for every engine and nothing
   it started left running. */
async function unclosableRun(how, directory, selected) {
  const file = `browser-artifacts/harness-unclosing-${how}.json`, started = Date.now();
  fs.rmSync(file, { force: true });
  const { code, killed, stderr } = await new Promise((resolve) => execFile(process.execPath, [__filename, how, directory], { timeout: ENDS_WITHIN },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, killed: error?.killed ?? false, stderr })));
  assert.equal(killed, false, `${how}: the run did not end by itself within ${ENDS_WITHIN} ms: ${stderr}`);
  assert.equal(code, 1, `${how}: ${stderr}`);
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const reports = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(reports.map((report) => report.browser), selected, `${how}: every engine runs`);
  for (const report of reports) {
    const engine = report.browser;
    assert.deepEqual(report.cleanupErrors, [UNCLOSED], engine);
    assert.ok(stderr.includes(`${engine}: ${UNCLOSED}`), `${engine}: ${stderr}`);
    assert.equal(report.status, "failed", engine);
    // A browser gone before the close is the suite's failure, which stays first.
    const failure = how === "open" ? `Error: ${engine}: ${UNCLOSED}`
      : `${said(report.ended)}\nAssertionError [ERR_ASSERTION]: ${engine}: a page crashed or closed, or the browser disconnected`;
    assert.ok(report.failure.startsWith(failure), `${engine}: ${report.failure}`);
  }
  // The server and every browser, the first engine's too.
  const processes = reports.at(-1).processes;
  assert.ok(processes.length >= 2, `${how}: ${processes}`);
  for (const stop = Date.now() + 10000; processes.some(running) && Date.now() < stop;) await sleep(100);
  assert.deepEqual(processes.filter(running), [], `${how}: nothing the run started is left running`);
  return { exit: code, seconds, cleanupErrors: reports.map(({ browser, cleanupErrors }) => `${browser}: ${cleanupErrors}`) };
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-harness-"));
  fs.writeFileSync(path.join(directory, "index.html"), "<!doctype html><title>Harness</title><p>A page to end.");
  const server = await serve({ directory });
  const base = server.base, selected = selectedEngines(), outcome = {};
  try {
    // A wrapper on the page's screenshot() notes when engines() takes it.
    const ordinary = await attempt("ordinary", async (page, report) => {
      await page.goto(base);
      const screenshot = page.screenshot.bind(page);
      page.screenshot = (...args) => { report.screenshotAfter = Date.now() - report.failedAt; return screenshot(...args); };
      report.failedAt = Date.now();
      throw new Error("expected 3 clues");
    });
    assert.equal(ordinary.thrown?.message, "expected 3 clues");
    for (const engine of selected) {
      const report = ordinary.reports[engine];
      assert.equal(report.status, "failed", engine);
      assert.deepEqual(report.ended, [], engine);
      assert.ok(report.failure.startsWith("Error: expected 3 clues\n"), `${engine}: ${report.failure}`);
      assert.ok(ordinary.printed.some((text) => text.startsWith(`${engine} Error: expected 3 clues\n`)), `${engine}: ${ordinary.printed.join("\n")}`);
      // At once is a few milliseconds; the wait would be a second.
      assert.ok(report.screenshotAfter < 500, `${engine}: screenshot ${report.screenshotAfter} ms after the failure`);
      assert.equal(ordinary.shot(engine), true, `${engine}: the page that is still there gets its screenshot`);
      outcome[`ordinary (${engine})`] = { screenshotAfter: report.screenshotAfter };
    }

    const crash = await attempt("crash", async (page, report, name) => {
      await page.goto(base);
      if (name !== "chromium") return;
      const waiting = page.waitForFunction(() => false);
      (await page.context().newCDPSession(page)).send("Page.crash").catch(() => {});
      await waiting;
    });
    if (selected.includes("chromium")) {
      const report = led(crash, "chromium", true, "page.waitForFunction: Target crashed");
      assert.deepEqual(report.ended.map(({ event, url }) => ({ event, url })), [{ event: "page crashed", url: base }]);
      assert.equal(crash.shot("chromium"), false, "no screenshot of a crashed page");
      outcome.crash = report.ended;
    } else assert.equal(crash.thrown, null);
    if (selected.includes("webkit")) {
      assert.equal(crash.reports.webkit.status, "passed", "WebKit runs after Chromium's failure");
      assert.deepEqual(crash.reports.webkit.ended, []);
    }

    // The other page is in a context of the suite's own, as the paired
    // recognition suites' baseline pages are.
    const carried = await attempt("carried-on", async (page, report, name, browser) => {
      await page.goto(base);
      const other = await (await browser.newContext()).newPage();
      await other.goto(`${base}?other`);
      if (name === "chromium") {
        const crashed = other.waitForEvent("crash", { timeout: 30000 });
        (await other.context().newCDPSession(other)).send("Page.crash").catch(() => {});
        await crashed;
        report.other = await other.evaluate(() => "alive").catch((error) => error.message);
      } else await other.context().close();
      report.carriedOn = true;
    });
    if (selected.includes("chromium")) {
      const report = led(carried, "chromium", true, "AssertionError [ERR_ASSERTION]: chromium: a page crashed or closed, or the browser disconnected");
      assert.equal(report.carriedOn, true);
      assert.deepEqual(report.ended.map(({ event, url }) => ({ event, url })), [{ event: "page crashed", url: `${base}?other` }]);
      assert.equal(carried.shot("chromium"), true, "the suite's own page is still there: its screenshot");
      outcome.carriedOn = report.ended;
    }
    if (selected.includes("webkit")) {
      const report = carried.reports.webkit;
      assert.equal(report.status, "passed", "a context the suite closes itself is no news");
      assert.deepEqual(report.ended, []);
      assert.equal(carried.shot("webkit"), false);
    }

    // The tab is in the suite's context, as structural_capture's second tab
    // is, and the other page in a context the suite opens, as the paired
    // suites' baseline pages are.
    const thrown = await attempt("page-errors", async (page, report, name, browser) => {
      await page.goto(base);
      const tab = await page.context().newPage(), other = await (await browser.newContext()).newPage();
      await tab.goto(`${base}?tab`);
      await other.goto(`${base}?other`);
      for (const [target, where] of [[page, "page"], [tab, "tab"], [other, "other page"]]) {
        const heard = target.waitForEvent("pageerror", { timeout: 30000 });
        await target.evaluate((where) => { setTimeout(() => { throw new Error(`thrown in the ${where}`); }); }, where);
        await heard;
      }
      report.carriedOn = true;
    });
    assert.ok(thrown.thrown?.message.startsWith(`${selected[0]}: uncaught page errors`), String(thrown.thrown));
    for (const engine of selected) {
      const report = thrown.reports[engine];
      assert.equal(report.status, "failed", engine);
      assert.equal(report.carriedOn, true, engine);
      assert.deepEqual(report.errors, ["thrown in the page", `thrown in the tab (${base}?tab)`,
        `thrown in the other page (${base}?other)`], engine);
      assert.deepEqual(report.ended, [], engine);
      assert.ok(report.failure.startsWith(`AssertionError [ERR_ASSERTION]: ${engine}: uncaught page errors`), `${engine}: ${report.failure}`);
      assert.equal(thrown.shot(engine), true, `${engine}: the suite's page is still there: its screenshot`);
      outcome[`page errors (${engine})`] = { errors: report.errors };
    }

    const lost = await attempt("lost", async (page, report, name, browser) => {
      await page.goto(base);
      const waiting = page.waitForFunction(() => false);
      Object.getPrototypeOf(browser).close.call(browser).catch(() => {});
      await waiting;
    });
    for (const engine of selected) {
      const report = led(lost, engine, engine === selected[0], `page.waitForFunction: ${CLOSED}`);
      assert.deepEqual(report.ended.map(({ event }) => event).sort(), ["browser disconnected", "context closed", "page closed"]);
      assert.equal(report.ended.find(({ event }) => event === "page closed").url, base);
      assert.equal(lost.shot(engine), false, "no screenshot without a browser");
      outcome[`lost (${engine})`] = report.ended;
    }

    for (const how of ["open", "behind"]) outcome[`will not close (${how})`] = await unclosableRun(how, directory, selected);
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  fs.writeFileSync("browser-artifacts/harness.json", JSON.stringify(outcome, null, 2) + "\n");
  for (const [name, record] of Object.entries(outcome))
    console.log(Array.isArray(record) ? `${name}: led by ${said(record)}`
      : record.errors ? `${name}: failed on ${record.errors.join("; ")}`
      : record.cleanupErrors ? `${name}: ended by itself in ${record.seconds} s with exit code ${record.exit}: ${record.cleanupErrors.join("; ")}`
      : `${name}: led by nothing, screenshot ${record.screenshotAfter} ms after the failure`);
}

// With arguments, this is the process of unclosableSuite().
const [how, directory] = process.argv.slice(2);
main(module, how ? () => unclosableSuite(how, directory) : run);
