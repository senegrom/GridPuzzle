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
// on a stand-in page, with the reads of their finally that were cut short
// (readsCutShort) and those that failed (readsFailed), and external_replay's
// checks of what its stop says it left (checkClosed()), after a failed step
// and a passed one; then each of the six run as it is, in a process of its
// own, on a stand-in for Playwright whose page fails the suite's first step
// in its try, and then answers those reads, fails them or never answers;
// external_replay with its stop saying that it left the replay running, a
// source retained or scratch pixels, after steps that fail, whose own
// failure each engine keeps, after engines that passed as well, or pass,
// and saying nothing after steps that failed before the replay began; the
// four whose finally reads, played through to a pass, which a read cut short
// or failed there fails, in engines()' finally (harness.cjs) and with no
// failure screenshot, unless the page threw an uncaught error or crashed,
// which fails it first; live_recovery's scenes and external_replay's
// fixtures once one engine has failed that way, or at its first step; and
// engines that never reach those reads, with no page, a page that never gets
// ready or a failure's screenshot that fails. Loading watch.cjs or a suite
// needs no Playwright.
const require = createRequire(import.meta.url);
const { CLOSE_LIMIT, READ_LIMIT } = require('../../scripts/watch.cjs');
const motion = require('../../scripts/live_motion_regressions.cjs');
const noise = require('../../scripts/live_noise_regressions.cjs');
const recovery = require('../../scripts/live_recovery_regressions.cjs');
const replay = require('../../scripts/external_replay_regressions.cjs');
const tick = () => new Promise(setImmediate);
const CUT_SHORT = (...names) => names.map((name) => `${name}: no answer within ${READ_LIMIT / 1000} s`);
// How readsFailed names reads that failed with `message`.
const FAILED = (message, ...names) => names.map((name) => `${name}: ${message}`);
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
// was asked; a read that rejects or throws fails with ERRORS' message for
// that way. `events` lists in order what it was asked for and what settled.
const ERRORS = { reject: 'Target page, context or browser has been closed', throws: 'not a function' };
function standInPage(plan) {
  const events = [];
  const read = (name) => {
    const planned = plan[name] ?? plan['*'], [ms, way] = Array.isArray(planned) ? planned : [0, planned];
    events.push(`asked for ${name}`);
    if (way === 'throws') throw new Error(ERRORS.throws);
    if (way === 'never') return new Promise(() => {});
    const settle = (resolve, reject) => {
      events.push(`${name} ${way === 'answer' ? 'answers' : 'fails'}`);
      if (way === 'answer') resolve(ANSWERS[name]); else reject(new Error(ERRORS.reject));
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
  test('a page that answers: the report keeps the state exactly, and no read is cut short or failed', async () => {
    const page = standInPage({ '*': 'answer' }), report = { browser: 'webkit' };
    await motion.readAfterFailure(page, report);
    assert.deepEqual(report, { browser: 'webkit', state: ANSWERS.state, readsCutShort: [] });
    await motion.stopMotion(page, report);
    assert.deepEqual(report, { browser: 'webkit', state: ANSWERS.state, readsCutShort: [], readsFailed: [] });
    assert.deepEqual(page.events, ['asked for state', 'state answers', 'asked for stop', 'stop answers']);
  });

  // The catch's read is never named when it fails: the engine has failed
  // already, and its null says as much as it always did.
  test('a page that fails both, at once or as the call is made: the state is null, as it always was, nothing is cut short and the stop alone is named with its error', async () => {
    for (const way of ['reject', 'throws']) {
      const report = {};
      await motion.readAfterFailure(standInPage({ '*': way }), report);
      await motion.stopMotion(standInPage({ '*': way }), report);
      assert.deepEqual(report, { state: null, readsCutShort: [], readsFailed: FAILED(ERRORS[way], 'stop') }, way);
    }
  });

  test('a page that never answers: each waits READ_LIMIT, the state is null and both are named, the stop after the state', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const page = standInPage({ '*': 'never' }), report = {};
    assert.equal(await settledAt(t, motion.readAfterFailure(page, report)), READ_LIMIT);
    assert.deepEqual(report, { state: null, readsCutShort: CUT_SHORT('state') });
    assert.equal(await settledAt(t, motion.stopMotion(page, report)), READ_LIMIT);
    assert.deepEqual(report, { state: null, readsCutShort: CUT_SHORT('state', 'stop'), readsFailed: [] });
  });

  test('after a pass, a stop that never answers or fails is named on its own, in its list, and one that answers leaves both lists empty', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const passed = {}, stopped = {};
    assert.equal(await settledAt(t, motion.stopMotion(standInPage({ stop: 'never' }), passed)), READ_LIMIT);
    assert.deepEqual(passed, { readsCutShort: CUT_SHORT('stop'), readsFailed: [] });
    for (const way of ['reject', 'throws']) {
      const failed = {};
      await motion.stopMotion(standInPage({ stop: way }), failed);
      assert.deepEqual(failed, { readsCutShort: [], readsFailed: FAILED(ERRORS[way], 'stop') }, way);
    }
    await motion.stopMotion(standInPage({ stop: 'answer' }), stopped);
    assert.deepEqual(stopped, { readsCutShort: [], readsFailed: [] });
  });
});

