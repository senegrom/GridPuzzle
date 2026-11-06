import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The reads that six suites make of their page in a catch or a finally, for
// their report, which share watch.cjs's READ_LIMIT through readWithin(), as
// live_camera's do (harness-reads.test.js): live_motion's, live_noise's,
// live_recovery's and external_replay's as the functions the suites export,
// on a stand-in page; then each of the six run as it is, in a process of its
// own, on a stand-in for Playwright whose page fails the suite's first step
// in its try, and then answers those reads, fails them or never answers; the
// four whose finally reads, played through to a pass; and engines that never
// reach those reads, with no page, a page that never gets ready or a failure's
// screenshot that fails. Loading watch.cjs or a suite needs no Playwright.
const require = createRequire(import.meta.url);
const { CLOSE_LIMIT, READ_LIMIT } = require('../../scripts/watch.cjs');
const motion = require('../../scripts/live_motion_regressions.cjs');
const noise = require('../../scripts/live_noise_regressions.cjs');
const recovery = require('../../scripts/live_recovery_regressions.cjs');
const replay = require('../../scripts/external_replay_regressions.cjs');
const tick = () => new Promise(setImmediate);
const CUT_SHORT = (...names) => names.map((name) => `${name}: no answer within ${READ_LIMIT / 1000} s`);
const source = (script) => fs.readFileSync(new URL(`../../scripts/${script}`, import.meta.url), 'utf8');

// What READ_LIMIT means in each suite, as web/TESTING.md says: browser_smoke
// gives its page 20 s itself, which its #status read has as its own timeout,
// and the limit ends a tenth of a second before it; four suites ask engines()
// for 60 s, and solver_update keeps Playwright's 30, so that there the limit
// cuts short a read that would have answered later.
test('READ_LIMIT is a tenth of a second under browser_smoke\'s 20-s page timeout, and well under the 60 s four suites ask for and solver_update\'s 30', () => {
  assert.equal(READ_LIMIT, 19900);
  assert.match(source('browser_smoke.cjs'), /\bpage\.setDefaultTimeout\(20000\);/);
  assert.equal(20000 - READ_LIMIT, 100);
  for (const suite of ['live_motion', 'live_noise', 'live_recovery', 'external_replay'])
    assert.match(source(`${suite}_regressions.cjs`), /\}\s*,\s*\{\s*timeout:\s*60000\s*\}\s*\);/, `${suite} asks engines() for 60 s`);
  assert.doesNotMatch(source('solver_update_regressions.cjs'), /setDefaultTimeout/, 'solver_update keeps Playwright\'s 30 s');
});

// What each suite asks its page for in its catch or finally, by the source of
// what it evaluates, with its whitespace taken out, or by the locator's
// selector and call, and the name its report gives it: the stops of the
// fixtures are among them.
const NAMES = {
  '()=>({reads:window.motionState?.reads,cancels:window.motionState?.cancels,ticks:window.motionState?.ticks,reading:window.motionState?.reading,playback:window.motionState?.playback?.(),witness:window.motionState?.witness?.()??null,counts:{...window.motionOutput?.dataset},diagnostic:window.motionState?.diagnostics?.snapshot(),status:document.getElementById(\'camera-help\')?.textContent})': 'state',
  '()=>window.motionState?.stop?.()': 'stop',
  '()=>window.noiseState?.snapshot()': 'final',
  '()=>window.noiseState?.stop()': 'stop',
  '()=>window.recoveryState?.snapshot()': 'final',
  '()=>window.recoveryState?.stop()': 'stop',
  '()=>window.externalReplay?.stop()': 'closed',
  '()=>window.results': 'results',
  '()=>window.workerDebug': 'workerDebug',
  '()=>window.__gridpuzzleTestState()': 'state',
  'locator #status innerText': 'status',
};
// What a page answers them with. A fixture's stop answers nothing, but for
// external_replay's, which says what it left.
const ANSWERS = {
  state: { reads: 1, cancels: 0, ticks: 40, reading: false, witness: [36, 160, 80, 255], counts: { recognised: '22' }, status: 'Hold the grid steady.' },
  final: { found: null, reads: 1, completed: 1, status: 'Hold the grid steady.' },
  closed: { active: false, retainedSources: 0, scratchPixels: 0 },
  results: [{ status: 200, body: 'verified solver 111111111111' }],
  workerDebug: [{ controllerState: 'activated' }],
  status: 'Solved: one solution.',
};

