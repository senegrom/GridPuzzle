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
   - the browser goes away while the suite waits (Browser.close() called past
     the harness, which takes it for a lost browser). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const util = require("node:util");
const { serve, engines, main, selectedEngines } = require("./harness.cjs");

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
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  fs.writeFileSync("browser-artifacts/harness.json", JSON.stringify(outcome, null, 2) + "\n");
  for (const [name, record] of Object.entries(outcome))
    console.log(Array.isArray(record) ? `${name}: led by ${said(record)}`
      : `${name}: led by nothing, screenshot ${record.screenshotAfter} ms after the failure`);
}

main(module, run);