// live_noise's and live_recovery's finally: the page's last state, then the
// fixture's stop, which is asked only once the snapshot has settled.
for (const [suite, { finalAndStop }, holder] of [['live_noise', noise, 'report'], ['live_recovery', recovery, 'record']])
  describe(`${suite}'s last snapshot of its page and its fixture's stop, after a pass or a failure`, () => {
    test(`a page that answers: the ${holder} keeps the snapshot exactly, the stop is asked once it has answered, and nothing is cut short or failed`, async () => {
      const page = standInPage({ '*': 'answer' }), record = { font: 'Courier New' };
      await finalAndStop(page, record);
      assert.deepEqual(record, { font: 'Courier New', final: ANSWERS.final, readsCutShort: [], readsFailed: [] });
      assert.deepEqual(page.events, ['asked for final', 'final answers', 'asked for stop', 'stop answers']);
    });

    test('a snapshot that fails, at once or as the call is made: null, as it always was, named with its error, and the stop is still asked', async () => {
      for (const way of ['reject', 'throws']) {
        const page = standInPage({ final: way, stop: 'answer' }), record = {};
        await finalAndStop(page, record);
        assert.deepEqual(record, { final: null, readsCutShort: [], readsFailed: FAILED(ERRORS[way], 'final') }, way);
        assert.deepEqual(page.events.at(-2), 'asked for stop', way);
      }
    });

    test('a snapshot that answers and a stop that fails, or both failing: each that failed is named with its error, in the order asked', async () => {
      const stopFails = {}, bothFail = {};
      await finalAndStop(standInPage({ final: 'answer', stop: 'reject' }), stopFails);
      assert.deepEqual(stopFails, { final: ANSWERS.final, readsCutShort: [], readsFailed: FAILED(ERRORS.reject, 'stop') });
      await finalAndStop(standInPage({ final: 'throws', stop: 'reject' }), bothFail);
      assert.deepEqual(bothFail, { final: null, readsCutShort: [], readsFailed: [...FAILED(ERRORS.throws, 'final'), ...FAILED(ERRORS.reject, 'stop')] });
    });

    test('a snapshot that never answers: both are cut short at READ_LIMIT, and the stop is never asked', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const page = standInPage({ final: 'never', stop: 'answer' }), record = {};
      assert.equal(await settledAt(t, finalAndStop(page, record)), READ_LIMIT);
      assert.deepEqual(record, { final: null, readsCutShort: CUT_SHORT('final', 'stop'), readsFailed: [] });
      assert.deepEqual(page.events, ['asked for final']);
    });

    test('a snapshot that answers late, or fails, and a stop that never does share the one limit: the wait ends READ_LIMIT after it began, and each is in its own list', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const page = standInPage({ final: [READ_LIMIT / 2, 'answer'], stop: 'never' }), record = {};
      assert.equal(await settledAt(t, finalAndStop(page, record)), READ_LIMIT);
      assert.deepEqual(record, { final: ANSWERS.final, readsCutShort: CUT_SHORT('stop'), readsFailed: [] });
      assert.deepEqual(page.events, ['asked for final', 'final answers', 'asked for stop']);
      const failing = standInPage({ final: [READ_LIMIT / 2, 'reject'], stop: 'never' }), failed = {};
      assert.deepEqual([await settledAt(t, finalAndStop(failing, failed)), failed, failing.events],
        [READ_LIMIT, { final: null, readsCutShort: CUT_SHORT('stop'), readsFailed: FAILED(ERRORS.reject, 'final') },
          ['asked for final', 'final fails', 'asked for stop']]);
    });
  });

// What external_replay's checks of what its stop says it left say when they
// fail, by the field each checks and the value the stop gave it, and how its
// report names them in stepCleanupErrors, `left` holding the fields that fail,
// in the order checked.
const LEFT = {
  active: (value) => `the stop must leave the replay inactive (active: ${value})`,
  retainedSources: (value) => `the stop must leave no retained sources (retainedSources: ${value})`,
  scratchPixels: (value) => `the stop must leave no scratch pixels (scratchPixels: ${value})`,
};
const NAMED = (left) => Object.entries(left).map(([field, value]) => `closed: ${LEFT[field](value)}`);
// What a stop says it left that fails one check, or all three.
const LEFTOVERS = [{ active: true }, { retainedSources: 1 }, { scratchPixels: 4096 }, { active: true, retainedSources: 2, scratchPixels: 307200 }];

