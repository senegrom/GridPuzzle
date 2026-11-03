import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Browser } from './playwright-stand-ins.js';

// A browser that will not close: what watch()'s close() records and says,
// and how a suite's process ends after it, with stand-ins for the browser
// (harness_regressions checks both on real browsers); a suite's run, and the
// stale-build check's, on a browser that will not open its context or page;
// photo_read's two checks on a context that will not close; what else can
// leave a server up to hold a run, as a browser does; browser_smoke,
// ocr_latency and harness_regressions on a context of their own that will not
// close; and how a signal ends a suite's process. Loading watch.cjs or the
// harness needs no Playwright.
const { CLOSE_LIMIT, cleanUp, watch } = createRequire(import.meta.url)('../../scripts/watch.cjs');
const harness = fileURLToPath(new URL('../../scripts/harness.cjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise(setImmediate);
const timers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

// What `act` resolves to and what it prints through console.error.
async function printing(act) {
  const lines = [], { error: print } = console;
  console.error = (...args) => lines.push(util.format(...args));
  try { return { result: await act(), lines }; } finally { console.error = print; }
}

test('the limit is half a minute', () => assert.equal(CLOSE_LIMIT, 30000));

test('a close that settles records and prints nothing, and leaves no timer behind', async () => {
  const browser = new Browser(), watched = watch(browser), before = timers();
  const { result, lines } = await printing(() => watched.close('chromium'));
  assert.equal(result, null);
  assert.equal(timers(), before, 'a timer left behind would hold every run up by the limit');
  assert.equal(browser.isConnected(), false, 'the browser was closed');
  assert.deepEqual([watched.cleanupErrors, lines], [[], []]);
});

test('a close that rejects is recorded, printed and handed back for the suite to fail with', async () => {
  const browser = new Browser();
  browser.close = async () => { throw new Error('the pipe broke'); };
  const watched = watch(browser), before = timers();
  const { result, lines } = await printing(() => watched.close('webkit'));
  assert.equal(timers(), before);
  assert.ok(result instanceof Error);
  assert.equal(result.message, 'webkit: browser: the pipe broke');
  assert.deepEqual(watched.cleanupErrors, ['browser: the pipe broke']);
  assert.deepEqual(lines, ['webkit: browser: the pipe broke']);
});

test('a close that never settles is given up on at the limit, and recorded as the corpus reports do', async () => {
  const browser = new Browser();
  browser.close = () => new Promise(() => {});
  const watched = watch(browser, { closeLimit: 30 }), started = Date.now();
  const { result, lines } = await printing(() => watched.close('chromium'));
  assert.ok(Date.now() - started >= 25, 'it waits for the limit');
  assert.equal(result.message, 'chromium: browser: browser cleanup timed out');
  assert.deepEqual(watched.cleanupErrors, ['browser: browser cleanup timed out']);
  assert.deepEqual(lines, ['chromium: browser: browser cleanup timed out']);
});

test('a close waits for the limit unless told otherwise, as every suite\'s does', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const browser = new Browser();
  browser.close = () => new Promise(() => {});
  let closed;
  printing(() => watch(browser).close('chromium')).then(({ result }) => { closed = result; });
  t.mock.timers.tick(CLOSE_LIMIT - 1); await tick();
  assert.equal(closed, undefined, 'the limit has not passed');
  t.mock.timers.tick(1); await tick();
  assert.equal(closed?.message, 'chromium: browser: browser cleanup timed out');
});

test('what a close does after the limit changes nothing: a late rejection is lost, not unhandled', async () => {
  const browser = new Browser();
  browser.close = () => new Promise((resolve, reject) => setTimeout(reject, 40, new Error('too late')));
  const watched = watch(browser, { closeLimit: 5 });
  await printing(() => watched.close('chromium'));
  await sleep(60); // node:test fails a test on an unhandled rejection.
  assert.deepEqual(watched.cleanupErrors, ['browser: browser cleanup timed out']);
});

test('a clean-up that throws at once is its failure, whatever it throws', async () => {
  assert.equal(await cleanUp('server', () => { throw new Error('no such process'); }, 1000), 'server: no such process');
  assert.equal(await cleanUp('server', () => Promise.reject('refused'), 1000), 'server: refused');
  assert.equal(await cleanUp('server', () => 'done', 1000), undefined);
});

test('a signal cuts what is left of a clean-up\'s wait to the short limit, and one that came first leaves it no more than that', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = () => new Promise(() => {}), controller = new AbortController(), short = { signal: controller.signal, shortLimit: 100 };
  let during, after;
  cleanUp('browser', stuck, 1000, short).then((failed) => { during = failed; });
  t.mock.timers.tick(500); await tick();
  controller.abort();
  t.mock.timers.tick(99); await tick();
  assert.equal(during, undefined, 'the short limit has not passed');
  t.mock.timers.tick(1); await tick();
  assert.equal(during, 'browser: browser cleanup timed out');
  cleanUp('browser', stuck, 1000, short).then((failed) => { after = failed; });
  t.mock.timers.tick(99); await tick();
  assert.equal(after, undefined, 'the short limit has not passed');
  t.mock.timers.tick(1); await tick();
  assert.equal(after, 'browser: browser cleanup timed out');
});

test('a signal never lengthens a clean-up\'s wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let failed;
  cleanUp('browser', () => new Promise(() => {}), 1000, { signal: controller.signal, shortLimit: 100 }).then((result) => { failed = result; });
  t.mock.timers.tick(950); await tick();
  controller.abort();
  t.mock.timers.tick(50); await tick();
  assert.equal(failed, 'browser: browser cleanup timed out');
});

test('a clean-up that settled, or that a signal cut short, leaves no timer behind, and a later signal starts none', async () => {
  const controller = new AbortController(), short = { signal: controller.signal, shortLimit: 5 }, before = timers();
  assert.equal(await cleanUp('browser', () => 'done', 1000, short), undefined);
  controller.abort();
  assert.equal(timers(), before, 'a timer left behind would hold the process up');
  assert.equal(await cleanUp('browser', () => new Promise(() => {}), 1000, short), 'browser: browser cleanup timed out');
  assert.equal(timers(), before, 'a timer left behind would hold the process up');
  assert.equal(await cleanUp('browser', () => 'done', 1000, short), undefined);
  assert.equal(timers(), before, 'a timer left behind would hold the process up');
});

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-close-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// How a process ends that runs `script`: its exit code, or the signal that
// ended it, whether the bound had to end it, and what it printed. These runs
// take a second or so. The bound allows for a host short of memory, where one
// at Idle priority was still silent after 30 s. `script` can be an array, with
// what Node takes before it.
const finish = (script, options) => new Promise((resolve) => execFile(process.execPath, [script].flat(), { timeout: 45000, ...options },
  (error, stdout, stderr) => resolve({ code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false, stdout, stderr })));

/* How a process ends that runs `scripts` (name to source), the first as its
   main module, in a temporary directory. */
function ending(t, scripts) {
  const directory = temporary(t);
  for (const [name, source] of Object.entries(scripts)) fs.writeFileSync(path.join(directory, name), PRELUDE + source);
  return finish(path.join(directory, Object.keys(scripts)[0]));
}
// `unclosable` is a browser that will not close, `closable` one that does;
// `pipes` keeps the process alive, as a live browser's pipes do; the last
// line says that what listens for the process's exit still ran.
const PRELUDE = `const { exitIfUnclosed, main, watch } = require(${JSON.stringify(harness)});
const stub = (close) => ({ contexts: () => [], on() {}, close });
const unclosable = watch(stub(() => new Promise(() => {})), { closeLimit: 5 }), closable = watch(stub(async () => {}));
if (require.main === module) { var pipes = setInterval(() => {}, 1000); process.on("exit", (code) => console.log("exit handlers ran with", code)); }
`;

