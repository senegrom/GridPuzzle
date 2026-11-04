import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// A suite's reads of its page after a failure, for its report, which share
// watch.cjs's READ_LIMIT through readWithin(): the helper on its own,
// live_camera's readAfterFailure() on a stand-in page, and live_camera run as
// it is, in a process of its own, on a stand-in for Playwright whose page
// fails the suite's first step and then answers those reads, fails them or
// never answers. Loading watch.cjs or the suite needs no Playwright.
const require = createRequire(import.meta.url);
const { CLOSE_LIMIT, READ_LIMIT, readWithin } = require('../../scripts/watch.cjs');
const { readAfterFailure } = require('../../scripts/live_camera_regressions.cjs');
const tick = () => new Promise(setImmediate);
const timers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
const never = () => new Promise(() => {});

test('the reads share the page\'s default timeout, the 20 s that engines() gives each call on the page', () => {
  assert.equal(READ_LIMIT, 20000);
  const harness = fs.readFileSync(new URL('../../scripts/harness.cjs', import.meta.url), 'utf8');
  assert.match(harness, new RegExp(`\\btimeout = ${READ_LIMIT}\\b`), 'engines()\'s default timeout for the page');
});

test('reads that answer give exactly what they resolved to, in the order asked, and leave no timer behind', async () => {
  const before = timers();
  const { values, cutShort } = await readWithin({
    text: [() => 'Saved', ''], count: [async () => 0, null], none: [async () => undefined, null],
    empty: [async () => null, ''], object: [async () => ({ tracks: [] }), null],
  }, 1000);
  assert.deepEqual(Object.entries(values), [['text', 'Saved'], ['count', 0], ['none', undefined], ['empty', null], ['object', { tracks: [] }]]);
  assert.deepEqual(cutShort, []);
  assert.equal(timers(), before, 'a timer left behind would hold the run up by the limit');
});

test('a read that fails, at once, later or by throwing, keeps its fallback and is not cut short', async () => {
  const before = timers();
  const { values, cutShort } = await readWithin({
    rejects: [() => Promise.reject(new Error('Target page, context or browser has been closed')), ''],
    throws: [() => { throw new Error('not a function'); }, null],
    timesOut: [() => new Promise((resolve, reject) => setTimeout(reject, 20, new Error('Timeout 20000ms exceeded.'))), 'none'],
  }, 1000);
  assert.deepEqual(values, { rejects: '', throws: null, timesOut: 'none' });
  assert.deepEqual(cutShort, []);
  assert.equal(timers(), before, 'a timer left behind would hold the run up by the limit');
});

test('reads that never answer end together at the limit, once, with their fallbacks and each named with why', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result;
  readWithin({ first: [never, ''], second: [never, null], third: [never, 0] }, 20000).then((read) => { result = read; });
  await tick();
  t.mock.timers.tick(19999); await tick();
  assert.equal(result, undefined, 'the limit has not passed');
  t.mock.timers.tick(1); await tick();
  assert.deepEqual(result, { values: { first: '', second: null, third: 0 },
    cutShort: ['first: no answer within 20 s', 'second: no answer within 20 s', 'third: no answer within 20 s'] });
});

test('a read that waits holds up no other: one answer just before the limit counts, and one after it changes nothing, nor does a late failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const at = (ms, value) => () => new Promise((resolve) => setTimeout(resolve, ms, value));
  let result;
  readWithin({ waits: [never, null], early: [at(5000, 'early'), ''], last: [at(19999, 'just in time'), ''],
    late: [at(20001, 'too late'), ''], failsLate: [() => new Promise((resolve, reject) => setTimeout(reject, 25000, new Error('too late'))), null] },
  20000).then((read) => { result = read; });
  // Time moves on from one timer to the next, as a real host's clock does,
  // with what each settles run before the next.
  await tick();
  for (const step of [5000, 14999]) { t.mock.timers.tick(step); await tick(); }
  assert.equal(result, undefined, 'the limit has not passed');
  t.mock.timers.tick(1); await tick();
  const expected = { values: { waits: null, early: 'early', last: 'just in time', late: '', failsLate: null },
    cutShort: ['waits: no answer within 20 s', 'late: no answer within 20 s', 'failsLate: no answer within 20 s'] };
  assert.deepEqual(result, expected);
  // node:test fails a test on an unhandled rejection.
  for (const step of [1, 4999]) { t.mock.timers.tick(step); await tick(); }
  assert.deepEqual(result, expected, 'what the reads did after the limit changes nothing');
});