describe('external_replay\'s stop of its replay, and its checks of what the stop says it left, after a pass or a failure', () => {
  test('a stop that answers: the report keeps what it says it left, exactly, and nothing is cut short or failed', async () => {
    const r = { browser: 'chromium' };
    await replay.stopReplay(standInPage({ closed: 'answer' }), r);
    assert.deepEqual(r, { browser: 'chromium', closed: ANSWERS.closed, readsCutShort: [], readsFailed: [] });
  });

  test('a stop that fails, at once or as the call is made: null, as it always was, so that nothing is checked, and named with its error', async () => {
    for (const way of ['reject', 'throws']) {
      const r = {};
      await replay.stopReplay(standInPage({ closed: way }), r);
      assert.deepEqual(r, { closed: null, readsCutShort: [], readsFailed: FAILED(ERRORS[way], 'closed') }, way);
    }
  });

  test('a stop that never answers: null after READ_LIMIT, and named', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const r = {};
    assert.equal(await settledAt(t, replay.stopReplay(standInPage({ closed: 'never' }), r)), READ_LIMIT);
    assert.deepEqual(r, { closed: null, readsCutShort: CUT_SHORT('closed'), readsFailed: [] });
  });

  // checkClosed(), which the finally calls once the stop has settled: false
  // after a step's own failure, true after steps that passed.
  test('after a step\'s own failure, each check of what the stop left that fails is named in stepCleanupErrors, with its own text, and nothing is thrown', () => {
    for (const left of LEFTOVERS) {
      const closed = { ...ANSWERS.closed, ...left }, r = { browser: 'chromium', closed };
      assert.doesNotThrow(() => replay.checkClosed(r, false), JSON.stringify(left));
      assert.deepEqual(r, { browser: 'chromium', closed, stepCleanupErrors: NAMED(left) }, JSON.stringify(left));
    }
  });

  test('after steps that passed, each check that fails is named as after a failure, and the first is thrown, an assertion with its own text', () => {
    for (const left of LEFTOVERS) {
      const closed = { ...ANSWERS.closed, ...left }, r = { closed }, [first] = Object.keys(left);
      assert.throws(() => replay.checkClosed(r, true), { name: 'AssertionError', code: 'ERR_ASSERTION', message: LEFT[first](left[first]) },
        JSON.stringify(left));
      assert.deepEqual(r, { closed, stepCleanupErrors: NAMED(left) }, JSON.stringify(left));
    }
  });

  // Compared as assert.equal() compared them: 0 is not false, "0" not 0 and
  // null not 0, and a string is shown in quotes.
  test('a stop that answers with none of the three, or with values of another kind: each check fails, saying what the stop gave, after a failure or a pass', () => {
    for (const stepsPassed of [false, true])
      for (const [closed, left] of [[{ view: 'live' }, { active: undefined, retainedSources: undefined, scratchPixels: undefined }],
        [{ active: 0, retainedSources: '0', scratchPixels: null }, { active: 0, retainedSources: '"0"', scratchPixels: null }]]) {
        const r = { closed }, check = () => replay.checkClosed(r, stepsPassed);
        if (stepsPassed) assert.throws(check, { message: LEFT.active(left.active) });
        else assert.doesNotThrow(check);
        assert.deepEqual(r.stepCleanupErrors, NAMED(left), JSON.stringify(closed));
      }
  });

  // A stop that answers nothing (undefined), as the page's does when a step
  // failed before the replay began, leaves nothing to check either.
  test('a clean, inactive replay, a stop that gave no answer (null) and one that answered nothing (undefined) name nothing and throw nothing, after a failure or a pass', () => {
    for (const stepsPassed of [false, true])
      for (const closed of [ANSWERS.closed, null, undefined]) {
        const r = { closed };
        assert.doesNotThrow(() => replay.checkClosed(r, stepsPassed), `${closed && 'clean'}, ${stepsPassed}`);
        assert.deepEqual(r, { closed }, 'no list made for nothing');
      }
  });

  test('the list keeps what is in it already', () => {
    const r = { closed: { ...ANSWERS.closed, scratchPixels: 1 }, stepCleanupErrors: ['camera: earlier'] };
    assert.doesNotThrow(() => replay.checkClosed(r, false));
    assert.deepEqual(r.stepCleanupErrors, ['camera: earlier', ...NAMED({ scratchPixels: 1 })]);
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

// What a read that the stand-in below fails rejects with.
const READ_ERROR = 'stand-in: the read failed';
// Playwright for the six suites: each engine's page fails the suite's first
// step in its try, the first page.evaluate() that is none of the reads above,
// or with PLAY plays the suite's steps through to a pass; then it answers
// those reads as PLAN says, by name (NAMES; "*" for the rest): "answer"
// (ANSWERS), { answer } for that answer, "reject" at once, with READ_ERROR,
// or "never". READ_ERROR does not say that its target is gone, as a page
// function's own error does not, so that engines() does not wait for news of
// a lost browser before it fails an engine on it. With PLAN a list, each
// launch, in order, takes the next entry, { plan, play }, for PLAN and PLAY,
// so that one engine of one scene or fixture can fail, or cut its reads
// short or see them fail, while the others pass. The
// page says on stdout what it is asked for and when it takes a screenshot,
// the browser when it closes. With BROWSER_HANGS, Chromium's browser never
// closes, as while a WebKit child holds the browser's pipes; with REFUSE,
// Chromium's newPage() rejects, so that its engine has no page; with UNREADY,
// the page never gets ready (waitForSelector() rejects); with
// SHOT_FAILS, every screenshot fails as it is taken; with EVENT, the page
// throws an uncaught error ("pageerror") or crashes ("crash") as the first
// of those reads is asked, which watch() hears, since the browser and its
// context tell it of the context and the page as they open, as Playwright's
// do; and PLAYED_OVER replaces some answers of PLAYED, by source. Each launch
// keeps the process alive until its browser closes, as a live browser's
// pipes do.
const PLAYWRIGHT = `const fs = require("node:fs");
const { PLAN, PLAY, BROWSER_HANGS, REFUSE, UNREADY, SHOT_FAILS, EVENT, PLAYED_OVER } = process.env, plans = JSON.parse(PLAN);
const NAMES = ${JSON.stringify(NAMES)}, ANSWERS = ${JSON.stringify(ANSWERS)};
const PLAYED = { ...${JSON.stringify(PLAYED)}, ...JSON.parse(PLAYED_OVER || "{}") }, WAITED = ${JSON.stringify(WAITED)};
// The listeners on() adds, by event, and emit(), which calls them.
const events = () => {
  const listeners = {};
  return { on: (event, listener) => { (listeners[event] ??= []).push(listener); }, off() {},
    emit: (event, ...args) => { for (const listener of listeners[event] ?? []) listener(...args); } };
};
let launches = 0;
const engine = (name) => ({ async launch() {
  const { plan, play } = Array.isArray(plans) ? plans[launches++] : { plan: plans, play: PLAY };
  const pipes = setInterval(() => {}, 1000), say = (line) => console.log(name + " " + line);
  const browserEvents = events(), contextEvents = events(), pageEvents = events();
  let happened = false;
  const read = (what) => {
    const way = plan[what] ?? plan["*"];
    say("is asked for " + what);
    if (EVENT && !happened) {
      happened = true;
      pageEvents.emit(EVENT, EVENT === "pageerror" ? new Error("stand-in: an uncaught page error") : page);
    }
    if (way === "reject") return Promise.reject(new Error(${JSON.stringify(READ_ERROR)}));
    if (way === "never") return new Promise(() => {});
    return Promise.resolve(way === "answer" ? ANSWERS[what] : way.answer);
  };
  const source = (fn) => String(fn).replace(/\\s+/g, "");
  const page = { on: pageEvents.on, setDefaultTimeout() {}, url: () => "http://stand-in/", goto: async () => {},
    waitForSelector: async () => { if (UNREADY) throw new Error("the page never became ready"); },
    click: async () => {},
    evaluate: async (fn) => {
      const what = NAMES[source(fn)];
      if (what) return read(what);
      if (!play) throw new Error("no site here");
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
  return { contexts: () => [], on: browserEvents.on, off: browserEvents.off, isConnected: () => true, version: () => "1.0",
    close: async () => {
      say("closes its browser");
      if (name === "chromium" && BROWSER_HANGS) return new Promise(() => {});
      clearInterval(pipes);
    },
    newContext: async () => {
      const context = { on: contextEvents.on, pages: () => [], newPage: async () => {
        if (name === "chromium" && REFUSE) throw new Error("newPage refused");
        contextEvents.emit("page", page);
        return page;
      } };
      browserEvents.emit("context", context);
      return context;
    } };
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
// engine's report keeps the reads (live_recovery's in its scene's record,
// whose two lists the engine's report has as well). A suite with a finally
// names the reads that failed there in readsFailed; none names those of its
// catch that failed. `chained`: its stop is asked only once its snapshot has
// settled. `own`: it launches its browsers itself, and fails with ok: false.
// `shotOnPass`: it takes a screenshot in its try, which a pass reaches
// before its finally.
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
    env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, BROWSER_ENGINES: '', PLAN: JSON.stringify(env.PLAN),
      EVENT: env.EVENT ?? '', PLAYED_OVER: JSON.stringify(env.PLAYED ?? {}), ...flags } });
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

// The failure of an engine whose steps passed and whose finally then cut
// short the reads `cut` and saw the reads `failed` fail (with READ_ERROR):
// after the engine's name, every one of them as readsCutShort and then
// readsFailed spell them, each list in the order asked.
const READS_FAILURE = (engine, cut, failed = []) => `Error: ${engine}: ${[...CUT_SHORT(...cut), ...FAILED(READ_ERROR, ...failed)].join('; ')}`;
// The uncaught error the stand-in's page throws (EVENT "pageerror").
const PAGE_ERROR = 'stand-in: an uncaught page error';
// The failure of an engine whose steps passed and whose page threw an
// uncaught error, or crashed, as the first read of its finally was asked,
// whatever that finally then cut short: engines()' own check, after what
// ended when the page crashed, as when the browser's close fails too.
const EVENT_FAILURE = {
  pageerror: (engine) => `AssertionError [ERR_ASSERTION]: ${engine}: uncaught page errors`,
  crash: (engine) => `page crashed N s after launch (http://stand-in/)\nAssertionError [ERR_ASSERTION]: ${engine}: a page crashed or closed, or the browser disconnected`,
};
// An engine's failure up to its first line, after the line that says what
// ended, which leads it then (watch()'s lead()), its seconds since launch as N.
const headOf = (failure) => {
  if (failure === undefined) return undefined;
  const lines = failure.split('\n'), first = lines.findIndex((line) => !/ s after launch( \(.+\))?$/.test(line));
  return lines.slice(0, first + 1).join('\n').replace(/ \d+(\.\d+)? s after launch/g, ' N s after launch');
};

// Runs `suite` as `env` says and checks how it ended: by itself, with its
// own failure in each engine's report, or with every engine passed when it
// plays its steps through (env.PLAY), unless its finally then cut a read
// short or saw one fail, which fails each engine in engines()' finally with
// the names of those reads (READS_FAILURE), printed on stderr, with no
// failure screenshot, or, when its page threw an uncaught error or crashed
// (env.EVENT), with that (EVENT_FAILURE), asking for a screenshot; each read's
// answer or fallback, the reads cut short and those of the finally that
// failed, on the engine's report too where a scene's record keeps them, and
// no field for a read of the catch after a pass; the page's errors and what
// ended; each read asked once, in the suite's order, before the harness's
// failure screenshot (after browser_smoke's own, and after the screenshot
// that live_motion and live_noise take in their try when they pass), and the
// browser's close last; and one limit's timer for each catch or finally that
// reads, in each engine, and one for each browser's close.
async function check(t, suite, env) {
  const { reads: { catch: caught, finally: last }, kept: fields, runs = 1, holder = (report) => report, chained, own,
    screenshotFirst, shotOnPass } = SUITES[suite];
  const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, suite, env);
  // The reads of the catch come only after a failure, those of the finally
  // after a pass too: one readWithin() call each. What each read leaves, its
  // answer or its fallback; the reads still waiting at the limit: those that
  // never answer, and a stop asked only once a snapshot that never answers
  // has settled; and the reads of the finally that failed.
  const blocks = [env.PLAY ? undefined : caught, last].filter(Boolean), asked = [], cut = [], failed = [], values = {};
  for (const block of blocks)
    for (const [n, name] of block.entries()) {
      const behind = chained && n > 0 && wayOf(env.PLAN, block[0]) === 'never', waits = behind || wayOf(env.PLAN, name) === 'never';
      if (!behind) asked.push(name);
      if (waits) cut.push(name);
      else if (block === last && wayOf(env.PLAN, name) === 'reject') failed.push(name);
      if (Object.hasOwn(fields, name)) values[name] = waits || wayOf(env.PLAN, name) === 'reject' ? fields[name] : kept(ANSWERS[name]);
    }
  // After a pass only the finally reads, so that `cut` and `failed` are what
  // it cut short and saw fail; a page error or a crash, which comes as the
  // first of them is asked, fails the engine first.
  const readsFail = env.PLAY && !env.EVENT && cut.length + failed.length > 0, passed = env.PLAY && !env.EVENT && !readsFail;
  assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
  assert.equal(code, passed ? 0 : 1, stderr);
  assert.ok(reports, `its reports written: ${stdout}`);
  const engines = enginesOf(runs);
  assert.deepEqual(reports.map((report) => [report.browser, own ? report.ok : report.status, headOf(report.failure),
    report.cleanupErrors]), engines.map((name) => [name, passed ? 'passed' : own ? false : 'failed',
    passed ? undefined : !env.PLAY ? 'Error: no site here' : env.EVENT ? EVENT_FAILURE[env.EVENT](name) : READS_FAILURE(name, cut, failed),
    name === 'chromium' && env.BROWSER_HANGS ? ['browser: browser cleanup timed out'] : []]),
  passed ? 'every engine passed' : !env.PLAY ? 'the suite\'s own failure, kept' :
    env.EVENT ? `every engine failed with its page's ${env.EVENT} first` : 'every engine failed with the reads its finally cut short or saw fail after its pass');
  for (const report of reports) {
    const record = holder(report);
    for (const [name, value] of Object.entries(values))
      assert.deepEqual(record[name], value, `${report.browser}'s ${name}`);
    assert.deepEqual(fieldsOf(record, Object.keys(fields).filter((name) => !Object.hasOwn(values, name))), [],
      `${report.browser}'s fields of reads never made`);
    assert.deepEqual(record.readsCutShort, CUT_SHORT(...cut), `${report.browser}'s reads cut short`);
    assert.deepEqual(record.readsFailed, last ? FAILED(READ_ERROR, ...failed) : undefined,
      `${report.browser}'s reads of its finally that failed, and none of its catch`);
    if (record !== report)
      assert.deepEqual([report.readsCutShort, report.readsFailed], [record.readsCutShort, record.readsFailed],
        `${report.browser}'s report has its scene's lists, which engines() reads`);
    assert.deepEqual([report.errors, report.ended.map(({ event, url }) => `${event} (${url})`)],
      [env.EVENT === 'pageerror' ? [PAGE_ERROR] : [], env.EVENT === 'crash' ? ['page crashed (http://stand-in/)'] : []],
      `${report.browser}'s uncaught page errors and what ended`);
  }
  // After a failure the harness takes its screenshot once the reads have
  // ended, browser_smoke takes its own before them and solver_update none;
  // after reads that fail an engine that passed, nothing takes one.
  const before = (env.PLAY ? shotOnPass : screenshotFirst) ? ['takes a screenshot'] : [];
  const after = passed || readsFail || own ? [] : ['takes a screenshot'];
  for (const name of ['chromium', 'webkit'])
    assert.deepEqual(said(lines, name), Array.from({ length: runs }, () => [...before, ...asked.map((read) => `is asked for ${read}`),
      ...after, 'closes its browser']).flat(), stdout);
  assert.deepEqual(limits, { [READ_LIMIT]: blocks.length * engines.length, [CLOSE_LIMIT]: engines.length },
    'one limit for each catch\'s or finally\'s reads in each engine, and one for each browser\'s close');
  // What stderr says of the reads, line by line: nothing after a failure, nor
  // after an uncaught page error or a crash, whose failure is printed instead,
  // with the page's error; after a pass that the reads fail, each engine's
  // failure, which names them, after the engine's name, as any engine's
  // failure is printed, and last the first of them, with which the run ends.
  const ofReads = stderr.split(/\r?\n/).filter((line) => line.includes('no answer within') || line.includes(READ_ERROR));
  assert.deepEqual(ofReads, readsFail ? [...engines.map((name) => `${name} ${READS_FAILURE(name, cut, failed)}`),
    READS_FAILURE('chromium', cut, failed)] : [], `what stderr says of the reads: ${stderr}`);
  if (env.EVENT)
    for (const name of new Set(engines))
      assert.ok(stderr.includes(EVENT_FAILURE[env.EVENT](name).split('\n').at(-1)), `${name}'s failure printed: ${stderr}`);
  if (env.EVENT === 'pageerror') assert.ok(stderr.includes(PAGE_ERROR), `the page's error printed: ${stderr}`);
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
});

// external_replay run as it is, each fixture's stop answering that it left
// `left`, beside a clean, inactive replay, once its steps have failed at
// their first call ("no site here") or, with PLAY, passed: how it ended, each
// engine's report and what each browser was asked. The run must end by
// itself with its reports written.
async function replayed(t, left, PLAY = false) {
  const closed = { ...ANSWERS.closed, ...left };
  const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, 'external_replay', { PLAN: { closed: { answer: closed } }, PLAY });
  assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
  assert.ok(reports, `its reports written: ${stdout}`);
  return { code, stdout, stderr, limits, reports, closed, said: { chromium: said(lines, 'chromium'), webkit: said(lines, 'webkit') } };
}
// What each browser of external_replay's is asked in each of its three
// fixtures when every engine fails: the stop, then the failure's screenshot,
// then its close.
const FAILED_FIXTURES = Array.from({ length: 3 }, () => ['is asked for closed', 'takes a screenshot', 'closes its browser']).flat();
// The last line on which main() printed a failure starting `start`: what the
// run ended with.
const endedWith = (stderr, start) => [...stderr.matchAll(new RegExp(`^${start}.*$`, 'gm'))].at(-1)?.[0];