test('a run whose browser would not close ends with its failure, after its reports and with the exit handlers run', async (t) => {
  const { code, killed, stdout, stderr } = await ending(t, { 'suite.cjs': `
    main(module, async () => { const unclosed = await unclosable.close("chromium"); console.log("reports written"); throw unclosed; });` });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 1);
  assert.match(stdout, /reports written\s+exit handlers ran with 1/);
  assert.match(stderr, /^chromium: browser: browser cleanup timed out$/m);
  assert.match(stderr, /^Error: chromium: browser: browser cleanup timed out$/m);
});

test('a close that rejects ends the run as one that never settles does', async (t) => {
  const { code, killed, stdout, stderr } = await ending(t, { 'suite.cjs': `
    const rejecting = watch(stub(async () => { throw new Error("the pipe broke"); }));
    main(module, async () => { await rejecting.close("chromium"); });` });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 1);
  assert.match(stdout, /exit handlers ran with 1/);
  assert.match(stderr, /^chromium: browser: the pipe broke$/m);
});

test('such a run exits non-zero even when the suite makes nothing of the failure', async (t) => {
  const { code, killed, stdout } = await ending(t, { 'suite.cjs': `
    main(module, async () => { await unclosable.close("chromium"); });` });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 1);
  assert.match(stdout, /exit handlers ran with 1/);
});

test('a failed suite keeps its exit code, also when its browser would not close', async (t) => {
  const { code, killed } = await ending(t, { 'suite.cjs': `
    main(module, async () => { process.exitCode = 7; await unclosable.close("chromium"); });` });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 7);
});

test('a suite that ends through exitIfUnclosed itself, as those with browsers of their own do, ends the same way', async (t) => {
  const { code, killed, stdout } = await ending(t, { 'suite.cjs': `
    (async () => { await unclosable.close("chromium"); process.exitCode = 1; })().finally(() => exitIfUnclosed(module));` });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 1);
  assert.match(stdout, /exit handlers ran with 1/);
});

test('a run whose browsers closed is not cut short: what it left to do still runs, whether it passed or failed', async (t) => {
  for (const [end, expected] of [['', 0], ['throw new Error("expected 3 clues");', 1]]) {
    const { code, killed, stdout } = await ending(t, { 'suite.cjs': `
      main(module, async () => {
        await closable.close("chromium");
        setTimeout(() => { console.log("what was left to do"); clearInterval(pipes); }, 50);
        ${end}
      });` });
    assert.equal(killed, false, 'it ended by itself');
    assert.equal(code, expected);
    assert.match(stdout, /what was left to do\s+exit handlers ran with/);
  }
});

test('a runner that calls a suite\'s run() or requires it keeps its process after a browser that would not close', async (t) => {
  const { code, killed, stdout } = await ending(t, {
    'runner.cjs': `
      const suite = require(__dirname + "/suite.cjs"), own = require(__dirname + "/own.cjs");
      (async () => {
        await suite.run().catch((error) => console.log("the runner heard:", error.message));
        await own.ended;
        console.log("the runner goes on");
        clearInterval(pipes);
      })();`,
    'suite.cjs': `
      async function run() { throw await unclosable.close("chromium"); }
      module.exports = { run };
      main(module, run);`,
    'own.cjs': `
      module.exports = { ended: (async () => { await unclosable.close("webkit"); })().finally(() => exitIfUnclosed(module)) };`,
  });
  assert.equal(killed, false, 'it ended by itself');
  assert.equal(code, 0);
  assert.match(stdout, /the runner heard: chromium: browser: browser cleanup timed out\s+the runner goes on\s+exit handlers ran with 0/);
});

// What browser_smoke's static server is on the stand-in below, with serve()
// running as it is on the port this prints: the suite's own port is fixed, so
// another run on a shared host can hold it, and the pull-request job that runs
// these tests sets up no Python. It runs in this process's temporary directory,
// outside any one run's tree and TEMP, which go after the run: a suite that gave
// up on a browser exits without waiting for its server, and Windows will not
// remove a live process's working directory.
const SERVER = `require("node:http").createServer((request, response) => response.end())
  .listen(0, "127.0.0.1", function () { console.log("port", this.address().port); });`;

