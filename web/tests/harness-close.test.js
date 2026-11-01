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
// and what else can leave a server up to hold a run, as a browser does.
// Loading watch.cjs or the harness needs no Playwright.
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

// How a process ends that runs `script`: its exit code, whether the bound had
// to end it, and what it printed. These runs take a second or so. The bound
// allows for a host short of memory, where one at Idle priority was still
// silent after 30 s. `script` can be an array, with what Node takes before it.
const finish = (script, options) => new Promise((resolve) => execFile(process.execPath, [script].flat(), { timeout: 45000, ...options },
  (error, stdout, stderr) => resolve({ code: error?.code ?? 0, killed: error?.killed ?? false, stdout, stderr })));

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

// The stale-build check inside photo_read runs on its engine's browser, which
// closes whatever the check does, but it serves the site itself, and a server
// left listening holds the process for ever as a browser left up does. Here
// nothing else holds it. `REFUSE` is as above; with CLOSE_FAILS the context's
// close rejects too, as it does when it is the first call to meet a lost
// browser. They go side by side: a process held runs to the bound.
const STALE_CHECK = `const { staleBuild } = require(${JSON.stringify(fileURLToPath(new URL('../../scripts/stale_build_checks.cjs', import.meta.url)))});
const { REFUSE, CLOSE_FAILS } = process.env, opening = (call) => { if (call === REFUSE) throw new Error(call + " refused"); };
const browser = { newContext: async () => {
  opening("newContext");
  return { newPage: async () => opening("newPage"),
    close: async () => { console.log("context closed"); if (CLOSE_FAILS) throw new Error("the browser has gone"); } };
} };
staleBuild(browser, {}).catch((error) => { console.log("the check failed:", error.message); process.exitCode = 1; });
`;

describe('the stale-build check, on a browser that will not open its context or page', { concurrency: true }, () => {
  for (const [what, env, said] of [
    ['newContext() rejects', { REFUSE: 'newContext' }, ['the check failed: newContext refused']],
    ['newPage() rejects', { REFUSE: 'newPage' }, ['context closed', 'the check failed: newPage refused']],
    ['newPage() rejects and its context will not close either', { REFUSE: 'newPage', CLOSE_FAILS: '1' },
      ['context closed', 'the check failed: the browser has gone']],
  ])
    test(`stops its server when ${what}, so that the process ends by itself`, async (t) => {
      const directory = temporary(t), check = path.join(directory, 'check.cjs');
      fs.mkdirSync(path.join(directory, '_site'));
      fs.writeFileSync(path.join(directory, '_site', 'build-info.json'), '{ "build": "x" }');
      fs.writeFileSync(check, STALE_CHECK);
      const { code, killed, stdout, stderr } = await finish(check, { cwd: directory, env: { ...process.env, ...env } });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      assert.deepEqual(stdout.trim().split('\n'), said);
    });
});

const script = (name) => fileURLToPath(new URL(`../../scripts/${name}.cjs`, import.meta.url));

// The offline-install check inside photo_read serves a folder of its own from
// Python, the server the harness starts: here, the stand-in. Its page answers
// all the check asks, unless PAGE_FAILS; with CLOSE_FAILS its context's close
// rejects, as it does when it is the first call to meet a lost browser, and
// with RM_FAILS its folder will not go. That close says whether the folder is
// still there, which it should be: the page closes on its site.
const OFFLINE_CHECK = `${SPAWN}const { offlineInstall } = require(${JSON.stringify(script('import_safety_checks'))});
const fs = require("node:fs"), os = require("node:os"), { PAGE_FAILS, CLOSE_FAILS, RM_FAILS } = process.env;
if (RM_FAILS) fs.rmSync = () => { throw new Error("the folder is in use"); };
const page = { setDefaultTimeout() {}, goto: async () => { if (PAGE_FAILS) throw new Error("no site here"); },
  waitForFunction: async () => {}, waitForNavigation: async () => {}, click: async () => {}, textContent: async () => "failed",
  locator: () => ({ isEnabled: async () => true }), evaluate: async () => "unchanged saved puzzle" };
const browser = { newContext: async () => ({ newPage: async () => page, close: async () => {
  console.log("context closed", fs.readdirSync(os.tmpdir()).some((name) => name.startsWith("gridpuzzle-install-")) ? "on its site" : "after its site went");
  if (CLOSE_FAILS) throw new Error("the browser has gone");
} }) };
offlineInstall(browser, {}).then(() => console.log("the check passed"),
  (error) => { console.log("the check failed:", error.code ?? error.message); process.exitCode = 1; });
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
  // to make, and the failure stays the check's own.
  for (const [what, env, expected, said] of [
    ['its context will not close', { CLOSE_FAILS: '1' }, 1, 'the check failed: the browser has gone'],
    ['its page fails and its context will not close either', { PAGE_FAILS: '1', CLOSE_FAILS: '1' }, 1, 'the check failed: the browser has gone'],
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