// As page.textContent() has the page's default timeout, which is as long: on a
// page that never answers, such a read is cut short as the wait ends, not
// failed by its own timeout a moment before, so that every read still waiting
// then is named.
test('a read with a timeout of its own as long as the limit, started with the read, is still waiting when the wait ends', async () => {
  const timesOut = () => new Promise((resolve, reject) => setTimeout(reject, 50, new Error('Timeout 50ms exceeded.')));
  assert.deepEqual(await readWithin({ text: [timesOut, ''], other: [timesOut, ''] }, 50),
    { values: { text: '', other: '' }, cutShort: ['text: no answer within 0.05 s', 'other: no answer within 0.05 s'] });
});

// The reads live_camera's catch makes, by the name its report gives each, as a
// page is asked for them: by selector, or by what the read evaluates.
const ASKED = {
  storageStatus: 'textContent #capture-storage-status', paintCount: 'evaluate ()=>window.livePaintCount',
  visibility: 'evaluate ()=>document.visibilityState', cameraCalls: 'evaluate ()=>window.liveGetUserMediaCalls',
  video: 'locator #video evaluate', statusDetail: 'textContent #status-detail', cameraHelp: 'textContent #camera-help',
};
// What a page answers them with, and what the catch keeps when a read fails:
// the fallbacks it has always had.
const ANSWERS = {
  storageStatus: 'Picture saved in this browser.', paintCount: 17, visibility: 'visible', cameraCalls: undefined,
  video: { muted: true, paused: false, width: 700, ready: 4, inline: true, tracks: [{ kind: 'video', ready: 'live' }] },
  statusDetail: 'Detected 4 × 4.', cameraHelp: 'Hold the grid steady.',
};
const FALLBACKS = { storageStatus: '', paintCount: null, visibility: null, cameraCalls: null, video: null, statusDetail: '', cameraHelp: '' };
const CUT_SHORT = (...names) => names.map((name) => `${name}: no answer within 20 s`);

// A page for readAfterFailure() that answers each read as `how(name)` says:
// "answer" (ANSWERS; the video's state through the suite's own read of a
// video element), "reject", or "never". `asked` lists what it was asked.
function standInPage(how) {
  const asked = [], names = Object.fromEntries(Object.entries(ASKED).map(([name, what]) => [what, name]));
  const read = (what, answer) => {
    asked.push(what);
    const name = names[what], way = how(name);
    assert.ok(name, `asked for ${what}, which the catch never read`);
    if (way === 'answer') return Promise.resolve().then(answer);
    if (way === 'reject') return Promise.reject(new Error(`${what}: Target page, context or browser has been closed`));
    return never();
  };
  const video = { muted: true, paused: false, videoWidth: 700, readyState: 4, playsInline: true,
    srcObject: { getTracks: () => [{ kind: 'video', readyState: 'live' }] } };
  return {
    asked,
    textContent: (selector) => read(`textContent ${selector}`, () => ANSWERS[names[`textContent ${selector}`]]),
    evaluate: (fn) => read(`evaluate ${String(fn).replace(/\s+/g, '')}`, () => ANSWERS[names[`evaluate ${String(fn).replace(/\s+/g, '')}`]]),
    locator: (selector) => ({ evaluate: (fn) => read(`locator ${selector} evaluate`, () => fn(video)) }),
  };
}