// A spawn that starts that server and says what it was to serve, for a process
// that loads this before the harness, which takes spawn as it loads.
const SPAWN = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => {
  console.log("serving", args.at(-1));
  return spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { ...options, cwd: ${JSON.stringify(os.tmpdir())} });
};
`;

// Playwright for the suites with browsers of their own, which load it by name
// before the harness, so that the harness takes that spawn: every page fails
// at once, sending first what browser_smoke listens for, and answers evaluate()
// with what it was asked. Chromium's browser will not close, and each launch
// keeps the process alive until its browser closes, as a live browser's pipes
// do, and says what is on disk by then. With NO_BROWSER, no launch works. With
// REFUSE, that call (newContext or newPage) rejects in Chromium, whose browser
// stays up and closes.
const PLAYWRIGHT = `${SPAWN}const fs = require("node:fs");
const { NO_BROWSER, REFUSE, REPORT } = process.env;
const engine = (name, close) => ({ async launch() {
  if (NO_BROWSER) throw new Error("no browser here");
  const pipes = setInterval(() => {}, 1000), heard = {}, on = (event, listener) => { heard[event] = listener; };
  fs.writeFileSync(name + "-found.json", fs.existsSync(REPORT) ? fs.readFileSync(REPORT) : "[]");
  const opening = (call) => { if (name === "chromium" && call === REFUSE) throw new Error(call + " refused"); };
  const page = { on, setDefaultTimeout() {},
    goto: async () => {
      heard.console?.({ type: () => "error", text: () => "Content Security Policy: refused", location: () => ({ url: "", lineNumber: 0 }) });
      heard.request?.({ url: () => "http://elsewhere/" });
      throw new Error("no site here");
    },
    evaluate: async (read) => String(read),
    screenshot: async ({ path }) => fs.writeFileSync(path, ""),
    locator: () => ({ innerText: async () => "what the page said" }) };
  return { contexts: () => [], on() {}, version: () => "1.0", close: async () => { await close(); clearInterval(pipes); },
    newContext: async () => { opening("newContext"); return { on, newPage: async () => { opening("newPage"); return page; } }; } };
} });
module.exports = { chromium: engine("chromium", async () => { if (!REFUSE) throw new Error("the pipe broke"); }), webkit: engine("webkit", async () => {}) };
`;
const SUITES = {
  solver_update: { script: 'scripts/solver_update_regressions.cjs', report: 'browser-artifacts/solver-update-regressions.json', reads: ['web/sw.js', 'web/offline.js'] },
  browser_smoke: { script: 'scripts/browser_smoke.cjs', report: 'browser-artifacts/results.json', reads: [] },
};

// How a suite ends on that stand-in, in a tree of its own, and what its files
// in that tree hold: `reports` as written, `onDisk` what the tests compare.
// `prepare` gets that tree before the run.
async function suiteRun(t, suite, env, prepare) {
  const { script, report, reads } = SUITES[suite], directory = temporary(t), inTree = (name) => path.join(directory, name);
  for (const file of [script, 'scripts/harness.cjs', 'scripts/watch.cjs', ...reads])
    fs.cpSync(new URL(`../../${file}`, import.meta.url), inTree(file));
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), PLAYWRIGHT);
  fs.mkdirSync(inTree('_site')); // What serve() links for browser_smoke.
  prepare?.(directory);
  const ended = await finish(inTree(script), { cwd: directory, env: { ...process.env, REPORT: report, ...env } });
  const reports = (name = report) => JSON.parse(fs.readFileSync(inTree(name), 'utf8'));
  const onDisk = (name) => reports(name).map(({ browser, ok, cleanupErrors, failure }) =>
    ({ browser, ok, cleanupErrors, failure: failure?.split('\n')[0] }));
  return { ...ended, reports, onDisk, exists: (name) => fs.existsSync(inTree(name)) };
}

const failed = (browser, cleanupErrors, failure = 'Error: no site here') => ({ browser, ok: false, cleanupErrors, failure });

// Side by side: each has a tree, a port and a process of its own, they are most
// of this file's time, and in Node 22 --test-timeout limits a whole file.
describe('the suites with browsers of their own, on that stand-in', { concurrency: true }, () => {
  for (const [suite, { report }] of Object.entries(SUITES)) {
    test(`${suite} has an engine's report on disk before the next one starts, and ends with both after a browser that would not close`, async (t) => {
      const { code, killed, stderr, onDisk } = await suiteRun(t, suite);
      assert.equal(killed, false, `it ended by itself: ${stderr}`);
      assert.equal(code, 1, stderr);
      assert.deepEqual(onDisk('chromium-found.json'), []);
      assert.deepEqual(onDisk('webkit-found.json'), [failed('chromium', ['browser: the pipe broke'])], 'what a hang in WebKit would leave');
      assert.deepEqual(onDisk(report), [failed('chromium', ['browser: the pipe broke']), failed('webkit', [])]);
    });

    // The browser closes when asked here, so exitIfUnclosed() plays no part: a
    // browser left up holds the process to the bound, as a real one for ever.
    for (const call of ['newContext', 'newPage'])
      test(`${suite} fails an engine whose ${call}() rejects as any other failure: its browser closes, the next engine runs and the run ends by itself`, async (t) => {
        const { code, killed, stderr, onDisk } = await suiteRun(t, suite, { REFUSE: call });
        assert.equal(killed, false, `it ended by itself: ${stderr}`);
        assert.equal(code, 1, stderr);
        assert.match(stderr, new RegExp(`^chromium Error: ${call} refused`, 'm'));
        const refused = failed('chromium', [], `Error: ${call} refused`);
        assert.deepEqual(onDisk('webkit-found.json'), [refused], 'on disk before the next engine starts');
        assert.deepEqual(onDisk(report), [refused, failed('webkit', [])]);
      });
  }

  test('solver_update reads a failed engine\'s page, and has nothing to read in an engine with no page', async (t) => {
    const { killed, stderr, reports } = await suiteRun(t, 'solver_update', { REFUSE: 'newPage' });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    const [chromium, webkit] = reports();
    assert.deepEqual([chromium.results, chromium.workerDebug, chromium.requests], [undefined, undefined, []]);
    assert.deepEqual([webkit.results, webkit.workerDebug, webkit.requests],
      ['() => window.results', '() => window.workerDebug', []]);
  });

  test('browser_smoke keeps what its listeners heard before the first navigation and captures a failed page, and has nothing to capture in an engine with no page', async (t) => {
    const { killed, stderr, reports, exists } = await suiteRun(t, 'browser_smoke', { REFUSE: 'newPage' });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    const [chromium, webkit] = reports();
    assert.deepEqual([chromium.errors, chromium.external, chromium.checks], [[], [], []]);
    assert.deepEqual([chromium.status, chromium.state], [undefined, undefined]);
    assert.equal(exists('browser-artifacts/chromium-failure.png'), false);
    assert.deepEqual([webkit.errors, webkit.external], [['Content Security Policy: refused'], ['http://elsewhere/']]);
    assert.equal(webkit.status, 'what the page said');
    assert.match(webkit.state, /window\.__gridpuzzleTestState\(\)/);
    assert.equal(exists('browser-artifacts/webkit-failure.png'), true);
  });

  test('solver_update still writes its report when it reaches no engine', async (t) => {
    const { code, killed, stderr, onDisk } = await suiteRun(t, 'solver_update', { NO_BROWSER: '1' });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /no browser here/);
    assert.deepEqual(onDisk(SUITES.solver_update.report), []);
  });

  // It saves before it stops its server, so that server is still up here: what
  // ends the process is the failure itself, an unhandled rejection.
  test('solver_update ends by itself when it cannot write its report', async (t) => {
    const { code, killed, stderr } = await suiteRun(t, 'solver_update', { NO_BROWSER: '1' }, noReports);
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /EEXIST.*browser-artifacts/);
  });

  test('browser_smoke reaches no engine and ends by itself all the same: no browser is up, and it stops its server', async (t) => {
    const { code, killed, stderr, exists } = await suiteRun(t, 'browser_smoke', { NO_BROWSER: '1' });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /no browser here/);
    assert.equal(exists(SUITES.browser_smoke.report), false, 'it writes its reports after each engine');
  });
});

// What the process of either check below runs first. photo_read's two checks
// wait CLOSE_LIMIT for their context to close, as engines() waits for the
// browser. A test cannot wait that long, so a timer of that length lasts a
// tenth of a second here, as corpus-command-stand-in.cjs's `limits` make the
// corpus commands' timers shorter. Nothing else either check runs sets a timer
// of that length, so the process counts those timers too: one when the check
// gave its context's close CLOSE_LIMIT, none when it had no context to close.
// A close given any other limit fails on that count, even one short enough to
// run out for real inside the test's bound. Each check gets a report with the
// engine's name and an empty cleanupErrors, as engines() starts it, and its
// process prints that list last, with the count. A close that rejects or never
// settles is the check's failure only when the check has none of its own, and
// goes in cleanupErrors and on stderr either way.
const CHECK_PROCESS = `const { CLOSE_LIMIT } = require(${JSON.stringify(fileURLToPath(new URL('../../scripts/watch.cjs', import.meta.url)))});
const { setTimeout: later } = globalThis;
let limits = 0;
globalThis.setTimeout = (run, ms, ...args) => { if (ms === CLOSE_LIMIT) limits++; return later(run, ms === CLOSE_LIMIT ? 100 : ms, ...args); };
const report = { browser: "chromium", cleanupErrors: [] }, reported = () => console.log("cleanupErrors", JSON.stringify(report.cleanupErrors), "limits", limits);
`;
const TIMED_OUT = 'context: context cleanup timed out';
// Checks the last line a check's process printed: its report's cleanupErrors,
// each of which was printed on stderr after the engine's name, and how many
// timers of CLOSE_LIMIT's length it set.
function cleanupErrorsIn(printed, stderr, cleanupErrors, limits = 1) {
  assert.equal(printed, `cleanupErrors ${JSON.stringify(cleanupErrors)} limits ${limits}`);
  for (const failed of cleanupErrors) assert.ok(stderr.split(/\r?\n/).includes(`chromium: ${failed}`), stderr);
}