// What external_replay's finally does with what its stop says it left
// (checkClosed()), run as it is: after a step's own failure each engine of
// each fixture fails with that step's error, printed as any engine's failure
// is and the one the run ends with, whatever the stop said, and its report
// keeps what the stop said and names each check that failed in
// stepCleanupErrors, which nothing prints; after steps that passed the first
// check that failed fails the engine with its own error, through engines()'
// catch, which asks for the failure's screenshot, as it always did, the
// report naming the checks as after a failure. A stop that answers nothing
// is not checked. In every row each engine asks for the stop once, with one
// READ_LIMIT, before the failure's screenshot, when it failed, and the close.
describe('external_replay\'s checks of what its stop says it left, run as it is', { concurrency: true }, () => {
  for (const left of LEFTOVERS)
    test(`after a step's own failure every engine fails with that, its report naming each check that failed, when the stop says it left ${JSON.stringify(left)}`, async (t) => {
      const { code, stderr, limits, reports, closed, said: asked } = await replayed(t, left);
      const engines = enginesOf(3);
      assert.equal(code, 1, stderr);
      assert.deepEqual(reports.map((report) => [report.browser, report.status, report.closed, report.readsCutShort, report.readsFailed]),
        engines.map((name) => [name, 'failed', closed, [], []]), 'every engine failed, with what the stop said kept');
      assert.deepEqual(reports.map((report) => headOf(report.failure)), engines.map(() => 'Error: no site here'), 'the step\'s own failure');
      assert.deepEqual(reports.map((report) => report.stepCleanupErrors), engines.map(() => NAMED(left)), 'each check that failed named');
      assert.deepEqual(asked, { chromium: FAILED_FIXTURES, webkit: FAILED_FIXTURES });
      assert.deepEqual(limits, { [READ_LIMIT]: 6, [CLOSE_LIMIT]: 6 });
      for (const name of ['chromium', 'webkit'])
        assert.ok(stderr.includes(`${name} Error: no site here`), `${name}'s failure printed: ${stderr}`);
      assert.equal(endedWith(stderr, 'Error: '), 'Error: no site here', `what the run ended with: ${stderr}`);
      assert.doesNotMatch(stderr, /AssertionError|the stop must leave/, 'nothing printed of the checks');
    });

  test('after a step\'s own failure and a stop that says it left a clean, inactive replay, every engine fails with that and nothing is named', async (t) => {
    const { code, stderr, reports, said: asked } = await replayed(t, {});
    assert.equal(code, 1, stderr);
    assert.deepEqual(reports.map((report) => [report.browser, report.status, headOf(report.failure), report.closed, fieldsOf(report, ['stepCleanupErrors'])]),
      enginesOf(3).map((name) => [name, 'failed', 'Error: no site here', ANSWERS.closed, []]));
    assert.deepEqual(asked, { chromium: FAILED_FIXTURES, webkit: FAILED_FIXTURES });
    assert.equal(endedWith(stderr, 'Error: '), 'Error: no site here', stderr);
  });

  // A step can fail before the page has a replay to stop, as on image data
  // that will not decode: the stop then answers nothing ({}, an answer of
  // undefined), so that the report has no `closed`, as it never had, and
  // there is nothing to check.
  test('after a step\'s own failure before the replay began, with a stop that answers nothing, every engine fails with that, nothing checked or named', async (t) => {
    const { code, killed, stdout, stderr, lines, reports } = await ran(t, 'external_replay', { PLAN: { closed: {} } });
    assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
    assert.equal(code, 1, stderr);
    assert.deepEqual(reports.map((report) => [report.browser, report.status, headOf(report.failure), fieldsOf(report, ['closed', 'stepCleanupErrors']),
      report.readsCutShort, report.readsFailed]), enginesOf(3).map((name) => [name, 'failed', 'Error: no site here', [], [], []]));
    assert.deepEqual([said(lines, 'chromium'), said(lines, 'webkit')], [FAILED_FIXTURES, FAILED_FIXTURES], stdout);
    assert.equal(endedWith(stderr, 'Error: '), 'Error: no site here', `what the run ended with: ${stderr}`);
    assert.doesNotMatch(stderr, /TypeError|AssertionError|the stop must leave/, 'nothing printed of the checks');
  });

  test('after steps that passed, a stop that says the replay still runs fails every engine with that check\'s own error, asking for the failure\'s screenshot, as it always did', async (t) => {
    const left = { active: true }, failure = `AssertionError [ERR_ASSERTION]: ${LEFT.active(true)}`;
    const { code, stderr, limits, reports, closed, said: asked } = await replayed(t, left, true);
    const engines = enginesOf(3);
    // As it always was: every engine failed, after its screenshot was asked
    // for, with what the stop said kept and no read cut short or failed.
    assert.equal(code, 1, stderr);
    assert.deepEqual(reports.map((report) => [report.browser, report.status, report.closed, report.readsCutShort, report.readsFailed]),
      engines.map((name) => [name, 'failed', closed, [], []]));
    assert.deepEqual(asked, { chromium: FAILED_FIXTURES, webkit: FAILED_FIXTURES });
    assert.deepEqual(limits, { [READ_LIMIT]: 6, [CLOSE_LIMIT]: 6 });
    // New: the check's message says which check failed and what the stop
    // said, and the report names it as after a failure.
    assert.deepEqual(reports.map((report) => headOf(report.failure)), engines.map(() => failure), 'the check\'s own error');
    assert.deepEqual(reports.map((report) => report.stepCleanupErrors), engines.map(() => NAMED(left)), 'the check named');
    for (const name of ['chromium', 'webkit'])
      assert.ok(stderr.includes(`${name} ${failure}`), `${name}'s failure printed: ${stderr}`);
    assert.equal(endedWith(stderr, 'AssertionError '), failure, `what the run ended with: ${stderr}`);
  });

  // With every reading empty, the last step, the check that a required
  // photograph was read, fails in the two fixtures that require one, after
  // all the others passed, while the third's steps pass.
  test('after its last step fails, a required photograph unread, each engine keeps that error too, while the fixture that requires none passes its steps and fails on the check', async (t) => {
    const left = { active: true }, failure = `AssertionError [ERR_ASSERTION]: ${LEFT.active(true)}`;
    const { code, killed, stdout, stderr, reports } = await ran(t, 'external_replay', { PLAN: { closed: { answer: { ...ANSWERS.closed, ...left } } },
      PLAY: true, PLAYED: { '()=>externalReplay.report()': { reads: [] } } });
    assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
    assert.equal(code, 1, stderr);
    const unread = (browser, name) => `AssertionError [ERR_ASSERTION]: ${browser}: ${name}: required photograph had no completed reading within 25 seconds`;
    assert.deepEqual(reports.map((report) => [report.browser, report.source.name, report.outcome, report.acquisitionRequired, headOf(report.failure),
      report.stepCleanupErrors]), JSON.parse(FIXTURES).fixtures.flatMap(({ name }) => ['chromium', 'webkit'].map((browser) => [browser, name,
      'no-completed-reading', name !== 'images/another.webp', name === 'images/another.webp' ? failure : unread(browser, name), NAMED(left)])));
    assert.equal(endedWith(stderr, 'AssertionError '), unread('chromium', JSON.parse(FIXTURES).fixtures[0].name), `what the run ended with: ${stderr}`);
  });

  test('after one engine\'s own failure, with a stop that says the replay still runs, the other engine and the next fixtures run and pass, and the run ends with that failure', async (t) => {
    const first = { plan: { closed: { answer: { ...ANSWERS.closed, active: true } } }, play: false };
    const { code, killed, stdout, stderr, lines, reports } = await ran(t, 'external_replay',
      { PLAN: [first, ...Array.from({ length: 5 }, () => ({ plan: { '*': 'answer' }, play: true }))] });
    assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
    assert.equal(code, 1, stderr);
    assert.deepEqual(reports.map((report) => [report.browser, report.status, report.closed]),
      enginesOf(3).map((name, n) => [name, n ? 'passed' : 'failed', n ? ANSWERS.closed : first.plan.closed.answer]), 'the others passed');
    assert.deepEqual(reports.map((report) => [headOf(report.failure), report.stepCleanupErrors]),
      [['Error: no site here', NAMED({ active: true })], ...Array.from({ length: 5 }, () => [undefined, undefined])], 'the first kept its own failure');
    assert.deepEqual([said(lines, 'chromium'), said(lines, 'webkit')], [['is asked for closed', 'takes a screenshot', 'closes its browser',
      ...Array.from({ length: 2 }, () => ['is asked for closed', 'closes its browser']).flat()],
    Array.from({ length: 3 }, () => ['is asked for closed', 'closes its browser']).flat()], stdout);
    assert.equal(endedWith(stderr, 'Error: '), 'Error: no site here', `what the run ended with: ${stderr}`);
  });

  // Each engine has its own word on whether its steps passed: one whose steps
  // fail after engines whose steps passed, in its own fixture and in one
  // before it, keeps its own failure too.
  test('an engine whose steps fail after engines whose steps passed, with a stop that says the replay still runs, keeps its own failure and names the check', async (t) => {
    const passes = { plan: { '*': 'answer' }, play: true }, fails = { plan: { closed: { answer: { ...ANSWERS.closed, active: true } } }, play: false };
    const plans = [passes, fails, passes, fails, passes, passes];
    const { code, killed, stdout, stderr, reports } = await ran(t, 'external_replay', { PLAN: plans });
    assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
    assert.equal(code, 1, stderr);
    assert.deepEqual(reports.map((report) => [report.browser, report.status, headOf(report.failure), report.stepCleanupErrors]),
      plans.map(({ play }, n) => [enginesOf(3)[n], ...(play ? ['passed', undefined, undefined] : ['failed', 'Error: no site here', NAMED({ active: true })])]));
    assert.equal(endedWith(stderr, 'Error: '), 'Error: no site here', `what the run ended with: ${stderr}`);
    assert.doesNotMatch(stderr, /AssertionError|the stop must leave/, 'nothing printed of the checks');
  });
});