// A page for the exported reads that answers each as `plan` says, by its name
// (NAMES; "*" for the rest): "answer" (ANSWERS), "reject", "never", "throws"
// (as the call is made), or [ms, way] to answer or reject that long after it
// was asked. `events` lists in order what it was asked for and what settled.
function standInPage(plan) {
  const events = [];
  const read = (name) => {
    const planned = plan[name] ?? plan['*'], [ms, way] = Array.isArray(planned) ? planned : [0, planned];
    events.push(`asked for ${name}`);
    if (way === 'throws') throw new Error(`${name}: not a function`);
    if (way === 'never') return new Promise(() => {});
    const settle = (resolve, reject) => {
      events.push(`${name} ${way === 'answer' ? 'answers' : 'fails'}`);
      if (way === 'answer') resolve(ANSWERS[name]); else reject(new Error('Target page, context or browser has been closed'));
    };
    return new Promise((resolve, reject) => (ms ? setTimeout(settle, ms, resolve, reject) : settle(resolve, reject)));
  };
  return { events, evaluate: (fn) => {
    const name = NAMES[String(fn).replace(/\s+/g, '')];
    assert.ok(name, `asked for ${fn}, which no suite reads after its steps`);
    return read(name);
  } };
}

// Moves the mocked clock on for `reading`, a wait started at its time 0, and
// says when it settled: "before the limit" if it had after `limit` - 1 ms,
// `limit` if it had a millisecond later, and "after the limit" if not then,
// with what each step settled run before the next.
async function settledAt(t, reading, limit = READ_LIMIT) {
  let done = false;
  reading.then(() => { done = true; });
  await tick();
  t.mock.timers.tick(limit - 1); await tick();
  if (done) return 'before the limit';
  t.mock.timers.tick(1); await tick();
  return done ? limit : 'after the limit';
}

describe('live_motion\'s read of its page after a failure, and its fixture\'s stop after a pass or a failure', () => {
  test('a page that answers: the report keeps the state exactly, and no read is cut short', async () => {
    const page = standInPage({ '*': 'answer' }), report = { browser: 'webkit' };
    await motion.readAfterFailure(page, report);
    assert.deepEqual(report, { browser: 'webkit', state: ANSWERS.state, readsCutShort: [] });
    await motion.stopMotion(page, report);
    assert.deepEqual(report, { browser: 'webkit', state: ANSWERS.state, readsCutShort: [] });
    assert.deepEqual(page.events, ['asked for state', 'state answers', 'asked for stop', 'stop answers']);
  });

  test('a page that fails both, at once or as the call is made: the state is null, as it always was, and nothing is cut short', async () => {
    for (const way of ['reject', 'throws']) {
      const report = {};
      await motion.readAfterFailure(standInPage({ '*': way }), report);
      await motion.stopMotion(standInPage({ '*': way }), report);
      assert.deepEqual(report, { state: null, readsCutShort: [] }, way);
    }
  });

  test('a page that never answers: each waits READ_LIMIT, the state is null and both are named, the stop after the state', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = standInPage({ '*': 'never' }), report = {};
    assert.equal(await settledAt(t, motion.readAfterFailure(page, report)), READ_LIMIT);
    assert.deepEqual(report, { state: null, readsCutShort: CUT_SHORT('state') });
    assert.equal(await settledAt(t, motion.stopMotion(page, report)), READ_LIMIT);
    assert.deepEqual(report, { state: null, readsCutShort: CUT_SHORT('state', 'stop') });
  });

  test('after a pass, a stop that never answers is named on its own, and one that answers leaves an empty list', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const passed = {}, stopped = {};
    assert.equal(await settledAt(t, motion.stopMotion(standInPage({ stop: 'never' }), passed)), READ_LIMIT);
    assert.deepEqual(passed, { readsCutShort: CUT_SHORT('stop') });
    await motion.stopMotion(standInPage({ stop: 'answer' }), stopped);
    assert.deepEqual(stopped, { readsCutShort: [] });
  });
});