// The stale-build check inside photo_read runs on its engine's browser, which
// closes whatever the check does, but it serves the site itself, and a server
// left listening holds the process for ever as a browser left up does. Here
// nothing else holds it. `REFUSE` is as above, and a page it opens plays the
// app through both deploys, so that the check passes: the browser's look for an
// update after the reload, the downloads and reads after each deploy, and the
// update. With LAST_FAILS the read after the update, the check's last step,
// does not read the puzzle. With CLOSE_FAILS the context's close rejects, as it
// does when it is the first call to meet a lost browser, and with NEVER_SETTLES
// it never settles, as it does while a WebKit child still holds the browser's
// pipes. They go side by side: a process held runs to the bound.
const STALE_CHECK = `${CHECK_PROCESS}const { staleBuild } = require(${JSON.stringify(fileURLToPath(new URL('../../scripts/stale_build_checks.cjs', import.meta.url)))});
const { REFUSE, CLOSE_FAILS, NEVER_SETTLES, LAST_FAILS } = process.env, opening = (call) => { if (call === REFUSE) throw new Error(call + " refused"); };
const advice = "An updated version of the app is ready. Use “Update app & reload”, then";
const offline = ["Could not download vendor/x/tesseract/tesseract.min.js. Stay online and retry.",
  "Some of this version’s files are no longer on the server. " + advice + " download for offline use again.",
  "Offline assets are ready on this device."];
const reads = [{ status: "status error", text: "Recognition could not load. " + advice + " try again.", clues: 0 },
  { status: "status", text: "Puzzle read.", clues: 81 }, { status: "status", text: LAST_FAILS ? "Puzzle not read." : "Puzzle read.", clues: 81 }];
let base, build = "x";
const page = { setDefaultTimeout() {}, goto: async (url) => { base = url; }, reload: async () => { await fetch(base + "sw.js", { method: "HEAD" }); },
  waitForSelector: async () => {}, waitForFunction: async () => ({ jsonValue: async () => ({ text: "Grid found." }) }),
  waitForNavigation: async () => { build = "feedbeef0002"; }, click: async () => {}, setInputFiles: async () => {},
  isHidden: async () => true, locator: () => ({ evaluate: async () => {} }), textContent: async () => offline.shift(),
  evaluate: async (read) => {
    const source = String(read);
    if (source.includes("getRegistration")) return { waiting: true, installing: false, stored: true, banner: true };
    if (source.includes("build-label")) return build;
    if (source.includes("puzzle.cells")) return reads.shift();
    return source.includes("__staleTab === true") || undefined;
  } };
const browser = { newContext: async () => {
  opening("newContext");
  return { newPage: async () => { opening("newPage"); return page; },
    close: async () => {
      console.log("context closed");
      if (CLOSE_FAILS) throw new Error("the browser has gone");
      if (NEVER_SETTLES) return new Promise(() => {});
    } };
} };
staleBuild(browser, report).then(() => console.log("the check passed"),
  (error) => { console.log("the check failed:", error.code ?? error.message); process.exitCode = 1; }).finally(reported);
`;