// The reads of a finally run after a pass too: live_motion's stop,
// live_noise's and live_recovery's last snapshot and their stop, and
// external_replay's stop. One that answers keeps the pass. One cut short and
// one that fails keep their fallbacks, external_replay's stop then left
// unchecked, and fail the engine in engines()' finally, with the names of
// the reads cut short there and then of those that failed, with their
// errors: the report is still written and the browser closed, but no failure
// screenshot is taken, as for a browser that would not close after a pass.
// And as when the browser's close fails, an engine whose page threw an
// uncaught error, or crashed, fails with that, by engines()' own check, asking
// for its screenshot, while the reads are named in its report alone.
describe('the four suites whose finally reads, run as they are through a pass', { concurrency: true }, () => {
  const mixed = [['the snapshot answers and the stop never does', { final: 'answer', stop: 'never' }],
    ['the snapshot fails and the stop never answers', { final: 'reject', stop: 'never' }],
    ['the snapshot answers and the stop fails', { final: 'answer', stop: 'reject' }]];
  const more = { live_motion: [], live_noise: mixed, live_recovery: mixed, external_replay: [] };
  for (const suite of ['live_motion', 'live_noise', 'live_recovery', 'external_replay']) {
    test(`${suite} passes, with its reads, when every read answers`, (t) => check(t, suite, { PLAN: { '*': 'answer' }, PLAY: true }));
    for (const [what, PLAN] of [['no read answers', { '*': 'never' }], ['every read fails', { '*': 'reject' }], ...more[suite]])
      test(`${suite} fails each engine that passed with the reads its finally cut short or saw fail, with no screenshot and its reports written, when ${what}`,
        (t) => check(t, suite, { PLAN, PLAY: true }));
    for (const [what, EVENT] of [['threw an uncaught error', 'pageerror'], ['crashed', 'crash']])
      test(`${suite} fails each engine whose page ${what} with that, not with the reads its finally then cut short, when no read answers`,
        (t) => check(t, suite, { PLAN: { '*': 'never' }, PLAY: true, EVENT }));
  }
});