// live_noise's and live_recovery's finally: the page's last state, then the
// fixture's stop, which is asked only once the snapshot has settled.
for (const [suite, { finalAndStop }, holder] of [['live_noise', noise, 'report'], ['live_recovery', recovery, 'record']])
  describe(`${suite}'s last snapshot of its page and its fixture's stop, after a pass or a failure`, () => {
    test(`a page that answers: the ${holder} keeps the snapshot exactly, the stop is asked once it has answered, and nothing is cut short`, async () => {
      const page = standInPage({ '*': 'answer' }), record = { font: 'Courier New' };
      await finalAndStop(page, record);
      assert.deepEqual(record, { font: 'Courier New', final: ANSWERS.final, readsCutShort: [] });
      assert.deepEqual(page.events, ['asked for final', 'final answers', 'asked for stop', 'stop answers']);
    });

    test('a snapshot that fails, at once or as the call is made: null, as it always was, and the stop is still asked', async () => {
      for (const way of ['reject', 'throws']) {
        const page = standInPage({ final: way, stop: 'answer' }), record = {};
        await finalAndStop(page, record);
        assert.deepEqual(record, { final: null, readsCutShort: [] }, way);
        assert.deepEqual(page.events.at(-2), 'asked for stop', way);
      }
    });

    test('a snapshot that never answers: both are cut short at READ_LIMIT, and the stop is never asked', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const page = standInPage({ final: 'never', stop: 'answer' }), record = {};
      assert.equal(await settledAt(t, finalAndStop(page, record)), READ_LIMIT);
      assert.deepEqual(record, { final: null, readsCutShort: CUT_SHORT('final', 'stop') });
      assert.deepEqual(page.events, ['asked for final']);
    });

    test('a snapshot that answers late and a stop that never does share the one limit: the wait ends READ_LIMIT after it began', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const page = standInPage({ final: [READ_LIMIT / 2, 'answer'], stop: 'never' }), record = {};
      assert.equal(await settledAt(t, finalAndStop(page, record)), READ_LIMIT);
      assert.deepEqual(record, { final: ANSWERS.final, readsCutShort: CUT_SHORT('stop') });
      assert.deepEqual(page.events, ['asked for final', 'final answers', 'asked for stop']);
    });
  });

describe('external_replay\'s stop of its replay after a pass or a failure', () => {
  test('a stop that answers: the report keeps what it says it left, exactly, and nothing is cut short', async () => {
    const r = { browser: 'chromium' };
    await replay.stopReplay(standInPage({ closed: 'answer' }), r);
    assert.deepEqual(r, { browser: 'chromium', closed: ANSWERS.closed, readsCutShort: [] });
  });

  test('a stop that fails, at once or as the call is made: null, as it always was, so that nothing is checked', async () => {
    for (const way of ['reject', 'throws']) {
      const r = {};
      await replay.stopReplay(standInPage({ closed: way }), r);
      assert.deepEqual(r, { closed: null, readsCutShort: [] }, way);
    }
  });

  test('a stop that never answers: null after READ_LIMIT, and named', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const r = {};
    assert.equal(await settledAt(t, replay.stopReplay(standInPage({ closed: 'never' }), r)), READ_LIMIT);
    assert.deepEqual(r, { closed: null, readsCutShort: CUT_SHORT('closed') });
  });
});

// How a process ends that runs `args`: its exit code, whether the bound had
// to end it, and what it printed. These runs take a second or so; the bound
// allows for a host short of memory.
const finish = (args, options) => new Promise((resolve) => execFile(process.execPath, args, { timeout: 45000, ...options },
  (error, stdout, stderr) => resolve({ code: error ? error.code ?? error.signal : 0, killed: error?.killed ?? false, stdout, stderr })));

// What stands in for Python's server, which serve() starts: Node's, answering
// every request, on a port the system picks, in this process's temporary
// directory, outside the run's tree.
const SERVER = `require("node:http").createServer((request, response) => response.end())
  .listen(0, "127.0.0.1", function () { console.log("port", this.address().port); });`;