describe('the stale-build check, on a browser that will not open its context or page, or close its context', { concurrency: true }, () => {
  for (const [what, env, expected, said, cleanupErrors = []] of [
    ['newContext() rejects', { REFUSE: 'newContext' }, 1, ['the check failed: newContext refused']],
    ['newPage() rejects', { REFUSE: 'newPage' }, 1, ['context closed', 'the check failed: newPage refused']],
    ['newPage() rejects and its context will not close either', { REFUSE: 'newPage', CLOSE_FAILS: '1' }, 1,
      ['context closed', 'the check failed: newPage refused'], ['context: the browser has gone']],
    ['newPage() rejects and its context never closes', { REFUSE: 'newPage', NEVER_SETTLES: '1' }, 1,
      ['context closed', 'the check failed: newPage refused'], [TIMED_OUT]],
    ['it passes', {}, 0, ['context closed', 'the check passed']],
    ['it passes and its context will not close', { CLOSE_FAILS: '1' }, 1,
      ['context closed', 'the check failed: context: the browser has gone'], ['context: the browser has gone']],
    ['it passes and its context never closes', { NEVER_SETTLES: '1' }, 1, ['context closed', `the check failed: ${TIMED_OUT}`], [TIMED_OUT]],
    // An assertion's message has a diff on lines of its own: its code is printed.
    ['its last read fails and its context will not close either', { LAST_FAILS: '1', CLOSE_FAILS: '1' }, 1,
      ['context closed', 'the check failed: ERR_ASSERTION'], ['context: the browser has gone']],
  ])
    test(`stops its server when ${what}, so that the process ends by itself`, async (t) => {
      const directory = temporary(t), check = path.join(directory, 'check.cjs');
      fs.mkdirSync(path.join(directory, '_site'));
      fs.writeFileSync(path.join(directory, '_site', 'build-info.json'), '{ "build": "x" }');
      fs.writeFileSync(path.join(directory, '_site', 'assets.json'), '{ "assets": [] }');
      // The newspaper photo the check reads, as it resolves it from where it runs.
      fs.mkdirSync(path.join(directory, 'Examples', 'BrowserScanner', 'Newspaper'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'Examples', 'BrowserScanner', 'Newspaper', '2026-09-07-sudoku.webp'), '');
      fs.writeFileSync(check, STALE_CHECK);
      const { code, killed, stdout, stderr } = await finish(check, { cwd: directory, env: { ...process.env, ...env } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, expected, stderr);
      const lines = stdout.trim().split('\n');
      // With no context, the check has nothing to close and waits for nothing.
      cleanupErrorsIn(lines.pop(), stderr, cleanupErrors, env.REFUSE === 'newContext' ? 0 : 1);
      assert.deepEqual(lines, said);
    });
});

const script = (name) => fileURLToPath(new URL(`../../scripts/${name}.cjs`, import.meta.url));

// The offline-install check inside photo_read serves a folder of its own from
// Python, the server the harness starts: here, the stand-in. Its page answers
// all the check asks, unless PAGE_FAILS, which fails its first step, or
// LAST_FAILS, which loses the saved puzzle its last step looks for; with
// CLOSE_FAILS its context's close rejects, as it does when it is the first
// call to meet a lost browser, with NEVER_SETTLES it never settles, as it does
// while a WebKit child still holds the browser's pipes, and with RM_FAILS its
// folder will not go. That close says whether the folder is still there, which
// it should be: the page closes on its site.
const OFFLINE_CHECK = `${SPAWN}${CHECK_PROCESS}const { offlineInstall } = require(${JSON.stringify(script('import_safety_checks'))});
const fs = require("node:fs"), os = require("node:os"), { PAGE_FAILS, CLOSE_FAILS, NEVER_SETTLES, RM_FAILS, LAST_FAILS } = process.env;
if (RM_FAILS) fs.rmSync = () => { throw new Error("the folder is in use"); };
const page = { setDefaultTimeout() {}, goto: async () => { if (PAGE_FAILS) throw new Error("no site here"); },
  waitForFunction: async () => {}, waitForNavigation: async () => {}, click: async () => {}, textContent: async () => "failed",
  locator: () => ({ isEnabled: async () => true }),
  evaluate: async (run) => LAST_FAILS && String(run).includes("getItem") ? null : "unchanged saved puzzle" };
const browser = { newContext: async () => ({ newPage: async () => page, close: async () => {
  console.log("context closed", fs.readdirSync(os.tmpdir()).some((name) => name.startsWith("gridpuzzle-install-")) ? "on its site" : "after its site went");
  if (CLOSE_FAILS) throw new Error("the browser has gone");
  if (NEVER_SETTLES) return new Promise(() => {});
} }) };
offlineInstall(browser, report).then(() => console.log("the check passed"),
  (error) => { console.log("the check failed:", error.code ?? error.message); process.exitCode = 1; }).finally(reported);
`;

// Where a process makes its temporary folders: in the test's own, so that one
// left behind can be seen, and goes with it.
const temporaryIn = (directory) => ({ TEMP: directory, TMP: directory, TMPDIR: directory });
const left = (directory) => fs.readdirSync(directory).filter((name) => name.startsWith('gridpuzzle-'));

// How a process ends that runs the script `name` as it is, in `directory`, with
// the stand-in for Python's server.
function scripted(name, directory, env) {
  const preload = path.join(directory, 'spawn.cjs');
  fs.writeFileSync(preload, SPAWN);
  return finish(['-r', preload, script(name)], { cwd: directory, env: { ...process.env, ...temporaryIn(directory), ...env } });
}

// A file where a suite's reports go: nothing can be written there.
function noReports(directory) { fs.writeFileSync(path.join(directory, 'browser-artifacts'), ''); }

// The fixtures external_replay wants before it starts anything, as it pins them.
function pinnedFixtures(directory) {
  const source = fs.readFileSync(script('external_replay_regressions'), 'utf8');
  fs.mkdirSync(path.join(directory, 'live-fixtures'));
  fs.writeFileSync(path.join(directory, 'live-fixtures', 'fixtures.json'), JSON.stringify({
    revision: /ACQUISITION_REVISION='(\w+)'/.exec(source)[1],
    fixtures: [{ name: 'another' }, ...[...source.matchAll(/'(images\/[^']+)':'(\w+)'/g)].map(([, name, sha256]) => ({ name, sha256 }))],
  }));
}

// ocr_latency in a process of its own: its server is Node's, in that process,
// and it reads its fixtures from the repository as it loads. No browser starts.
const OCR_LATENCY = `const refused = { launch: async () => { throw new Error("no browser here"); } };
require(${JSON.stringify(script('ocr_latency_regressions'))})({ playwright: { chromium: refused, webkit: refused }, port: 0, out: process.env.OUT })
  .catch((error) => { console.log("the run failed:", error.code ?? error.message); process.exitCode = 1; });
`;

// A server left up holds its process for ever, as a browser does, and two
// failures leave one up: one between its start and the try whose finally stops
// it, and one ahead of the stop in that finally. Nothing else holds these runs.
// They go side by side: one that does not end runs to the bound.
describe('what a run started does not outlive its failure', { concurrency: true }, () => {
  // Its folder goes unless that is what failed. Then the server must be down
  // already, so the stop comes first. Before the server starts there is no stop
  // to make, and the failure stays the check's own. A check that fails at its
  // first step or at its last keeps its own failure when its close fails too.
  for (const [what, env, expected, said, cleanupErrors = []] of [
    ['its context will not close', { CLOSE_FAILS: '1' }, 1, 'the check failed: context: the browser has gone', ['context: the browser has gone']],
    ['its context never closes', { NEVER_SETTLES: '1' }, 1, `the check failed: ${TIMED_OUT}`, [TIMED_OUT]],
    ['its page fails and its context will not close either', { PAGE_FAILS: '1', CLOSE_FAILS: '1' }, 1, 'the check failed: no site here',
      ['context: the browser has gone']],
    ['its page fails and its context never closes either', { PAGE_FAILS: '1', NEVER_SETTLES: '1' }, 1, 'the check failed: no site here', [TIMED_OUT]],
    ['its last step fails and its context will not close either', { LAST_FAILS: '1', CLOSE_FAILS: '1' }, 1, 'the check failed: ERR_ASSERTION',
      ['context: the browser has gone']],
    ['its page fails', { PAGE_FAILS: '1' }, 1, 'the check failed: no site here'],
    ['all goes well', {}, 0, 'the check passed'],
    ['its folder will not go', { RM_FAILS: '1' }, 1, 'the check failed: the folder is in use'],
    ['it fails before its server starts', { NO_SITE: '1' }, 1, 'the check failed: ENOENT'],
  ])
    test(`the offline-install check ends by itself when ${what}`, async (t) => {
      const directory = temporary(t), check = path.join(directory, 'check.cjs');
      fs.mkdirSync(path.join(directory, '_site'));
      if (!env.NO_SITE) fs.writeFileSync(path.join(directory, '_site', 'offline.js'), '');
      fs.writeFileSync(check, OFFLINE_CHECK);
      const { code, killed, stdout, stderr } = await finish(check, { cwd: directory, env: { ...process.env, ...temporaryIn(directory), ...env } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, expected, stderr);
      const lines = stdout.trim().split('\n');
      if (!env.NO_SITE) assert.ok(lines.shift().startsWith(`serving ${path.join(directory, 'gridpuzzle-install-')}`), stdout);
      cleanupErrorsIn(lines.pop(), stderr, cleanupErrors);
      assert.deepEqual(lines, ['context closed on its site', said]);
      if (!env.RM_FAILS) assert.deepEqual(left(directory), [], 'its temporary folder is gone');
    });

  test('harness_regressions stops at an engine it does not know, with nothing started', async (t) => {
    const directory = temporary(t);
    const { code, killed, stdout, stderr } = await scripted('harness_regressions', directory, { BROWSER_ENGINES: 'safari' });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /BROWSER_ENGINES names no engine safari; use chromium and\/or webkit/);
    assert.equal(stdout, '', 'no server');
    assert.deepEqual(left(directory), [], 'no temporary folder');
  });

  for (const [name, fixture] of [['ocr_quality', /ENOENT.*ground-truth\.json/], ['external_replay', /ENOENT.*fixtures\.json/]])
    test(`${name} stops at a fixture it cannot read, with nothing started`, async (t) => {
      const { code, killed, stdout, stderr } = await scripted(`${name}_regressions`, temporary(t));
      assert.equal(killed, false, `it ended by itself: ${stderr}`);
      assert.equal(code, 1, stderr);
      assert.match(stderr, fixture);
      assert.equal(stdout, '', 'no server');
    });

  for (const [name, prepare] of [['live_recovery', () => {}], ['external_replay', pinnedFixtures]])
    test(`${name} stops its server when it cannot write its report`, async (t) => {
      const directory = temporary(t);
      noReports(directory);
      prepare(directory);
      const { code, killed, stdout, stderr } = await scripted(`${name}_regressions`, directory);
      assert.equal(killed, false, `it ended by itself: ${stderr}`);
      assert.equal(code, 1, stderr);
      assert.match(stderr, /EEXIST.*browser-artifacts/);
      assert.match(stdout, /^serving _site$/m, 'it had started its server');
    });

  for (const [what, out, failure, engines = ''] of [
    ['stops at a folder for its report it cannot make', (directory) => { noReports(directory); return 'browser-artifacts/ocr-latency.json'; }, 'EEXIST'],
    ['stops its server when it cannot write its report', (directory) => { fs.mkdirSync(path.join(directory, 'report')); return 'report'; }, 'EISDIR'],
    ['stops at an engine it does not know', () => 'ocr-latency.json', 'BROWSER_ENGINES names no engine safari; use chromium and/or webkit', 'safari'],
  ])
    test(`ocr_latency ${what}`, async (t) => {
      const directory = temporary(t), run = path.join(directory, 'run.cjs');
      fs.writeFileSync(run, OCR_LATENCY);
      const { code, killed, stdout, stderr } = await finish(run, { cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { ...process.env, BROWSER_ENGINES: engines, OUT: path.join(directory, out(directory)) } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      assert.equal(stdout.trim(), `the run failed: ${failure}`);
    });
});

// The other closes of a context that a suite awaits itself: browser_smoke's
// startup-cancellation check, each of ocr_latency's variants and
// harness_regressions' WebKit "carried-on" case. Each suite runs as it is, in a
// process of its own, on a stand-in for Playwright whose browsers each keep
// that process alive until they close, as a live browser's pipes do, so that a
// close that holds the suite holds its process to the test's bound; nothing
// else holds it. Each process loads LIMITS first: the stand-in for Python's
// server, and its timers of CLOSE_LIMIT's length last a tenth of a second, as
// in the checks' processes above, and are counted, the count printed as the
// process exits. Each engine's browser close sets such a timer too, so the
// count is one for each browser and one for each context close given
// CLOSE_LIMIT, with any other wait of that length a suite makes, and a close
// given any other limit fails on it.
const LIMITS = `${SPAWN}const { setTimeout: later } = globalThis;
let limits = 0;
globalThis.setTimeout = (run, ms, ...args) => { if (ms === ${CLOSE_LIMIT}) limits++; return later(run, ms === ${CLOSE_LIMIT} ? 100 : ms, ...args); };
process.on("exit", () => console.log("limits", limits));
`;
const GONE_BY = 'context: the browser has gone';

// What a process printed on stdout before its last line, and the count of its
// timers of CLOSE_LIMIT's length that line gives (null without it).
function counted(stdout) {
  const lines = stdout.trim().split(/\r?\n/), count = /^limits (\d+)$/.exec(lines.at(-1));
  return { lines: count ? lines.slice(0, -1) : lines, limits: count ? Number(count[1]) : null };
}

// How `script` ends, run as it is with LIMITS loaded first in a tree of its
// own, which is its working and temporary directory, with `playwright` for
// Playwright; `read` gives a report it wrote there, `left` its folders left.
async function standIn(t, script, playwright, env) {
  const directory = temporary(t), inTree = (name) => path.join(directory, name);
  for (const file of [script, 'scripts/harness.cjs', 'scripts/watch.cjs'])
    fs.cpSync(new URL(`../../${file}`, import.meta.url), inTree(file));
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), playwright);
  fs.mkdirSync(inTree('_site'));
  fs.writeFileSync(inTree('limits.cjs'), LIMITS);
  const ended = await finish(['-r', inTree('limits.cjs'), inTree(script)],
    { cwd: directory, env: { ...process.env, ...temporaryIn(directory), ...env } });
  return { ...ended, ...counted(ended.stdout), read: (name) => JSON.parse(fs.readFileSync(inTree(name), 'utf8')),
    left: () => left(directory) };
}

const stderrLines = (stderr) => stderr.split(/\r?\n/);

// What browser_smoke's Python solves its example to, and the two checks the
// startup-cancellation check adds to the engine's report, after the camera's.
const SMOKE_SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const SMOKE_CHECKS = ['invalid scan box settings rejected before OCR and persistence',
  'cancel during actual OCR language initialization; workers stop; fresh scan succeeds'];

// Playwright for browser_smoke, on which its run reaches its startup-
// cancellation check in Chromium, while WebKit's page fails at once.
// Chromium's first page plays the app through every step before the check,
// and the check's page through the check: each answers what the suite reads
// by the source of what it evaluates, and a "#read-photo" with the check's
// route on asks for OCR's language. Once the check has asked for its context's
// close, the first page plays no more, so the run goes no further than the
// check here.
// CHECK_FAILS fails the check's first step ("first") or its last ("last": the
// fresh scan reads no clue). CLOSE is how the check's context closes:
// "rejects", as when its close is the first call to meet a lost browser, or
// "never", as while a WebKit child still holds the browser's pipes, which with
// BROWSER_HANGS keeps Chromium from closing too.
const PLAYED = `const fs = require("node:fs");
const { CHECK_FAILS, CLOSE, BROWSER_HANGS } = process.env;
const solved = { status: "unique", solutions: [{ cells: [...${JSON.stringify(SMOKE_SOLUTION)}] }] };
function app(name, check, played) {
  const state = { puzzle: { rows: 9, cells: [5], type: "sudoku" }, result: null, busy: false, uncertain: [0], needsReview: true };
  let value, type;
  return { on() {}, setDefaultTimeout() {}, workers: () => [], keyboard: { press: async () => {} },
    goto: async () => {
      if (name === "webkit") throw new Error("no site here");
      if (check && CHECK_FAILS === "first") throw new Error("the check's page found no site");
    },
    waitForSelector: async () => {}, waitForFunction: async () => {}, waitForNavigation: async () => {},
    setInputFiles: async () => {}, focus: async () => {}, inputValue: async () => "9",
    selectOption: async (selector, option) => { type = option; }, fill: async (selector, text) => { value = text; },
    click: async (selector) => {
      if (selector === "#cell-form button[type=submit]") state.puzzle.cells[0] = Number(value);
      if (selector === "#undo") state.puzzle.cells[0] = 5;
      if (selector === "#use-type") state.puzzle.type = type;
      if (selector === "#read-photo") played.route?.({ abort: async () => {} });
    },
    screenshot: async ({ path }) => fs.writeFileSync(path, ""),
    locator: () => ({ getAttribute: async () => null, isVisible: async () => true, isHidden: async () => true,
      isEnabled: async () => true, isDisabled: async () => true, innerText: async () => "what the page said", evaluate: async () => {} }),
    evaluate: async (read) => {
      if (!check && played.checked) throw new Error("the stand-in plays no further than the check");
      const source = String(read).replace(/\\s+/g, "");
      if (source.endsWith("__gridpuzzleTestState().result")) return solved;
      if (source === "()=>window.__gridpuzzleTestState()") return structuredClone(state);
      if (source.includes("scrollWidth")) return true;
      if (source.includes("toDataURL")) return "aW1hZ2U=";
      if (source.includes("model.demo().cells")) return { type: "sudoku", correct: CHECK_FAILS === "last" ? 0 : 30, unsafe: [], corrections: [] };
      if (source.includes("saved:localStorage.getItem")) return { puzzle: "{}", saved: null };
    } };
}
const engine = (name) => ({ async launch() {
  const pipes = setInterval(() => {}, 1000), played = { checked: false, route: null };
  let contexts = 0;
  return { contexts: () => [], on() {}, isConnected: () => true, version: () => "1.0",
    close: async () => { if (name === "chromium" && BROWSER_HANGS) return new Promise(() => {}); clearInterval(pipes); },
    newContext: async () => {
      const check = ++contexts === 2, page = app(name, check, played);
      return { on() {}, newPage: async () => page,
        route: async (pattern, handler) => { played.route = handler; }, unroute: async () => { played.route = null; },
        close: async () => {
          if (!check) return;
          played.checked = true;
          console.log("the check's context closes");
          if (CLOSE === "rejects") throw new Error("the browser has gone");
          if (CLOSE === "never") return new Promise(() => {});
        } };
    } };
} });
module.exports = { chromium: engine("chromium"), webkit: engine("webkit") };
`;

// The count of CLOSE_LIMIT's timers is four when the check gets as far as
// asking for OCR's language, for which it waits as long, and three when its
// first step fails: one for each browser's close and one for the check's
// context's.
describe('browser_smoke, on a context of its startup-cancellation check that will not close', { concurrency: true }, () => {
  for (const [what, env, failure, cleanupErrors, checks, limits] of [
    ['the check passes and its context closes', {}, 'Error: the stand-in plays no further than the check', [], 2, 4],
    ['the check passes and its context never closes', { CLOSE: 'never' }, `Error: ${TIMED_OUT}`, [TIMED_OUT], 2, 4],
    ['the check passes and its context will not close', { CLOSE: 'rejects' }, `Error: ${GONE_BY}`, [GONE_BY], 2, 4],
    ['the check fails at its first step and its context never closes', { CHECK_FAILS: 'first', CLOSE: 'never' },
      'Error: the check\'s page found no site', [TIMED_OUT], 0, 3],
    ['the check fails at its first step and its context will not close either', { CHECK_FAILS: 'first', CLOSE: 'rejects' },
      'Error: the check\'s page found no site', [GONE_BY], 0, 3],
    ['the check fails at its last step and its context will not close either', { CHECK_FAILS: 'last', CLOSE: 'rejects' },
      'AssertionError [ERR_ASSERTION]: Fresh scan after startup cancellation failed', [GONE_BY], 1, 4],
    // As in the WebKit hang: the run ends through exitIfUnclosed().
    ['the check passes and neither its context nor its browser closes', { CLOSE: 'never', BROWSER_HANGS: '1' }, `Error: ${TIMED_OUT}`,
      [TIMED_OUT, 'browser: browser cleanup timed out'], 2, 4],
  ])
    test(`ends by itself with both engines' reports when ${what}`, async (t) => {
      const { code, killed, stderr, lines, limits: count, read } = await standIn(t, 'scripts/browser_smoke.cjs', PLAYED, env);
      assert.equal(killed, false, `it ended by itself: ${stderr}`);
      assert.equal(code, 1, stderr);
      const [chromium, webkit] = read('browser-artifacts/results.json');
      assert.deepEqual([chromium.ok, chromium.failure.split('\n')[0], chromium.cleanupErrors], [false, failure, cleanupErrors]);
      assert.deepEqual(chromium.checks.slice(chromium.checks.indexOf('camera permission fallback') + 1), SMOKE_CHECKS.slice(0, checks),
        'the check ran, after every step before it');
      for (const failed of cleanupErrors) assert.ok(stderrLines(stderr).includes(`chromium: ${failed}`), stderr);
      assert.deepEqual([webkit.ok, webkit.failure.split('\n')[0], webkit.cleanupErrors], [false, 'Error: no site here', []], 'the next engine ran');
      assert.deepEqual(lines.filter((line) => line === 'the check\'s context closes'), ['the check\'s context closes']);
      assert.equal(count, limits);
    });
});

// ocr_latency in a process of its own, as above, on browsers that play its
// five reads, each launch keeping the process alive until its browser closes.
// CLOSE is how Chromium's contexts close, as for browser_smoke above, and each
// context's close says whose and which variant's it is.
const OCR_PLAYED = `const { CLOSE } = process.env;
const reads = () => ({ scans: Array.from({ length: 5 }, (_, read) => ({ name: "sudoku", milliseconds: 900, firstReading: 300,
  timings: {}, ocrStats: { cacheHits: read ? 4 : 0 }, wrong: [], unsafe: [], correct: 24, workers: { ocr: 1, geometry: 1 } })),
  counts: { ocr: 1, geometry: 1 } });
const engine = (name) => ({ async launch() {
  const pipes = setInterval(() => {}, 1000);
  return { contexts: () => [], on() {}, isConnected: () => true, version: () => "1.0", close: async () => { clearInterval(pipes); },
    newContext: async () => {
      let variant;
      return { newPage: async () => ({ setDefaultTimeout() {}, waitForSelector: async () => {}, evaluate: async () => reads(),
          goto: async (url) => { variant = url.split("/").at(-2); } }),
        close: async () => {
          console.log(name + "'s " + variant + " context closes");
          if (name !== "chromium") return;
          if (CLOSE === "rejects") throw new Error("the browser has gone");
          if (CLOSE === "never") return new Promise(() => {});
        } };
    } };
} });
require(${JSON.stringify(script('ocr_latency_regressions'))})({ playwright: { chromium: engine("chromium"), webkit: engine("webkit") }, port: 0, out: process.env.OUT })
  .then(() => console.log("the run passed"), (error) => { console.log("the run failed:", error.message); process.exitCode = 1; });
`;

// The close comes only after a variant passed, so no failure of the suite's own
// can come before it. With a baseline site each engine reads it first, so a
// Chromium whose baseline's context would not close is asked for no other.
// The count: one for each browser's close and one for each context's.
describe('ocr_latency, on a variant\'s context that will not close', { concurrency: true }, () => {
  const candidates = ['chromium\'s candidate context closes', 'webkit\'s candidate context closes'];
  for (const [what, env, failure, cleanupErrors, closes, limits] of [
    ['its contexts close', {}, null, [], candidates, 4],
    ['Chromium\'s context never closes', { CLOSE: 'never' }, TIMED_OUT, [TIMED_OUT], candidates, 4],
    ['Chromium\'s context will not close', { CLOSE: 'rejects' }, GONE_BY, [GONE_BY], candidates, 4],
    ['Chromium\'s baseline\'s context never closes', { CLOSE: 'never', OCR_BASELINE_SITE: '_site' }, TIMED_OUT, [TIMED_OUT],
      ['chromium\'s baseline context closes', 'webkit\'s baseline context closes', 'webkit\'s candidate context closes'], 5],
  ])
    test(`ends by itself, every engine run and its report written, when ${what}`, async (t) => {
      const directory = temporary(t), run = path.join(directory, 'run.cjs'), preload = path.join(directory, 'limits.cjs');
      fs.writeFileSync(run, OCR_PLAYED);
      fs.writeFileSync(preload, LIMITS);
      // From the repository's root, where it reads its fixtures.
      const out = path.join(directory, 'ocr-latency.json');
      const { code, killed, stderr, stdout } = await finish(['-r', preload, run], { cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { ...process.env, BROWSER_ENGINES: '', OCR_BASELINE_SITE: '', OUT: out, ...env } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, failure ? 1 : 0, stderr);
      const { lines, limits: count } = counted(stdout);
      const [chromium, webkit] = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.deepEqual([chromium.ok, chromium.failure?.split('\n')[0], chromium.cleanupErrors],
        [!failure, failure ? `Error: ${failure}` : undefined, cleanupErrors]);
      if (env.OCR_BASELINE_SITE) assert.deepEqual([Boolean(chromium.baseline), chromium.candidate], [true, undefined]);
      for (const failed of cleanupErrors) assert.ok(stderrLines(stderr).includes(`chromium: ${failed}`), stderr);
      assert.deepEqual([webkit.ok, webkit.cleanupErrors, Boolean(webkit.candidate)], [true, [], true], 'the next engine ran');
      assert.deepEqual(lines.filter((line) => line.endsWith(' context closes')), closes);
      assert.equal(lines.at(-1), failure ? `the run failed: ${failure}` : 'the run passed');
      assert.equal(count, limits);
    });
});

// Playwright for harness_regressions in WebKit alone, on which it plays its
// first three cases: "ordinary", "crash", which WebKit passes, and
// "carried-on", in which the suite closes a context of its own. That is the
// only context anything closes here, as engines() closes the browser, and
// CLOSE is how it closes, as for browser_smoke above. The stand-in has no
// browser for the cases after these, so the run stops at the next one, which
// reports nothing. What a case prints through console.error while its browser
// is up, which the suite's attempt() keeps to itself, goes to stderr too.
const HARNESSED = `const fs = require("node:fs"), util = require("node:util");
const { CLOSE } = process.env;
let launches = 0;
module.exports = { webkit: { async launch() {
  if (++launches > 3) throw new Error("the stand-in has no browser for the cases after carried-on");
  const kept = console.error;
  console.error = (...args) => { process.stderr.write(util.format(...args) + "\\n"); kept(...args); };
  const pipes = setInterval(() => {}, 1000);
  return { contexts: () => [], on() {}, isConnected: () => true, version: () => "1.0", close: async () => { clearInterval(pipes); },
    newContext: async () => {
      const context = { newPage: async () => ({ context: () => context, setDefaultTimeout() {}, goto: async () => {},
          screenshot: async ({ path }) => fs.writeFileSync(path, "") }),
        close: async () => {
          console.log("the suite closes its context");
          if (CLOSE === "rejects") throw new Error("the browser has gone");
          if (CLOSE === "never") return new Promise(() => {});
        } };
      return context;
    } };
} } };
`;

// The close is the case's last step, so no failure of the case's own can come
// before it. The count: one for each of the three browsers' closes and one for
// the context's. The run's folder goes in its finally.
describe('harness_regressions, on the context its "carried-on" case closes in WebKit', { concurrency: true }, () => {
  for (const [what, env, failure, cleanupErrors, ending] of [
    ['closes', {}, null, [], /ENOENT[^\n]*harness-page-errors\.json/],
    ['never closes', { CLOSE: 'never' }, `Error: ${TIMED_OUT}`, [TIMED_OUT], /carried-on: webkit closes/],
    ['will not close', { CLOSE: 'rejects' }, `Error: ${GONE_BY}`, [GONE_BY], /carried-on: webkit closes/],
  ])
    test(`ends by itself, with the case's report written, when that context ${what}`, async (t) => {
      const { code, killed, stdout, stderr, lines, limits, read, left: folders } =
        await standIn(t, 'scripts/harness_regressions.cjs', HARNESSED, { BROWSER_ENGINES: 'webkit', ...env });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      const [webkit] = read('browser-artifacts/harness-carried-on.json');
      assert.deepEqual([webkit.status, webkit.failure?.split('\n')[0], webkit.cleanupErrors],
        [failure ? 'failed' : 'passed', failure ?? undefined, cleanupErrors]);
      for (const failed of cleanupErrors) assert.ok(stderrLines(stderr).includes(`webkit: ${failed}`), stderr);
      // A failed close fails the case; with one that worked the run went on to
      // the next case, which the stand-in has no browser for.
      assert.match(stderr, ending);
      assert.deepEqual(lines.filter((line) => line === 'the suite closes its context'), ['the suite closes its context']);
      assert.equal(limits, 4);
      assert.deepEqual(folders(), [], 'its folder is gone');
    });
});

// How SIGNALLED, below, hears SIGNAL: a real signal where there are real
// ones, which Node hears once the suite's code has run on, promises included.
// On Windows, where process.kill() just ends the process or refuses the
// signal, and for SIGBREAK, which only Windows raises, everywhere, it calls
// what listens for the signal itself, at once.
const RAISE = `if (process.platform === "win32" || require("node:os").constants.signals[SIGNAL] === undefined) process.emit(SIGNAL, SIGNAL);
  else process.kill(process.pid, SIGNAL);`;

/* A suite on the harness that hears a signal once its server is up and the
   harness has made it a temporary directory, and would otherwise carry on
   for three seconds and end by itself. Its server is the stand-in for
   Python's, detached, so that on Windows too only the harness's clean-up ends
   it (libuv's job object ends a process's other children with it there); it
   ends itself after a minute should that clean-up not come. */
const SIGNALLED = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => spawn(process.execPath, ["-e", ${JSON.stringify(`${SERVER}\nsetTimeout(() => process.exit(), 60000);`)}],
  { ...options, cwd: ${JSON.stringify(os.tmpdir())}, detached: true });
const { baselineSite, main, serve, sleep } = require(${JSON.stringify(harness)}), { SIGNAL } = process.env;
main(module, async () => {
  const server = await serve();
  console.log("origin", server.origin);
  baselineSite("HEAD", []);
  ${RAISE}
  await sleep(3000);
  console.log("the suite carried on");
  await server.close();
});
`;

/* Suites with browsers of their own, as ocr_latency and solver_update are:
   they load the harness for watch() and exitIfUnclosed() and call neither
   serve() nor main(). Each adds a listener for the signal, as a launch adds
   Playwright's, before any call into the harness. LOADED then has the
   harness make it a temporary directory, which the harness's clean-up must
   remove; NOTHING, like ocr_latency and solver_update, makes nothing of the
   harness's at all. Then each calls what listens for the signal itself, at
   once, on every platform, and waits on a timer of its own. These check
   which listeners there are, and in what order, as the signal comes, and a
   real signal comes only once the suite's code has run on: listeners that
   the harness added in that moment, at a call into it or a tick after it
   loaded, could still come first. So in NOTHING only listeners the harness
   added as the suite loaded it can come before the launch's: they end the
   process in the same emit, and the launch's never hears it. */
const loaded = (makes) => `const { SIGNAL } = process.env, { baselineSite, exitIfUnclosed } = require(${JSON.stringify(harness)});
(async () => {
  process.on(SIGNAL, () => console.log("the launch's listener heard it"));
  ${makes ? 'baselineSite("HEAD", []);' : '// It makes nothing of the harness\'s.'}
  process.emit(SIGNAL, SIGNAL);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log("the suite carried on");
})().finally(() => exitIfUnclosed(module));
`;
const LOADED = loaded(true), NOTHING = loaded(false);

// A tree for a suite above, with what baselineSite() copies.
function suiteTree(t, source) {
  const directory = temporary(t), suite = path.join(directory, 'suite.cjs');
  fs.mkdirSync(path.join(directory, '_site'));
  fs.writeFileSync(path.join(directory, '_site', 'build-info.json'), '{ "build": "x" }');
  fs.writeFileSync(suite, source);
  return { directory, suite };
}

// Whether anything answers at `origin` within a second.
const answers = (origin) => fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(1000) }).then(() => true, () => false);

// SIGHUP is a terminal that goes away, or on Windows a console window that
// closes, and SIGBREAK Ctrl+Break. Side by side, as above.
const SIGNALS = [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143], ['SIGBREAK', 149]];
describe('a signal ends a suite\'s process through the harness\'s clean-up', { concurrency: true }, () => {
  for (const [signal, expected] of SIGNALS)
    test(`${signal} ends it at once, with ${expected}, its server stopped and its temporary directory gone`, async (t) => {
      const { directory, suite } = suiteTree(t, SIGNALLED);
      const { code, killed, stdout, stderr } = await finish(suite, { cwd: directory, env: { ...process.env, ...temporaryIn(directory), SIGNAL: signal } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, expected, `${stdout}${stderr}`);
      assert.doesNotMatch(stdout, /the suite carried on/);
      assert.deepEqual(left(directory), [], 'its temporary directory is gone');
      const origin = /^origin (\S+)$/m.exec(stdout)?.[1];
      assert.ok(origin, stdout);
      // Stopped with a signal of its own, which a server on Linux hears a moment later.
      let up = true;
      for (const stop = Date.now() + 5000; up && Date.now() < stop;) if ((up = await answers(origin))) await sleep(100);
      assert.equal(up, false, `the server at ${origin} still answers`);
    });

  for (const [signal, expected] of SIGNALS)
    test(`${signal} ends one that only loads the harness, as ocr_latency and solver_update do, with ${expected}, before its launch's listener hears it, its temporary directory gone`, async (t) => {
      const { directory, suite } = suiteTree(t, LOADED);
      const { code, killed, stdout, stderr } = await finish(suite, { cwd: directory, env: { ...process.env, ...temporaryIn(directory), SIGNAL: signal } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, expected, `${stdout}${stderr}`);
      assert.doesNotMatch(stdout, /the launch's listener heard it/);
      assert.doesNotMatch(stdout, /the suite carried on/);
      assert.deepEqual(left(directory), [], 'its temporary directory is gone');
    });

  for (const [signal, expected] of SIGNALS)
    test(`${signal} ends one that only loads the harness and makes nothing of it, as ocr_latency and solver_update do, with ${expected}, before its launch's listener hears it`, async (t) => {
      const { directory, suite } = suiteTree(t, NOTHING);
      const { code, killed, stdout, stderr } = await finish(suite, { cwd: directory, env: { ...process.env, ...temporaryIn(directory), SIGNAL: signal } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, expected, `${stdout}${stderr}`);
      assert.doesNotMatch(stdout, /the launch's listener heard it/);
      assert.doesNotMatch(stdout, /the suite carried on/);
    });
});
