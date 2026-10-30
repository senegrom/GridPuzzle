import test from 'node:test';
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
// (harness_regressions checks both on real browsers). Loading watch.cjs or
// the harness needs no Playwright.
const { CLOSE_LIMIT, cleanUp, watch } = createRequire(import.meta.url)('../../scripts/watch.cjs');
const harness = fileURLToPath(new URL('../../scripts/harness.cjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

/* How a process ends that runs `scripts` (name to source), the first as its
   main module, in a temporary directory: its exit code, whether the bound
   had to end it, and what it printed. */
async function ending(t, scripts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-close-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(scripts)) fs.writeFileSync(path.join(directory, name), PRELUDE + source);
  return new Promise((resolve) => execFile(process.execPath, [path.join(directory, Object.keys(scripts)[0])], { timeout: 30000 },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, killed: error?.killed ?? false, stdout, stderr })));
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