// What one engine's failure does to the rest of a run of live_recovery's two
// scenes or external_replay's three fixtures, each run on engines() in turn:
// the first engine of the first fails, by its first step or by reads its
// finally cut short or saw fail after its steps passed, and every other
// engine passes. Either way the first's other engine and the next scenes or
// fixtures still run and pass, reading their page as ever, every engine's
// report reaches the suite's own, and the run ends with that first failure;
// only after a failing step is a screenshot asked for. A scene of
// live_recovery whose reads were cut short or failed after its checks passed
// keeps `ok` in its record, and has no `failure` there, which a scene's own
// failure gives it.
describe('live_recovery\'s scenes and external_replay\'s fixtures, after one engine has failed', { concurrency: true }, () => {
  for (const [suite, unit] of [['live_recovery', 'scene'], ['external_replay', 'fixture']])
    test(`${suite} runs every other engine and ${unit} through to its pass after reads cut short or failed fail the first engine that passed, as after that engine's own failure`, async (t) => {
      const { reads: { finally: last }, runs, holder = (report) => report, chained } = SUITES[suite], engines = enginesOf(runs);
      const rest = engines.slice(1).map(() => ({ plan: { '*': 'answer' }, play: true }));
      // A record of live_recovery's: its `ok` and the first line of its own
      // `failure`; external_replay keeps none.
      const record = (report) => (suite === 'live_recovery' ? [holder(report).ok ?? null, holder(report).failure?.split('\n')[0] ?? null] : []);
      const outcome = async (first) => {
        const { code, killed, stdout, stderr, lines, reports } = await ran(t, suite, { PLAN: [first, ...rest] });
        assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
        assert.ok(reports, `its reports written: ${stdout}`);
        return { code, stdout, stderr,
          reports: reports.map((report) => [report.browser, report.status, report.failure?.split('\n')[0], holder(report).readsCutShort,
            holder(report).readsFailed, ...record(report)]),
          said: { chromium: said(lines, 'chromium'), webkit: said(lines, 'webkit') },
          // What the run ends with: main() prints it last, with no engine's
          // name before it.
          ended: [...stderr.matchAll(/^Error: .*$/gm)].at(-1)?.[0] };
      };
      // When none of them answers, every read of the finally is cut short,
      // but only the first of a chain is asked; when each fails, each is asked.
      const failure = READS_FAILURE('chromium', last), asked = (names) => names.map((name) => `is asked for ${name}`);
      const plays = (first, shot = true) => ({
        chromium: [...asked(first), ...(shot ? ['takes a screenshot'] : []), 'closes its browser',
          ...Array.from({ length: runs - 1 }, () => [...asked(last), 'closes its browser']).flat()],
        webkit: Array.from({ length: runs }, () => [...asked(last), 'closes its browser']).flat(),
      });
      // A record of live_recovery's has `ok` once its checks have passed, and
      // its own `failure` only when they failed.
      const inRecord = (ok, failure) => (suite === 'live_recovery' ? [ok, failure] : []);
      const others = engines.slice(1).map((name) => [name, 'passed', undefined, [], [], ...inRecord(true, null)]);
      const failed = await outcome({ plan: { '*': 'answer' }, play: false });
      assert.equal(failed.code, 1, failed.stderr);
      assert.deepEqual(failed.reports, [['chromium', 'failed', 'Error: no site here', [], [], ...inRecord(null, 'Error: no site here')], ...others]);
      assert.deepEqual(failed.said, plays(last), failed.stdout);
      assert.equal(failed.ended, 'Error: no site here', failed.stderr);
      const cutShort = await outcome({ plan: { '*': 'never' }, play: true });
      assert.equal(cutShort.code, 1, cutShort.stderr);
      assert.deepEqual(cutShort.reports, [['chromium', 'failed', failure, CUT_SHORT(...last), [], ...inRecord(true, null)], ...others]);
      assert.deepEqual(cutShort.said, plays(chained ? last.slice(0, 1) : last, false), cutShort.stdout);
      assert.equal(cutShort.ended, failure, cutShort.stderr);
      const readsFailed = await outcome({ plan: { '*': 'reject' }, play: true }), failedFailure = READS_FAILURE('chromium', [], last);
      assert.equal(readsFailed.code, 1, readsFailed.stderr);
      assert.deepEqual([readsFailed.reports, readsFailed.said],
        [[['chromium', 'failed', failedFailure, [], FAILED(READ_ERROR, ...last), ...inRecord(true, null)], ...others], plays(last, false)],
        readsFailed.stdout);
      assert.equal(readsFailed.ended, failedFailure, readsFailed.stderr);
    });
});