// What each run loads first: that server for serve()'s spawn, and timers of
// READ_LIMIT's and CLOSE_LIMIT's lengths that last a tenth of a second and
// are counted, the counts printed as the process exits. Nothing else such a
// run starts sets a timer of either length: each catch or finally that reads
// the page sets one of READ_LIMIT's, and each browser's close one of
// CLOSE_LIMIT's, so that reads given any other limit, or a limit each, fail
// on the count.
const PRELOAD = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { ...options, cwd: ${JSON.stringify(os.tmpdir())} });
const { setTimeout: later } = globalThis, limits = { ${READ_LIMIT}: 0, ${CLOSE_LIMIT}: 0 };
globalThis.setTimeout = (run, ms, ...args) => { if (Object.hasOwn(limits, ms)) { limits[ms]++; ms = 100; } return later(run, ms, ...args); };
process.on("exit", () => console.log("limits", JSON.stringify(limits)));
`;

// The steps of the four suites whose finally reads, as a page that plays them
// through to a pass answers them: what a page.evaluate() of each source
// (whitespace taken out) resolves to, and what the handle of a
// page.waitForFunction() whose predicate holds each part resolves to; any
// other step resolves to nothing, or to true. live_noise's board has 22 clues
// and its changed board a 3 in cell 1, and the camera reads back its own
// frames (no bitmaps); live_motion's reading is the board it gives its page,
// as its source has it; live_recovery's first reading flags the blurred clue
// (cell 52), its re-read of that clue alone keeps every other cell, and in
// its race the changed puzzle is read again; external_replay's reading flags
// every cell.
const BOARD = Array.from({ length: 81 }, (_, cell) => (cell < 22 ? cell % 9 + 1 : null));
const CHANGED = BOARD.map((value, cell) => (cell === 1 ? 3 : value));
const MOTION_BOARD = JSON.parse(`[${/const expected = \[([\s\S]*?),?\s*\]\.flat\(\);/.exec(source('live_motion_regressions.cjs'))[1]}]`).flat();
const RECOVERY_READ = { cells: BOARD, uncertain: [52], marked: [52], stats: { calls: 81 } };
const PLAYED = {
  '()=>noiseState.error': null, '()=>externalReplay.error': null, '()=>externalReplay.capture()': false,
  '()=>externalReplay.report()': { reads: [{ cells: Array(81).fill(5), uncertain: Array.from({ length: 81 }, (_, cell) => cell) }] },
  '()=>motionState.playback()': { started: true, error: null },
  '()=>({reads:motionState.reads,cancels:motionState.cancels,unknown:motionOutput.dataset.unknown})': { reads: 1, cancels: 0, unknown: '0' },
  '()=>motionState.camera.capture().found': null, '()=>motionState.reads': 1,
  '()=>motionState.camera.capture().found?.puzzle.cells[1]===8': false,
  '()=>recoveryState.startError??null': null, '()=>recoveryState.retries.length': 0,
  "()=>recoveryState.events.find(e=>e.reason==='read-complete')?.seq??0": 1,
  'since=>({resets:recoveryState.resetsSince(since),reads:recoveryState.full.length})': { resets: [], reads: 1 },
  '()=>{recoveryState.clear();returnrecoveryState.seq;}': 2, '()=>recoveryState.snapshot()': { capture: null },
};
const READING = (cells, reads) => ({ found: { cells, type: 'sudoku', review: true, refining: false, uncertain: [] }, expected: cells,
  reads, completed: reads, diagnostic: { tracking: { transport: 'readback' }, events: reads > 1 ? [{ reason: 'content-changed' }] : [] } });
const WAITED = [['if(!noiseState.completed)', READING(BOARD, 1)], ['noiseState.witness()[0]-172', { found: null }],
  ['noiseState.completed>=2', READING(CHANGED, 2)], ['returnv.found?v:false', READING(BOARD, 1)],
  ['returnvalue.cells?value:false', { cells: MOTION_BOARD, review: true, refining: false, reads: 1, cancels: 0, unknown: '0' }],
  ['!recoveryState.full.length||', { full: [RECOVERY_READ] }],
  ["'targeted-complete')||", { full: [RECOVERY_READ], retries: [{ cells: [52], result: { stats: { calls: 1 } } }],
    capture: { cells: BOARD, uncertain: [52], needsReview: true, recovery: { proposals: 1 } }, expected: BOARD }],
  ['{if(!recoveryState.visible())', { full: [RECOVERY_READ] }],
  ['recoveryState.full.length<2', { full: [RECOVERY_READ, RECOVERY_READ], events: [{ reason: 'content-changed' }],
    capture: { cells: BOARD.map((value, cell) => ({ 13: 7, 14: 9 })[cell] ?? value) } }]];

// Playwright for the six suites: each engine's page fails the suite's first
// step in its try, the first page.evaluate() that is none of the reads above,
// or with PLAY plays the suite's steps through to a pass; then it answers
// those reads as PLAN says, by name (NAMES; "*" for the rest): "answer"
// (ANSWERS), { answer } for that answer, "reject" at once or "never". The
// page says on stdout what it is asked for and when it takes a screenshot,
// the browser when it closes. With BROWSER_HANGS, Chromium's browser never
// closes, as while a WebKit child holds the browser's pipes; with REFUSE,
// Chromium's newPage() rejects, so that its engine has no page; with UNREADY,
// the page never gets ready (waitForSelector() rejects); with
// SHOT_FAILS, every screenshot fails as it is taken. Each launch keeps the
// process alive until its browser closes, as a live browser's pipes do.
const PLAYWRIGHT = `const fs = require("node:fs");
const { PLAN, PLAY, BROWSER_HANGS, REFUSE, UNREADY, SHOT_FAILS } = process.env, plan = JSON.parse(PLAN);
const NAMES = ${JSON.stringify(NAMES)}, ANSWERS = ${JSON.stringify(ANSWERS)};
const PLAYED = ${JSON.stringify(PLAYED)}, WAITED = ${JSON.stringify(WAITED)};
const engine = (name) => ({ async launch() {
  const pipes = setInterval(() => {}, 1000), say = (line) => console.log(name + " " + line);
  const read = (what) => {
    const way = plan[what] ?? plan["*"];
    say("is asked for " + what);
    if (way === "reject") return Promise.reject(new Error("Target page, context or browser has been closed"));
    if (way === "never") return new Promise(() => {});
    return Promise.resolve(way === "answer" ? ANSWERS[what] : way.answer);
  };
  const source = (fn) => String(fn).replace(/\\s+/g, "");
  const page = { on() {}, setDefaultTimeout() {}, url: () => "http://stand-in/", goto: async () => {},
    waitForSelector: async () => { if (UNREADY) throw new Error("the page never became ready"); },
    click: async () => {},
    evaluate: async (fn) => {
      const what = NAMES[source(fn)];
      if (what) return read(what);
      if (!PLAY) throw new Error("no site here");
      return PLAYED[source(fn)];
    },
    waitForFunction: async (fn) => {
      const value = WAITED.find(([part]) => source(fn).includes(part))?.[1] ?? true;
      return { jsonValue: async () => value, dispose: async () => {} };
    },
    locator: (selector) => ({ innerText: () => read(NAMES["locator " + selector + " innerText"]) }),
    screenshot: async ({ path }) => {
      say("takes a screenshot");
      if (SHOT_FAILS) throw new Error("the screenshot timed out");
      fs.writeFileSync(path, "");
    } };
  return { contexts: () => [], on() {}, isConnected: () => true, version: () => "1.0",
    close: async () => {
      say("closes its browser");
      if (name === "chromium" && BROWSER_HANGS) return new Promise(() => {});
      clearInterval(pipes);
    },
    newContext: async () => ({ on() {}, newPage: async () => {
      if (name === "chromium" && REFUSE) throw new Error("newPage refused");
      return page;
    } }) };
} });
module.exports = { chromium: engine("chromium"), webkit: engine("webkit") };
`;

// external_replay's three fixtures as replayFixtures() checks them: the two
// it requires, by name and hash, and one more, at the revision it pins, each
// with a grid annotated empty.
const REPLAY_SOURCE = fs.readFileSync(new URL('../../scripts/external_replay_regressions.cjs', import.meta.url), 'utf8');
const FIXTURES = JSON.stringify({
  revision: /ACQUISITION_REVISION='([0-9a-f]{40})'/.exec(REPLAY_SOURCE)[1],
  fixtures: [...[...REPLAY_SOURCE.matchAll(/'(images\/\w+\.webp)':'([0-9a-f]{64})'/g)].map(([, name, sha256]) => ({ name, sha256 })),
    { name: 'images/another.webp', sha256: '0'.repeat(64) }].map((fixture) => ({ ...fixture, data: 'data:image/webp;base64,',
    cells: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => Array(10).fill(0))) })),
});

// The six suites: what each reads in its catch and in its finally, in the
// order asked (each one readWithin() call), the fields its report keeps of
// those reads, each with the fallback a failed read gives it (none for
// browser_smoke's), how many times it runs both engines, and where an
// engine's report keeps the reads (live_recovery's in its scene's record).
// `chained`: its stop is asked only once its snapshot has settled. `own`:
// it launches its browsers itself, and fails with ok: false. `shotOnPass`: it
// takes a screenshot in its try, which a pass reaches before its finally.
const SUITES = {
  live_motion: { script: 'scripts/live_motion_regressions.cjs', file: 'browser-artifacts/live-motion.json',
    reads: { catch: ['state'], finally: ['stop'] }, kept: { state: null }, shotOnPass: true },
  live_noise: { script: 'scripts/live_noise_regressions.cjs', file: 'browser-artifacts/live-noise.json',
    reads: { finally: ['final', 'stop'] }, kept: { final: null }, chained: true, shotOnPass: true },
  live_recovery: { script: 'scripts/live_recovery_regressions.cjs', file: 'browser-artifacts/live-recovery.json',
    reads: { finally: ['final', 'stop'] }, kept: { final: null }, chained: true, runs: 2, holder: (report) => report.cases[0] },
  external_replay: { script: 'scripts/external_replay_regressions.cjs', file: 'browser-artifacts/external-replay.json',
    reads: { finally: ['closed'] }, kept: { closed: null }, runs: 3, write: { 'live-fixtures/fixtures.json': FIXTURES } },
  solver_update: { script: 'scripts/solver_update_regressions.cjs', file: 'browser-artifacts/solver-update-regressions.json',
    reads: { catch: ['results', 'workerDebug'] }, kept: { results: null, workerDebug: null }, own: true, copy: ['web/sw.js', 'web/offline.js'] },
  browser_smoke: { script: 'scripts/browser_smoke.cjs', file: 'browser-artifacts/results.json',
    reads: { catch: ['status', 'state'] }, kept: { status: undefined, state: undefined }, own: true, screenshotFirst: true },
};

// How `suite` ends, run as it is with PRELOAD loaded first, in a tree of its
// own with the harness and watch.cjs as they are and PLAYWRIGHT for
// Playwright, which is its working and temporary directory: what it printed,
// the counts of its limits' timers and its engines' reports.
async function ran(t, suite, env) {
  const { script, file, copy = [], write = {} } = SUITES[suite];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-suite-reads-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inTree = (name) => path.join(directory, name);
  for (const name of [script, 'scripts/harness.cjs', 'scripts/watch.cjs', ...copy])
    fs.cpSync(new URL(`../../${name}`, import.meta.url), inTree(name));
  for (const [name, text] of Object.entries(write)) {
    fs.mkdirSync(path.dirname(inTree(name)), { recursive: true });
    fs.writeFileSync(inTree(name), text);
  }
  fs.mkdirSync(inTree('_site')); // What serve() links for browser_smoke.
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), PLAYWRIGHT);
  fs.writeFileSync(inTree('preload.cjs'), PRELOAD);
  const flags = Object.fromEntries(['PLAY', 'BROWSER_HANGS', 'REFUSE', 'UNREADY', 'SHOT_FAILS'].map((flag) => [flag, env[flag] ? '1' : '']));
  const ended = await finish(['-r', inTree('preload.cjs'), inTree(script)], { cwd: directory,
    env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, BROWSER_ENGINES: '', PLAN: JSON.stringify(env.PLAN), ...flags } });
  const lines = ended.stdout.trim().split(/\r?\n/), limits = /^limits (.+)$/.exec(lines.at(-1));
  const reports = fs.existsSync(inTree(file)) ? JSON.parse(fs.readFileSync(inTree(file), 'utf8')) : null;
  return { ...ended, lines, limits: limits && JSON.parse(limits[1]), reports };
}

// What a report keeps of an answer: one that is undefined leaves no field in
// the report's JSON, as it always has.
const kept = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const wayOf = (plan, name) => plan[name] ?? plan['*'];
// The engines a suite runs, in order, `runs` times over.
const enginesOf = (runs = 1) => Array.from({ length: runs }, () => ['chromium', 'webkit']).flat();
// What the stand-in says that `engine`'s page and browser were asked, in order.
const said = (lines, engine) => lines.filter((line) => line.startsWith(`${engine} `) && !/^\w+ \d/.test(line))
  .map((line) => line.slice(engine.length + 1));
// Which of `names` a report has as its own fields.
const fieldsOf = (report, names) => names.filter((name) => Object.hasOwn(report, name));

// Runs `suite` as `env` says and checks how it ended: by itself, with its
// own failure in each engine's report, or with every engine passed when it
// plays its steps through (env.PLAY); each read's answer or fallback and the
// reads cut short, and no field for a read of the catch after a pass; each
// read asked once, in the suite's order, before the harness's failure
// screenshot (after browser_smoke's own, and after the screenshot that
// live_motion and live_noise take in their try when they pass), and the
// browser's close last; and one limit's timer for each catch or finally
// that reads, in each engine, and one for each browser's close.
async function check(t, suite, env) {
  const { reads: { catch: caught, finally: last }, kept: fields, runs = 1, holder = (report) => report, chained, own,
    screenshotFirst, shotOnPass } = SUITES[suite];
  const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, suite, env);
  assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
  assert.equal(code, env.PLAY ? 0 : 1, stderr);
  assert.ok(reports, `its reports written: ${stdout}`);
  const engines = enginesOf(runs);
  assert.deepEqual(reports.map((report) => [report.browser, own ? report.ok : report.status, report.failure?.split('\n')[0],
    report.cleanupErrors]), engines.map((name) => [name, env.PLAY ? 'passed' : own ? false : 'failed',
    env.PLAY ? undefined : 'Error: no site here', name === 'chromium' && env.BROWSER_HANGS ? ['browser: browser cleanup timed out'] : []]),
  env.PLAY ? 'every engine passed' : 'the suite\'s own failure, kept');
  // The reads of the catch come only after a failure, those of the finally
  // after a pass too: one readWithin() call each. What each read leaves, its
  // answer or its fallback, and the reads still waiting at the limit: those
  // that never answer, and a stop asked only once a snapshot that never
  // answers has settled.
  const blocks = [env.PLAY ? undefined : caught, last].filter(Boolean), asked = [], cut = [], values = {};
  for (const block of blocks)
    for (const [n, name] of block.entries()) {
      const behind = chained && n > 0 && wayOf(env.PLAN, block[0]) === 'never', waits = behind || wayOf(env.PLAN, name) === 'never';
      if (!behind) asked.push(name);
      if (waits) cut.push(name);
      if (Object.hasOwn(fields, name)) values[name] = waits || wayOf(env.PLAN, name) === 'reject' ? fields[name] : kept(ANSWERS[name]);
    }
  for (const report of reports) {
    const record = holder(report);
    for (const [name, value] of Object.entries(values))
      assert.deepEqual(record[name], value, `${report.browser}'s ${name}`);
    assert.deepEqual(fieldsOf(record, Object.keys(fields).filter((name) => !Object.hasOwn(values, name))), [],
      `${report.browser}'s fields of reads never made`);
    assert.deepEqual(record.readsCutShort, CUT_SHORT(...cut), `${report.browser}'s reads cut short`);
  }
  // After a failure the harness takes its screenshot once the reads have
  // ended, browser_smoke takes its own before them and solver_update none.
  const before = (env.PLAY ? shotOnPass : screenshotFirst) ? ['takes a screenshot'] : [];
  const after = env.PLAY || own ? [] : ['takes a screenshot'];
  for (const name of ['chromium', 'webkit'])
    assert.deepEqual(said(lines, name), Array.from({ length: runs }, () => [...before, ...asked.map((read) => `is asked for ${read}`),
      ...after, 'closes its browser']).flat(), stdout);
  assert.deepEqual(limits, { [READ_LIMIT]: blocks.length * engines.length, [CLOSE_LIMIT]: engines.length },
    'one limit for each catch\'s or finally\'s reads in each engine, and one for each browser\'s close');
  assert.doesNotMatch(stderr, /no answer within/, 'the reads cut short are the report\'s, not stderr\'s');
}