describe('live_camera\'s reads of its page after a failure', () => {
  test('a page that answers: the report gets exactly what each read gave, in the order the catch has always read them, and no read cut short', async () => {
    const page = standInPage(() => 'answer'), report = { browser: 'webkit' };
    await readAfterFailure(page, report);
    assert.deepEqual(report, { browser: 'webkit', ...ANSWERS, readsCutShort: [] });
    assert.deepEqual(Object.keys(report), ['browser', ...Object.keys(ANSWERS), 'readsCutShort']);
    assert.deepEqual(page.asked, Object.values(ASKED), 'each read asked once, all at once, in that order');
  });

  test('a page that fails every read: the report gets the fallbacks the catch has always kept, and no read cut short', async () => {
    const report = {};
    await readAfterFailure(standInPage(() => 'reject'), report);
    assert.deepEqual(report, { ...FALLBACKS, readsCutShort: [] });
  });

  test('a page that never answers: the reads end together after 20 s, with their fallbacks, and the report names each read cut short', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const report = {};
    let done = false;
    readAfterFailure(standInPage(() => 'never'), report).then(() => { done = true; });
    await tick();
    t.mock.timers.tick(19999); await tick();
    assert.equal(done, false, 'the limit has not passed');
    t.mock.timers.tick(1); await tick();
    assert.equal(done, true);
    assert.deepEqual(report, { ...FALLBACKS, readsCutShort: CUT_SHORT(...Object.keys(FALLBACKS)) });
  });

  test('a page that answers some reads and never others: the answers count, the rest are cut short', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const report = {};
    let done = false;
    readAfterFailure(standInPage((name) => (['paintCount', 'video'].includes(name) ? 'never' : 'answer')), report).then(() => { done = true; });
    await tick();
    t.mock.timers.tick(20000); await tick();
    assert.equal(done, true);
    assert.deepEqual(report, { ...ANSWERS, paintCount: null, video: null, readsCutShort: CUT_SHORT('paintCount', 'video') });
  });
});

// How a process ends that runs `script`, with what Node takes before it: its
// exit code, whether the bound had to end it, and what it printed. These runs
// take a second or so; the bound allows for a host short of memory.
const finish = (args, options) => new Promise((resolve) => execFile(process.execPath, args, { timeout: 45000, ...options },
  (error, stdout, stderr) => resolve({ code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false, stdout, stderr })));

// What stands in for Python's server, which serve() starts: Node's, answering
// every request, on a port the system picks, in this process's temporary
// directory, outside the run's tree.
const SERVER = `require("node:http").createServer((request, response) => response.end())
  .listen(0, "127.0.0.1", function () { console.log("port", this.address().port); });`;