// Engines that never reach the reads, so that their reports have none of the
// reads' fields and no readsCutShort or readsFailed: one with no page, since
// Chromium's newPage() rejects, in the two suites that open their pages
// themselves; a failure screenshot that fails in browser_smoke, which reads
// its page only once that screenshot is taken; and a page that never gets
// ready, which live_noise, live_recovery (whose scene then has no record)
// and external_replay wait for before their try, and live_motion inside it,
// so that live_motion alone still reads it.
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
      'reads nothing of a page that never gets ready, which it waits for before its try, and has no readsCutShort or readsFailed then'}`, async (t) => {
      const { reads: { catch: caught = [], finally: last }, runs = 1 } = SUITES[suite], reached = suite === 'live_motion';
      const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, suite, { PLAN: { '*': 'answer' }, UNREADY: true });
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      const engines = enginesOf(runs), names = reached ? [...caught, ...last] : [];
      assert.deepEqual(reports.map((report) => [report.browser, report.status, report.failure?.split('\n')[0], report.cleanupErrors]),
        engines.map((name) => [name, 'failed', 'Error: the page never became ready', []]));
      for (const report of reports) {
        const fields = fieldsOf(report, ['state', 'final', 'closed', 'readsCutShort', 'readsFailed']);
        assert.deepEqual(Object.fromEntries(fields.map((name) => [name, report[name]])),
          reached ? { state: kept(ANSWERS.state), readsCutShort: [], readsFailed: [] } : {}, report.browser);
        if (suite === 'live_recovery') assert.deepEqual(report.cases, [], 'no record of a scene that never began');
      }
      for (const name of ['chromium', 'webkit'])
        assert.deepEqual(said(lines, name), Array.from({ length: runs }, () => [...names.map((read) => `is asked for ${read}`),
          'takes a screenshot', 'closes its browser']).flat(), stdout);
      assert.deepEqual(limits, { [READ_LIMIT]: reached ? 2 * engines.length : 0, [CLOSE_LIMIT]: engines.length });
    });
});