// Side by side: each has a tree and a process of its own, and in Node 22
// --test-timeout limits a whole file.
describe('the six suites, run as they are, read their page after their failure and then fail with it', { concurrency: true }, () => {
  const rows = [
    ['every read answers', { '*': 'answer' }],
    ['every read fails', { '*': 'reject' }],
    ['no read answers', { '*': 'never' }],
  ];
  const more = {
    live_motion: [['the state answers and the stop never does', { state: 'answer', stop: 'never' }]],
    live_noise: [['the snapshot answers and the stop never does', { final: 'answer', stop: 'never' }]],
    live_recovery: [['the snapshot fails and the stop never answers', { final: 'reject', stop: 'never' }]],
    external_replay: [],
    solver_update: [['the results never come and the worker\'s debug does', { results: 'never', workerDebug: 'answer' }]],
    browser_smoke: [['the status never comes and the state does', { status: 'never', state: 'answer' }]],
  };
  for (const suite of Object.keys(SUITES)) {
    for (const [what, PLAN] of [...rows, ...more[suite]])
      test(`${suite} ends by itself with its reports and their reads when ${what}`, (t) => check(t, suite, { PLAN }));
    // As in the WebKit hang: nothing answers and the browser will not close.
    test(`${suite} ends by itself with its reports and their reads when no read answers and the browser will not close`,
      (t) => check(t, suite, { PLAN: { '*': 'never' }, BROWSER_HANGS: true }));
  }

  test('external_replay still checks what a stop that answers says it left: a replay left running fails its engine, as it always has', async (t) => {
    const { code, killed, stderr, reports } = await ran(t, 'external_replay',
      { PLAN: { closed: { answer: { active: true, retainedSources: 0, scratchPixels: 0 } } } });
    assert.equal(killed, false, `it ended by itself: ${stderr}`);
    assert.equal(code, 1, stderr);
    for (const report of reports) {
      assert.deepEqual([report.closed, report.readsCutShort], [{ active: true, retainedSources: 0, scratchPixels: 0 }, []]);
      assert.match(report.failure, /^AssertionError \[ERR_ASSERTION\]: Expected values to be strictly equal:\n\ntrue !== false/);
    }
  });
});