// What each run loads first: that server for serve()'s spawn, and timers of
// READ_LIMIT's and CLOSE_LIMIT's lengths that last a tenth of a second, as
// harness-close.test.js shortens CLOSE_LIMIT's, and are counted, the counts
// printed as the process exits. Nothing else such a run starts sets a timer of
// either length: each engine's reads after its failure set one of READ_LIMIT's
// and its browser's close one of CLOSE_LIMIT's, so that reads given any other
// limit, or a limit each, fail on the count.
const PRELOAD = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { ...options, cwd: ${JSON.stringify(os.tmpdir())} });
const { setTimeout: later } = globalThis, limits = { ${READ_LIMIT}: 0, ${CLOSE_LIMIT}: 0 };
globalThis.setTimeout = (run, ms, ...args) => { if (Object.hasOwn(limits, ms)) { limits[ms]++; ms = 100; } return later(run, ms, ...args); };
process.on("exit", () => console.log("limits", JSON.stringify(limits)));
`;

// Playwright for live_camera: each engine's page fails the suite's first step,
// as WebKit's does on Windows, which has no navigator.mediaDevices, so that the
// suite's catch reads it. READS says how the page answers each read, by its
// name in the report, or "*" for the rest: "answer" (ANSWERS), "reject" at
// once, "times out" (rejects after 50 ms, as a read Playwright gives a timeout
// fails by it), "late" (answers 150 ms after it was asked, after the limit
// and while the screenshot, which takes 300 ms, is taken) or "never". The page
// says on stdout what it is asked for, a late answer and its screenshot, the
// browser its close. With BROWSER_HANGS, Chromium's browser never closes, as
// while a WebKit child holds the browser's pipes. Each launch keeps the
// process alive until its browser closes, as a live browser's pipes do.
const PLAYWRIGHT = `const fs = require("node:fs");
const { READS, BROWSER_HANGS } = process.env, ways = JSON.parse(READS);
const ASKED = ${JSON.stringify(ASKED)}, ANSWERS = ${JSON.stringify(ANSWERS)};
const names = Object.fromEntries(Object.entries(ASKED).map(([name, what]) => [what, name]));
const engine = (name) => ({ async launch() {
  const pipes = setInterval(() => {}, 1000);
  const read = (what) => {
    const asked = names[what], way = ways[asked] ?? ways["*"];
    console.log(name + " is asked for " + (asked ?? what));
    if (way === "answer") return Promise.resolve(ANSWERS[asked]);
    if (way === "reject") return Promise.reject(new Error("Target page, context or browser has been closed"));
    if (way === "times out") return new Promise((resolve, reject) => setTimeout(reject, 50, new Error("Timeout 20000ms exceeded.")));
    if (way === "late") return new Promise((resolve) => setTimeout(() => { console.log(name + " answers " + asked + " late"); resolve(ANSWERS[asked]); }, 150));
    return new Promise(() => {});
  };
  const page = { on() {}, setDefaultTimeout() {}, url: () => "http://stand-in/",
    goto: async () => { throw new Error("no site here"); },
    textContent: (selector) => read("textContent " + selector),
    evaluate: (fn) => read("evaluate " + String(fn).replace(/\\s+/g, "")),
    locator: (selector) => ({ evaluate: () => read("locator " + selector + " evaluate") }),
    screenshot: async ({ path }) => {
      console.log(name + " takes its screenshot");
      await new Promise((resolve) => setTimeout(resolve, 300));
      fs.writeFileSync(path, "");
    } };
  return { contexts: () => [], on() {}, isConnected: () => true, version: () => "1.0",
    close: async () => {
      console.log(name + "'s browser closes");
      if (name === "chromium" && BROWSER_HANGS) return new Promise(() => {});
      clearInterval(pipes);
    },
    newContext: async () => ({ on() {}, newPage: async () => page }) };
} });
module.exports = { chromium: engine("chromium"), webkit: engine("webkit") };
`;

// How live_camera ends, run as it is with PRELOAD loaded first, in a tree of
// its own with the harness and watch.cjs as they are and PLAYWRIGHT for
// Playwright, which is its working and temporary directory: what it printed,
// the counts of its limits' timers and both engines' reports.
async function caught(t, env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-reads-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inTree = (name) => path.join(directory, name);
  for (const file of ['scripts/live_camera_regressions.cjs', 'scripts/harness.cjs', 'scripts/watch.cjs'])
    fs.cpSync(new URL(`../../${file}`, import.meta.url), inTree(file));
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), PLAYWRIGHT);
  fs.writeFileSync(inTree('preload.cjs'), PRELOAD);
  const ended = await finish(['-r', inTree('preload.cjs'), inTree('scripts/live_camera_regressions.cjs')], { cwd: directory,
    env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, BROWSER_ENGINES: '', READS: JSON.stringify(env.READS), ...(env.BROWSER_HANGS && { BROWSER_HANGS: '1' }) } });
  const lines = ended.stdout.trim().split(/\r?\n/), limits = /^limits (.+)$/.exec(lines.at(-1));
  const reports = fs.existsSync(inTree('browser-artifacts/live-camera.json'))
    ? JSON.parse(fs.readFileSync(inTree('browser-artifacts/live-camera.json'), 'utf8')) : null;
  return { ...ended, lines, limits: limits && JSON.parse(limits[1]), reports };
}

// What a report keeps of each read: an answer that is undefined leaves no key
// in the report's JSON, as it always has.
const kept = (values) => JSON.parse(JSON.stringify(values));

// Side by side: each has a tree and a process of its own, and in Node 22
// --test-timeout limits a whole file.
describe('live_camera, run as it is, reads its page after its failure and then fails with it', { concurrency: true }, () => {
  const READ_NAMES = Object.keys(ASKED);
  for (const [what, env, values, cutShort, chromiumCloses = []] of [
    ['every read answers', { READS: { '*': 'answer' } }, ANSWERS, []],
    ['every read fails', { READS: { '*': 'reject' } }, FALLBACKS, []],
    ['no read answers', { READS: { '*': 'never' } }, FALLBACKS, CUT_SHORT(...READ_NAMES)],
    // As in the WebKit hang: the reads that Playwright gives a timeout fail by
    // it, page.evaluate() never answers, and the browser will not close.
    ['the reads with a timeout of their own fail by it, page.evaluate() never answers and the browser will not close',
      { READS: { paintCount: 'never', visibility: 'never', cameraCalls: 'never', '*': 'times out' }, BROWSER_HANGS: true },
      FALLBACKS, CUT_SHORT('paintCount', 'visibility', 'cameraCalls'), ['browser: browser cleanup timed out']],
    ['one read never answers and another answers after the limit, while the rest answer',
      { READS: { paintCount: 'never', visibility: 'late', '*': 'answer' } },
      { ...ANSWERS, paintCount: null, visibility: null }, CUT_SHORT('paintCount', 'visibility')],
  ])
    test(`ends by itself with both engines' reports and their reads when ${what}`, async (t) => {
      const { code, killed, stdout, stderr, lines, limits, reports } = await caught(t, env);
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      assert.ok(reports, `both reports written: ${stdout}`);
      assert.deepEqual(reports.map(({ browser, status, failure, cleanupErrors }) => [browser, status, failure.split('\n')[0], cleanupErrors]),
        [['chromium', 'failed', 'Error: no site here', chromiumCloses], ['webkit', 'failed', 'Error: no site here', []]],
        'the suite\'s own failure, rethrown after the reads');
      for (const report of reports) {
        assert.deepEqual(Object.fromEntries(READ_NAMES.filter((name) => Object.hasOwn(report, name)).map((name) => [name, report[name]])),
          kept(values), `${report.browser}'s reads`);
        assert.deepEqual(report.readsCutShort, cutShort, `${report.browser}'s reads cut short`);
      }
      // Each engine is asked for every read once, all before its screenshot,
      // which comes before its browser's close and so before its report; a
      // late answer comes in between, after the limit, and changes nothing.
      for (const name of ['chromium', 'webkit']) {
        const said = lines.filter((line) => line.startsWith(name)).map((line) => line.slice(name.length));
        const late = Object.entries(env.READS).filter(([, way]) => way === 'late').map(([read]) => ` answers ${read} late`);
        assert.deepEqual(said.filter((line) => !/^( \d|( \w+)+: [\d.]+ s$)/.test(line)),
          [...READ_NAMES.map((read) => ` is asked for ${read}`), ' takes its screenshot', ...late, '\'s browser closes'], stdout);
      }
      assert.deepEqual(limits, { [READ_LIMIT]: 2, [CLOSE_LIMIT]: 2 }, 'one limit for each engine\'s reads, and one for each browser\'s close');
      assert.doesNotMatch(stderr, /no answer within/, 'the reads cut short are the report\'s, not stderr\'s');
    });
});