// The reads of a finally run after a pass too, and a read cut short there
// keeps the pass, as one that fails does: live_motion's stop, live_noise's
// and live_recovery's last snapshot and their stop, and external_replay's
// stop, then left unchecked.
describe('the four suites whose finally reads, run as they are through a pass', { concurrency: true }, () => {
  for (const suite of ['live_motion', 'live_noise', 'live_recovery', 'external_replay'])
    for (const [what, PLAN] of [['every read answers', { '*': 'answer' }], ['every read fails', { '*': 'reject' }],
      ['no read answers', { '*': 'never' }]])
      test(`${suite} passes, with its reads, when ${what}`, (t) => check(t, suite, { PLAN, PLAY: true }));
});

// Engines that never reach the reads, so that their reports have none of the
// reads' fields and no readsCutShort: one with no page, since Chromium's
// newPage() rejects, in the two suites that open their pages themselves; a
// failure screenshot that fails in browser_smoke, which reads its page only
// once that screenshot is taken; and a page that never gets ready, which
// live_noise, live_recovery (whose scene then has no record) and
// external_replay wait for before their try, and live_motion inside it, so
// that live_motion alone still reads it.
describe('the six suites, run as they are, when an engine has no page, its failure\'s screenshot fails or its page never gets ready', { concurrency: true }, () => {
  for (const suite of ['solver_update', 'browser_smoke'])
    test(`${suite} reads nothing in an engine whose page would not open, and has no readsCutShort there`, async (t) => {
      const { reads: { catch: names }, screenshotFirst } = SUITES[suite];
      const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, suite, { PLAN: { '*': 'answer' }, REFUSE: true });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      assert.deepEqual(reports.map((report) => [report.browser, report.ok, report.failure?.split('\n')[0]]),
        [['chromium', false, 'Error: newPage refused'], ['webkit', false, 'Error: no site here']]);
      const [chromium, webkit] = reports;
      assert.deepEqual(fieldsOf(chromium, [...names, 'readsCutShort']), [], 'nothing read where there is no page');
      assert.deepEqual([...names.map((name) => webkit[name]), webkit.readsCutShort], [...names.map((name) => kept(ANSWERS[name])), []],
        'the next engine reads its page');
      assert.deepEqual(said(lines, 'chromium'), ['closes its browser'], stdout);
      assert.deepEqual(said(lines, 'webkit'), [...(screenshotFirst ? ['takes a screenshot'] : []),
        ...names.map((name) => `is asked for ${name}`), 'closes its browser'], stdout);
      assert.deepEqual(limits, { [READ_LIMIT]: 1, [CLOSE_LIMIT]: 2 });
    });

  test('browser_smoke reads nothing of a page whose failure\'s screenshot fails, as ever, and has no readsCutShort then', async (t) => {
    const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, 'browser_smoke', { PLAN: { '*': 'answer' }, SHOT_FAILS: true });
    assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
    assert.equal(code, 1, stderr);
    for (const report of reports) {
      assert.equal(report.failure?.split('\n')[0], 'Error: no site here', report.browser);
      assert.deepEqual(fieldsOf(report, ['status', 'state', 'readsCutShort']), [], report.browser);
    }
    for (const name of ['chromium', 'webkit'])
      assert.deepEqual(said(lines, name), ['takes a screenshot', 'closes its browser'], stdout);
    assert.deepEqual(limits, { [READ_LIMIT]: 0, [CLOSE_LIMIT]: 2 });
  });

  for (const suite of ['live_motion', 'live_noise', 'live_recovery', 'external_replay'])
    test(`${suite} ${suite === 'live_motion' ? 'still reads a page that never gets ready, which its try waits for' :
      'reads nothing of a page that never gets ready, which it waits for before its try, and has no readsCutShort then'}`, async (t) => {
      const { reads: { catch: caught = [], finally: last }, runs = 1 } = SUITES[suite], reached = suite === 'live_motion';
      const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, suite, { PLAN: { '*': 'answer' }, UNREADY: true });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      const engines = enginesOf(runs), names = reached ? [...caught, ...last] : [];
      assert.deepEqual(reports.map((report) => [report.browser, report.status, report.failure?.split('\n')[0], report.cleanupErrors]),
        engines.map((name) => [name, 'failed', 'Error: the page never became ready', []]));
      for (const report of reports) {
        const fields = fieldsOf(report, ['state', 'final', 'closed', 'readsCutShort']);
        assert.deepEqual(Object.fromEntries(fields.map((name) => [name, report[name]])),
          reached ? { state: kept(ANSWERS.state), readsCutShort: [] } : {}, report.browser);
        if (suite === 'live_recovery') assert.deepEqual(report.cases, [], 'no record of a scene that never began');
      }
      for (const name of ['chromium', 'webkit'])
        assert.deepEqual(said(lines, name), Array.from({ length: runs }, () => [...names.map((read) => `is asked for ${read}`),
          'takes a screenshot', 'closes its browser']).flat(), stdout);
      assert.deepEqual(limits, { [READ_LIMIT]: reached ? 2 * engines.length : 0, [CLOSE_LIMIT]: engines.length });
    });
});
