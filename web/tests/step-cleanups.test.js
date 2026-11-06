import test, { before, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { format } from 'node:util';

// The page calls that put the page back after a step, for the steps after
// it, in live_camera, browser_regressions and scanner_repair (each once in
// its step's finally), which go through watch.cjs's readWithin() with
// READ_LIMIT, the step's own failure first: each suite's stepThenPutBack() on
// its own; each of the ten steps that have such a call, played on a stand-in
// page that passes the step or fails it and then answers the call, fails it,
// throws as it is called or never answers; the report each suite hands those
// steps; and live_camera run as it is, in a process of its own, on a stand-in
// for Playwright whose page plays its first step. Loading watch.cjs or a
// suite needs no Playwright.
const require = createRequire(import.meta.url);
const { CLOSE_LIMIT, READ_LIMIT } = require('../../scripts/watch.cjs');
const camera = require('../../scripts/live_camera_regressions.cjs');
const regressions = require('../../scripts/browser_regressions.cjs');
const repair = require('../../scripts/scanner_repair_regressions.cjs');
const tick = () => new Promise(setImmediate);
const CUT_SHORT = (name) => `${name}: no answer within ${READ_LIMIT / 1000} s`;
const source = (script) => fs.readFileSync(new URL(`../../scripts/${script}`, import.meta.url), 'utf8');
const SUITES = { live_camera: camera, browser_regressions: regressions, scanner_repair: repair };

// What a step fails with, what the call that puts the page back fails with,
// and what a page's first call after that call fails with, so that a test can
// tell that the suite went on past it.
const STEP_FAILED = new Error('Timeout 20000ms exceeded.');
const CALL_FAILED = new Error('page.evaluate: Target page, context or browser has been closed');
const WENT_ON = new Error('the step after it');
const WAYS = ['answer', 'reject', 'throws', 'never'];

// Sets mocked timers going for one test, with each timer of READ_LIMIT's
// length counted. Returns the count and how to put setTimeout back, which
// the test does before the mocks are reset.
function limitsCounted(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mocked = globalThis.setTimeout, counted = { limits: 0 };
  globalThis.setTimeout = function (run, ms, ...args) {
    if (ms === READ_LIMIT) counted.limits++;
    return mocked(run, ms, ...args);
  };
  counted.restore = () => { globalThis.setTimeout = mocked; };
  return counted;
}

// How `running` settles: { value } or { error }, or null while it has not.
function outcomeOf(running) {
  const seen = { outcome: null };
  running.then((value) => { seen.outcome = { value }; }, (error) => { seen.outcome = { error }; });
  return seen;
}

// Node 22 warns, once in a process, that mock timers are experimental, through
// console.error a tick after they are first used (Node 24 does not warn). Let
// it warn here, before any test runs, so that the warning is never among what
// printed() catches, whichever test comes first or runs alone.
before(async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  mock.timers.reset();
  await tick();
});

// What `console` prints during one test, each line as it would print it,
// through its log, info, warn, error, debug, trace and dir, each mocked,
// which the test's mocks put back as it ends. engines() prints a step's
// failure; neither the step nor the call that puts its page back prints
// anything itself.
function printed(t) {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'])
    t.mock.method(console, method, (...args) => { lines.push(format(...args)); });
  return lines;
}

// Each report starts with the empty cleanupErrors that engines() gives it,
// but in the test of lists that have something in them already, where it has
// a close that failed. That list keeps only the closes that failed: a call
// that puts the page back and fails goes in stepCleanupErrors, never there.
describe('stepThenPutBack(), the same in each of the three suites', () => {
  for (const [suite, { stepThenPutBack }] of Object.entries(SUITES)) {
    // A step that passes or fails, and a call that puts the page back as `way`
    // says, each noting when it runs.
    const play = (passes, way, events) => [
      async () => { events.push('step'); if (!passes) throw STEP_FAILED; },
      () => {
        events.push('put back');
        if (way === 'throws') throw CALL_FAILED;
        if (way === 'reject') return Promise.reject(CALL_FAILED);
        if (way === 'never') return new Promise(() => {});
        return Promise.resolve();
      },
    ];

    test(`${suite}: a step that passes and a call that answers: nothing is thrown, the report gets nothing, and nothing waits`, async (t) => {
      const counted = limitsCounted(t);
      try {
        const events = [], report = { browser: 'chromium', cleanupErrors: [] };
        const seen = outcomeOf(stepThenPutBack(report, 'viewport', ...play(true, 'answer', events)));
        await tick();
        assert.deepEqual(seen.outcome, { value: undefined });
        assert.deepEqual(report, { browser: 'chromium', cleanupErrors: [] }, 'no list made for nothing');
        assert.deepEqual(events, ['step', 'put back']);
        assert.equal(counted.limits, 1, 'the call has READ_LIMIT');
      } finally { counted.restore(); }
    });

    for (const way of ['reject', 'throws'])
      test(`${suite}: after a pass, a call that ${way === 'reject' ? 'rejects' : 'throws as it is called'} fails the step with its own error, as it always did, and is kept in stepCleanupErrors`, async (t) => {
        const counted = limitsCounted(t);
        try {
          const events = [], report = { cleanupErrors: [] };
          const seen = outcomeOf(stepThenPutBack(report, 'viewport', ...play(true, way, events)));
          await tick();
          assert.equal(seen.outcome?.error, CALL_FAILED);
          assert.deepEqual(report, { cleanupErrors: [], stepCleanupErrors: [`viewport: ${CALL_FAILED.message}`] });
          assert.equal(counted.limits, 1);
        } finally { counted.restore(); }
      });

    test(`${suite}: after a pass, a call that never answers fails the step READ_LIMIT after it was asked, with its name as the failure, and is named in readsCutShort`, async (t) => {
      const counted = limitsCounted(t);
      try {
        const events = [], report = { cleanupErrors: [] };
        const seen = outcomeOf(stepThenPutBack(report, 'viewport', ...play(true, 'never', events)));
        await tick();
        t.mock.timers.tick(READ_LIMIT - 1); await tick();
        assert.equal(seen.outcome, null, 'the limit has not passed');
        t.mock.timers.tick(1); await tick();
        assert.ok(seen.outcome?.error instanceof Error, 'it fails');
        assert.equal(seen.outcome.error.message, CUT_SHORT('viewport'), 'with the name as its failure');
        assert.deepEqual(report, { cleanupErrors: [], readsCutShort: [CUT_SHORT('viewport')] });
        assert.equal(counted.limits, 1);
      } finally { counted.restore(); }
    });

    for (const way of WAYS)
      test(`${suite}: after a step's own failure, a call that ${{ answer: 'answers', reject: 'rejects', throws: 'throws as it is called', never: 'never answers' }[way]} still comes, and the step's own failure is what is thrown`, async (t) => {
        const counted = limitsCounted(t);
        try {
          const events = [], report = { cleanupErrors: [] };
          const seen = outcomeOf(stepThenPutBack(report, 'camera', ...play(false, way, events)));
          await tick();
          if (way === 'never') {
            t.mock.timers.tick(READ_LIMIT - 1); await tick();
            assert.equal(seen.outcome, null, 'the limit has not passed');
            t.mock.timers.tick(1); await tick();
          }
          assert.equal(seen.outcome?.error, STEP_FAILED, 'the step\'s own failure first');
          assert.deepEqual(events, ['step', 'put back'], 'the page is still put back');
          assert.deepEqual(report, { cleanupErrors: [], ...(way === 'never' ? { readsCutShort: [CUT_SHORT('camera')] }
            : way === 'answer' ? {} : { stepCleanupErrors: [`camera: ${CALL_FAILED.message}`] }) });
          assert.equal(counted.limits, 1);
        } finally { counted.restore(); }
      });

    test(`${suite}: the lists keep what is in them already, and a failure that is no Error is still the step's`, async (t) => {
      const counted = limitsCounted(t);
      try {
        const report = { cleanupErrors: ['context: earlier'], readsCutShort: ['storageStatus: no answer within 19.9 s'],
          stepCleanupErrors: ['camera: earlier'] };
        const seen = outcomeOf(stepThenPutBack(report, 'viewport', async () => { throw 'a string'; }, () => Promise.reject('no Error either')));
        await tick();
        assert.equal(seen.outcome?.error, 'a string');
        assert.deepEqual(report, { cleanupErrors: ['context: earlier'], readsCutShort: ['storageStatus: no answer within 19.9 s'],
          stepCleanupErrors: ['camera: earlier', 'viewport: no Error either'] });
        const cut = outcomeOf(stepThenPutBack(report, 'turn', async () => {}, () => new Promise(() => {})));
        await tick();
        t.mock.timers.tick(READ_LIMIT); await tick();
        assert.equal(cut.outcome?.error?.message, CUT_SHORT('turn'));
        assert.deepEqual(report.readsCutShort, ['storageStatus: no answer within 19.9 s', CUT_SHORT('turn')]);
        assert.deepEqual(report.cleanupErrors, ['context: earlier']);
      } finally { counted.restore(); }
    });

    test(`${suite}: the call is asked only once the step has settled`, async () => {
      const events = [];
      let release;
      const running = stepThenPutBack({ cleanupErrors: [] }, 'viewport', () => new Promise((resolve) => { release = resolve; }),
        async () => { events.push('put back'); });
      await tick();
      assert.deepEqual(events, [], 'not while the step runs');
      release(); await running;
      assert.deepEqual(events, ['put back']);
    });

    test(`${suite}: nothing is printed for the call, whatever it does, after a pass or a failure`, async (t) => {
      const counted = limitsCounted(t), lines = printed(t);
      try {
        for (const passes of [true, false])
          for (const way of WAYS) {
            const seen = outcomeOf(stepThenPutBack({ cleanupErrors: [] }, 'viewport', ...play(passes, way, [])));
            await tick();
            if (way === 'never') { t.mock.timers.tick(READ_LIMIT); await tick(); }
            assert.notEqual(seen.outcome, null, `${passes ? 'a pass' : 'a failure'} and a call that does "${way}": settled`);
          }
        assert.deepEqual(lines, [], 'engines() prints the failure, and nothing else is printed');
      } finally { counted.restore(); }
    });
  }
});

// A stand-in page for one step, as `site` says (SITES, below): it records
// every call it is asked (`calls`, each { kind, selector, args, source },
// `source` that of a function it is handed, with its whitespace taken out),
// answers each as `site.answer(call, state)` says, fails the step at the call
// `site.failAt` picks out when `passes` is false, and answers the call that
// puts the page back, `site.isPutBack`, as `way` says: "answer", "reject",
// "throws" (as it is called) or "never". Any call after that one fails with
// WENT_ON. `size` is what viewportSize() gives, the page's own size.
function standInPage(site, passes, way) {
  const calls = [], state = { stopped: 0 }, size = { width: 430, height: 932 };
  let after = false;
  const ask = (kind, selector, args) => {
    const fn = args.find((arg) => typeof arg === 'function');
    const call = { kind, selector, args, source: fn && String(fn).replace(/\s+/g, '') };
    calls.push(call);
    if (after) return Promise.reject(WENT_ON);
    if (site.isPutBack(call, size)) {
      call.putBack = true; after = true;
      if (way === 'throws') throw CALL_FAILED;
      if (way === 'reject') return Promise.reject(CALL_FAILED);
      if (way === 'never') return new Promise(() => {});
      return Promise.resolve();
    }
    if (!passes && site.failAt(call, size)) { call.failed = true; return Promise.reject(STEP_FAILED); }
    return Promise.resolve(site.answer(call, state));
  };
  const on = (kind) => (selector, ...args) => ask(kind, typeof selector === 'string' ? selector : undefined,
    typeof selector === 'string' ? args : [selector, ...args]);
  const page = { calls, size, viewportSize: () => size, keyboard: { press: on('keyboard.press') },
    locator: (selector) => Object.fromEntries(['isVisible', 'isHidden', 'getAttribute', 'evaluate', 'evaluateAll', 'innerText']
      .map((method) => [method, (...args) => ask(`locator.${method}`, selector, args)])) };
  for (const kind of ['goto', 'waitForSelector', 'evaluate', 'setViewportSize', 'click', 'waitForFunction', 'textContent',
    'inputValue', 'selectOption', 'setInputFiles', 'dispatchEvent', 'fill', 'reload'])
    page[kind] = on(kind);
  return page;
}

// What a page answers to let live_camera's camera open: Start preview is
// hidden, the camera panel shown.
const visible = (call) => (call.kind === 'locator.isVisible' ? call.selector === '#camera-panel' : undefined);
const evaluates = (call, part) => call.kind === 'evaluate' && call.source?.includes(part);
const PUZZLE = { type: 'sudoku', rows: 9, cols: 9, cells: [5, 3, null, null, 7] };
const LAYOUT = { viewfinder: 400, row: 48, rowOverflow: false, shutter: { top: 500, width: 140, height: 48 },
  clear: { top: 500, right: 300, width: 140, height: 48 }, start: { bottom: 450 }, panel: { right: 320 }, counts: 4, legend: 20, bareLegend: 20 };

// The ten steps after which a call puts the page back (once in the step's
// finally), each as a test plays it: its suite and the name its call has in
// the report, how to run it on a page and a report as its suite does, the
// call that puts the page back, a call inside the step that a failing step
// fails at, what a page answers for the step to pass, what the suite does
// after it (`next`: its next call, which then fails with WENT_ON; otherwise it
// returns, with `check` pushed when it has one), and the mocked time the step
// itself waits when it passes.
const SITES = [
  { suite: 'live_camera', name: 'viewport after viewfinder layers',
    run: (page, report) => camera.layersAtEachScreen(page, report, 'http://stand-in/'),
    isPutBack: (call, size) => call.kind === 'setViewportSize' && call.args[0] === size,
    failAt: (call) => call.kind === 'setViewportSize',
    answer: (call) => (evaluates(call, 'elementFromPoint')
      ? { video: [0, 0, 430, 600], canvas: [0, 0, 430, 600], videoPointer: 'none', touched: 'live-preview' } : visible(call)),
    check: 'the video and the canvas over it share one box on a phone, a tablet and a desktop screen, so the outline lands on the video; touches reach the canvas, not the video' },
  { suite: 'live_camera', name: 'viewport after 320 px',
    run: (page, report) => camera.narrowScreen(page, report),
    isPutBack: (call, size) => call.kind === 'setViewportSize' && call.args[0] === size,
    failAt: (call) => call.kind === 'evaluate' && call.source === '()=>{window.liveMode="grid";}',
    answer: (call) => (evaluates(call, 'Holdthegridsteady.') ? structuredClone(LAYOUT) : visible(call)),
    check: 'on a 320 x 568 screen the frozen row (Save picture, Clear) stays one line and the viewfinder keeps its size, and the legend\'s counts take no room of their own; Start preview after a refused Clear gets a line of its own' },
  { suite: 'live_camera', name: 'automatic solving after live capture',
    run: (page, report) => camera.captureWithoutAutoSolve(page, report),
    isPutBack: (call) => evaluates(call, '"auto-solve"') && call.args[1] === true,
    failAt: (call) => call.kind === 'click' && call.selector === '#camera',
    answer: (call) => {
      if (evaluates(call, 'overlay:preview.dataset.overlay')) return { view: 'live', overlay: 'outline', solution: 0, paused: false,
        legend: ['10', '4', null, null], help: 'Clues read (10 recognised, 4 uncertain). Automatic solving is off.' };
      if (evaluates(call, 'loadCapture') || (call.kind === 'locator.evaluate' && call.selector === '#live-preview')) return 'data:image/png;base64,AA==';
      if (call.kind === 'locator.getAttribute') return 'captured';
      if (call.kind === 'textContent' && call.selector === '#use-live-capture') return 'Review captured clues';
      return visible(call);
    },
    check: 'without automatic solving the live video stays the display with the outline and legend counts; the shutter stores a fresh verified frame with its reading and shows exactly that picture' },
  { suite: 'live_camera', name: 'paper\'s turn after a page lying sideways',
    run: (page, report) => camera.pageLyingSideways(page, report),
    isPutBack: (call) => evaluates(call, 'window.liveTurn=0;'),
    failAt: (call) => call.kind === 'click' && call.selector === '#camera',
    answer: (call) => {
      const help = 'The grid looks sideways. Turn the page or the phone a quarter turn so that its numbers stand upright.';
      if (evaluates(call, 'texts:[...newSet(turnLog)]')) return { view: 'live', solution: 0, counts: ['10', '4', '0'], help, texts: [help] };
      if (evaluates(call, 'e.reason')) return ['grid-sideways'];
      return visible(call);
    },
    waits: [3000],
    check: 'aimed at the paper a quarter turn round, the live view reads it as it lies and does not freeze; the help line and the export say the grid looks sideways, not to move closer or wait for a clearer frame' },
  { suite: 'browser_regressions', name: 'createImageBitmap after transparent-fallback',
    run: (page, report) => regressions.scan(page, report, 'transparent-fallback', { small: true, transparent: true, fallback: true }),
    isPutBack: (call) => evaluates(call, 'window.createImageBitmap=window.testImageBitmap;'),
    failAt: (call) => call.kind === 'setInputFiles',
    answer: (call) => (evaluates(call, 'homography') ? { image: '', cells: [], n: 4, type: 'sudoku' } : undefined),
    next: true },
  { suite: 'browser_regressions', name: 'file reading after a superseded import',
    run: (page, report) => regressions.supersededImport(page, report),
    isPutBack: (call) => evaluates(call, 'File.prototype.text=window.pendingImport.text;'),
    failAt: (call) => call.kind === 'setInputFiles',
    answer: (call) => (call.kind === 'locator.innerText' ? 'Example loaded.' : undefined),
    check: 'superseded JSON import errors are ignored' },
  { suite: 'browser_regressions', name: 'camera after camera ownership',
    run: (page, report) => regressions.cameraOwnershipRegressions(page, report),
    isPutBack: (call) => call.kind === 'evaluate' && call.source === '()=>window.cameraTest.restore()',
    failAt: (call) => call.kind === 'click' && call.selector === '#camera',
    answer: (call, state) => ({ '()=>window.testState().puzzle': () => structuredClone(PUZZLE), '()=>window.cameraTest.stopped': () => ++state.stopped,
      '()=>window.cameraTest.queued.length': () => 0, '()=>window.cameraTest.solverWorkers': () => 0 }[call.source]?.()
      ?? (call.kind === 'locator.isHidden' ? true : undefined)),
    check: 'editing and solving stop live capture, including already queued detection callbacks' },
  { suite: 'browser_regressions', name: 'camera after confirmation',
    run: (page, report) => regressions.confirmationRegressions(page, report),
    isPutBack: (call) => call.kind === 'evaluate' && call.source === '()=>window.cameraTest.restore()',
    failAt: (call) => call.kind === 'click' && call.selector === '#camera',
    answer: (call, state) => ({ '()=>window.testState()': () => ({ puzzle: structuredClone(PUZZLE), cellUncertain: [0], needsReview: true }),
      '()=>window.testState().puzzle': () => structuredClone(PUZZLE), '()=>window.cameraTest.stopped': () => ++state.stopped,
      '()=>window.cameraTest.queued.length': () => 0 }[call.source]?.()
      ?? (['locator.isVisible', 'locator.isHidden'].includes(call.kind) ? true : undefined)),
    next: true },
  { suite: 'scanner_repair', name: 'file reading after held imports',
    run: (page, report) => repair.importRegressions(page, report),
    isPutBack: (call) => call.kind === 'evaluate' && call.source === '()=>{File.prototype.text=originalImportText;}',
    failAt: (call) => call.kind === 'setInputFiles',
    answer: (call) => (call.source === '()=>repairApp.getState().puzzle' ? structuredClone(PUZZLE)
      : call.kind === 'textContent' ? 'Backup or puzzle imported.' : undefined),
    next: true },
  { suite: 'scanner_repair', name: 'image decoding after an oversized WebP',
    run: (page, report) => repair.oversizedWebp(page, report),
    isPutBack: (call) => evaluates(call, 'window.createImageBitmap=repairBitmap;'),
    failAt: (call) => call.kind === 'setInputFiles',
    answer: (call) => (call.source === '()=>repairFullDecodes' ? 0 : undefined) },
];

// Plays `site` on a stand-in page and a report as its suite starts it, with
// engines()'s empty cleanupErrors, with the step passing or failing and the
// call that puts the page back answering as `way` says, and checks how it
// ends: what is thrown, the report, the calls in order, the one READ_LIMIT
// the call has, which a call that never answers waits out to the
// millisecond, and that nothing is printed.
async function check(t, site, passes, way) {
  const counted = limitsCounted(t), lines = printed(t);
  try {
    const page = standInPage(site, passes, way), report = { browser: 'chromium', cleanupErrors: [], checks: [] };
    const seen = outcomeOf(site.run(page, report));
    await tick();
    for (const wait of passes ? site.waits ?? [] : []) { t.mock.timers.tick(wait); await tick(); }
    const putBack = page.calls.findIndex((call) => call.putBack);
    assert.ok(putBack >= 0, `the page is put back (${page.calls.map((call) => call.kind).join(', ')})`);
    if (way === 'never') {
      t.mock.timers.tick(READ_LIMIT - 1); await tick();
      assert.equal(seen.outcome, null, 'held until the limit, not a millisecond less');
      t.mock.timers.tick(1); await tick();
    }
    assert.notEqual(seen.outcome, null, way === 'never' ? 'not held past the limit' : 'not held at all');
    const { error } = seen.outcome, line = CUT_SHORT(site.name);
    if (!passes) assert.equal(error, STEP_FAILED, 'the step\'s own failure first');
    else if (way === 'never') assert.equal(error?.message, line, 'a pass fails, with the name as its failure');
    else if (way !== 'answer') assert.equal(error, CALL_FAILED, 'a pass fails with the call\'s own error, as it always did');
    else if (site.next) assert.equal(error, WENT_ON, 'the suite goes on, as it always did');
    else assert.equal(error, undefined, 'the step passes, as it always did');
    // The report: the step's own fields and check as before, the call named
    // in one list or the other only when it was cut short or failed, and
    // cleanupErrors left to the closes that failed.
    assert.deepEqual(report.readsCutShort, way === 'never' ? [line] : undefined, 'readsCutShort');
    assert.deepEqual(report.stepCleanupErrors, ['reject', 'throws'].includes(way) ? [`${site.name}: ${CALL_FAILED.message}`] : undefined,
      'stepCleanupErrors');
    assert.deepEqual(report.cleanupErrors, [], 'cleanupErrors');
    assert.deepEqual(report.checks, passes && way === 'answer' && site.check ? [site.check] : [], 'checks');
    // In order: the step's calls, its failure the last of them, then the call
    // that puts the page back once, and after a pass whose call answered the
    // suite's next call, if it has one.
    if (!passes) assert.equal(page.calls[putBack - 1]?.failed, true, 'asked right after the step\'s failure');
    assert.equal(page.calls.filter((call) => call.putBack).length, 1, 'asked once');
    assert.equal(page.calls.length - putBack - 1, passes && way === 'answer' && site.next ? 1 : 0, 'what came after it');
    assert.equal(counted.limits, 1, 'one READ_LIMIT, the call\'s');
    assert.deepEqual(lines, [], 'nothing printed: engines() prints the failure');
  } finally { counted.restore(); }
}

for (const site of SITES)
  describe(`${site.suite}: ${site.name}`, () => {
    for (const way of WAYS) {
      const does = { answer: 'answers', reject: 'rejects', throws: 'throws as it is called', never: 'never answers' }[way];
      test(`after a pass, a call that ${does}: ${{ answer: 'the suite goes on', reject: 'its error fails the step', throws: 'its error fails the step', never: 'the step fails READ_LIMIT later, named' }[way]}`,
        (t) => check(t, site, true, way));
      test(`after the step's own failure, a call that ${does}: the step's failure is thrown${way === 'answer' ? '' : ', the call kept in the report'}`,
        (t) => check(t, site, false, way));
    }
  });

test('browser_regressions: a scan without the fallback has nothing to put back, and sets no limit', async (t) => {
  const counted = limitsCounted(t);
  try {
    const site = SITES.find(({ name }) => name.startsWith('createImageBitmap'));
    const page = standInPage({ ...site, isPutBack: () => false }, true, 'answer'), report = { cleanupErrors: [] };
    const seen = outcomeOf(regressions.scan(page, report, 'baseline', {}));
    await tick();
    assert.equal(seen.outcome?.error?.name, 'AssertionError', 'it goes on to read the rows, which the stand-in leaves empty');
    assert.deepEqual(page.calls.filter((call) => call.kind === 'evaluate').length, 2, 'the fixture and the board, nothing put back');
    assert.deepEqual(report, { cleanupErrors: [] });
    assert.equal(counted.limits, 0);
  } finally { counted.restore(); }
});

// What each suite hands those steps: the engine's own report, so that the
// names reach the report engines() writes. live_camera's first step is also
// played that way in a process of its own below.
test('each suite hands the steps that put the page back its engine\'s report', () => {
  const live = source('live_camera_regressions.cjs');
  for (const call of ['time("viewfinder layers",()=>layersAtEachScreen(page,report,server.base));',
    'time("320 px",()=>narrowScreen(page,report));',
    'time("live capture with automatic solving off",()=>captureWithoutAutoSolve(page,report));',
    'time("a page lying sideways",()=>pageLyingSideways(page,report));'])
    assert.ok(live.includes(call), call);
  const browser = source('browser_regressions.cjs');
  assert.match(browser, /engines\("recognition-regressions\.json", async \(page, report, name\) =>/);
  for (const call of ['report.scans.push(await scan(page, report, label, options));', 'await editorRegressions(page, report);',
    'await supersededImport(page, report);', 'await cameraOwnershipRegressions(page, report);', 'await confirmationRegressions(page, report);'])
    assert.ok(browser.includes(call), call);
  const scanner = source('scanner_repair_regressions.cjs');
  assert.match(scanner, /engines\("scanner-repairs\.json", async \(page, report\) =>/);
  for (const call of ['await exercise(page, server.base, report);', 'await oversizedWebp(page, report);', 'await importRegressions(page, report);'])
    assert.ok(scanner.includes(call), call);
  // No finally of a step in the three awaits a page call of its own any more.
  for (const [name, text] of [['live_camera', live], ['browser_regressions', browser], ['scanner_repair', scanner]])
    assert.doesNotMatch(text.replace(/\s+/g, ''), /finally\{(if\([^)]*\))?awaitpage\./, name);
});

// live_camera's catch reads its page after any failure, a step's clean-up cut
// short among them: it adds its reads' names to the list, which the clean-up's
// name heads.
describe('live_camera\'s reads after a failure keep the names of a clean-up cut short before them', () => {
  const page = (never) => ({ textContent: () => (never ? new Promise(() => {}) : Promise.resolve('')),
    evaluate: () => (never ? new Promise(() => {}) : Promise.resolve(null)),
    locator: () => ({ evaluate: () => (never ? new Promise(() => {}) : Promise.resolve(null)) }) });
  const READS = ['storageStatus', 'paintCount', 'visibility', 'cameraCalls', 'video', 'statusDetail', 'cameraHelp'];

  test('reads that answer leave the clean-up\'s name alone in the list', async () => {
    const report = { readsCutShort: [CUT_SHORT('viewport after 320 px')] };
    await camera.readAfterFailure(page(false), report);
    assert.deepEqual(report.readsCutShort, [CUT_SHORT('viewport after 320 px')]);
  });

  test('reads that never answer come after it, in the catch\'s order', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const report = { readsCutShort: [CUT_SHORT('viewport after 320 px')] };
    const seen = outcomeOf(camera.readAfterFailure(page(true), report));
    await tick();
    t.mock.timers.tick(READ_LIMIT); await tick();
    assert.deepEqual(seen.outcome, { value: undefined });
    assert.deepEqual(report.readsCutShort, [CUT_SHORT('viewport after 320 px'), ...READS.map(CUT_SHORT)]);
  });
});

// How a process ends that runs `args`, with what Node takes before them: its
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
// READ_LIMIT's and CLOSE_LIMIT's lengths that last a tenth of a second and
// are counted, the counts printed as the process exits. Nothing else such a
// run starts sets a timer of either length: the first step's call that puts
// the viewport back sets one of READ_LIMIT's, the catch's reads one more, and
// each browser's close one of CLOSE_LIMIT's.
const PRELOAD = `const children = require("node:child_process"), { spawn } = children;
children.spawn = (command, args, options) => spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { ...options, cwd: ${JSON.stringify(os.tmpdir())} });
const { setTimeout: later } = globalThis, limits = { ${READ_LIMIT}: 0, ${CLOSE_LIMIT}: 0 };
globalThis.setTimeout = (run, ms, ...args) => { if (Object.hasOwn(limits, ms)) { limits[ms]++; ms = 100; } return later(run, ms, ...args); };
process.on("exit", () => console.log("limits", JSON.stringify(limits)));
`;

// The reads live_camera's catch makes, as a page is asked for them, by the
// name its report gives each, and what a page answers them with.
const ASKED = {
  storageStatus: 'textContent #capture-storage-status', paintCount: 'evaluate ()=>window.livePaintCount',
  visibility: 'evaluate ()=>document.visibilityState', cameraCalls: 'evaluate ()=>window.liveGetUserMediaCalls',
  video: 'locator #video evaluate', statusDetail: 'textContent #status-detail', cameraHelp: 'textContent #camera-help',
};
const ANSWERS = { storageStatus: 'Picture saved in this browser.', paintCount: 17, visibility: 'visible', cameraCalls: 3,
  video: { muted: true, paused: false, width: 700 }, statusDetail: 'Detected 4 × 4.', cameraHelp: 'Hold the grid steady.' };
const FALLBACKS = { storageStatus: '', paintCount: null, visibility: null, cameraCalls: null, video: null, statusDetail: '', cameraHelp: '' };

// Playwright for live_camera: each engine's page plays the suite's first
// step, "viewfinder layers", which passes, or with STEP_FAILS fails at its
// first screen size; it answers the call that puts the viewport back as
// PUT_BACK says ("answer", "reject" or "never"), and fails the second step at
// its goto(), so that the suite's catch reads it, each read as READS says
// ("answer" or "never"). The page says on stdout when the viewport is put
// back, what it is asked for after that and when it takes its screenshot, the
// browser when it closes. With BROWSER_HANGS, Chromium's browser never
// closes, as while a WebKit child holds the browser's pipes. Each launch
// keeps the process alive until its browser closes, as a live browser's pipes
// do.
const PLAYWRIGHT = `const fs = require("node:fs");
const { PUT_BACK, READS, STEP_FAILS, BROWSER_HANGS } = process.env;
const ASKED = ${JSON.stringify(ASKED)}, ANSWERS = ${JSON.stringify(ANSWERS)};
const names = Object.fromEntries(Object.entries(ASKED).map(([name, what]) => [what, name]));
const engine = (name) => ({ async launch() {
  const pipes = setInterval(() => {}, 1000), say = (line) => console.log(name + " " + line), size = { width: 430, height: 932 };
  let pages = 0, after = false;
  const read = (what, otherwise) => {
    if (!after) return Promise.resolve(otherwise);
    say("is asked for " + (names[what] ?? what));
    return READS === "never" ? new Promise(() => {}) : Promise.resolve(ANSWERS[names[what]]);
  };
  const page = { on() {}, setDefaultTimeout() {}, url: () => "http://stand-in/", viewportSize: () => size,
    goto: async () => { if (++pages > 1) throw new Error("no site here"); },
    waitForSelector: async () => {}, click: async () => {}, waitForFunction: async () => {},
    setViewportSize: async (to) => {
      if (to !== size) { if (STEP_FAILS) throw new Error("the first screen size failed"); return; }
      say("puts the viewport back"); after = true;
      if (PUT_BACK === "reject") throw new Error("Target page, context or browser has been closed");
      if (PUT_BACK === "never") return new Promise(() => {});
    },
    evaluate: (fn) => {
      const what = "evaluate " + String(fn).replace(/\\s+/g, "");
      if (names[what]) return read(what);
      return Promise.resolve(what.includes("elementFromPoint")
        ? { video: [0, 0, 430, 600], canvas: [0, 0, 430, 600], videoPointer: "none", touched: "live-preview" } : undefined);
    },
    textContent: (selector) => read("textContent " + selector, ""),
    locator: (selector) => ({ isVisible: async () => selector === "#camera-panel", evaluate: () => read("locator " + selector + " evaluate") }),
    screenshot: async ({ path }) => { say("takes its screenshot"); fs.writeFileSync(path, ""); } };
  return { contexts: () => [], on() {}, off() {}, isConnected: () => true, version: () => "1.0",
    close: async () => {
      say("closes its browser");
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
async function ran(t, env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gridpuzzle-step-cleanups-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inTree = (name) => path.join(directory, name);
  for (const file of ['scripts/live_camera_regressions.cjs', 'scripts/harness.cjs', 'scripts/watch.cjs'])
    fs.cpSync(new URL(`../../${file}`, import.meta.url), inTree(file));
  fs.mkdirSync(inTree('node_modules/playwright'), { recursive: true });
  fs.writeFileSync(inTree('node_modules/playwright/index.js'), PLAYWRIGHT);
  fs.writeFileSync(inTree('preload.cjs'), PRELOAD);
  const ended = await finish(['-r', inTree('preload.cjs'), inTree('scripts/live_camera_regressions.cjs')], { cwd: directory,
    env: { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, BROWSER_ENGINES: '', PUT_BACK: env.PUT_BACK,
      READS: env.READS ?? 'answer', STEP_FAILS: env.STEP_FAILS ? '1' : '', BROWSER_HANGS: env.BROWSER_HANGS ? '1' : '' } });
  const lines = ended.stdout.trim().split(/\r?\n/), limits = /^limits (.+)$/.exec(lines.at(-1));
  const file = inTree('browser-artifacts/live-camera.json');
  const reports = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return { ...ended, lines, limits: limits && JSON.parse(limits[1]), reports };
}

// Side by side: each has a tree and a process of its own, and in Node 22
// --test-timeout limits a whole file.
describe('live_camera, run as it is, puts its viewport back after its first step and then fails as that says', { concurrency: true }, () => {
  const VIEWPORT = 'viewport after viewfinder layers', CLOSED = 'Target page, context or browser has been closed';
  for (const [what, env, failure, cutShort, rejected, chromiumCloses = []] of [
    ['the step passes and the viewport goes back: the second step\'s own failure, as ever', { PUT_BACK: 'answer' },
      'Error: no site here', [], undefined],
    ['the step passes and the viewport never goes back: the step fails, named', { PUT_BACK: 'never' },
      `Error: ${CUT_SHORT(VIEWPORT)}`, [CUT_SHORT(VIEWPORT)], undefined],
    ['the step fails and the viewport never goes back: the step\'s own failure, the call named', { PUT_BACK: 'never', STEP_FAILS: true },
      'Error: the first screen size failed', [CUT_SHORT(VIEWPORT)], undefined],
    ['the step fails and putting the viewport back rejects: the step\'s own failure, the call\'s error kept', { PUT_BACK: 'reject', STEP_FAILS: true },
      'Error: the first screen size failed', [], [`${VIEWPORT}: ${CLOSED}`]],
    // As in the WebKit hang: nothing answers, and the browser will not close.
    ['the step fails, nothing answers after it and the browser will not close', { PUT_BACK: 'never', STEP_FAILS: true, READS: 'never', BROWSER_HANGS: true },
      'Error: the first screen size failed', [CUT_SHORT(VIEWPORT), ...Object.keys(ASKED).map(CUT_SHORT)], undefined,
      ['browser: browser cleanup timed out']],
  ])
    test(`ends by itself when ${what}`, async (t) => {
      const { code, killed, stdout, stderr, lines, limits, reports } = await ran(t, env);
      assert.equal(killed, false, `it ended by itself: ${stdout}${stderr}`);
      assert.equal(code, 1, stderr);
      assert.ok(reports, `both reports written: ${stdout}`);
      assert.deepEqual(reports.map(({ browser, status, failure: thrown, cleanupErrors }) => [browser, status, thrown.split('\n')[0], cleanupErrors]),
        [['chromium', 'failed', failure, chromiumCloses], ['webkit', 'failed', failure, []]]);
      for (const report of reports) {
        assert.deepEqual(report.readsCutShort, cutShort, `${report.browser}'s readsCutShort`);
        assert.deepEqual(report.stepCleanupErrors, rejected, `${report.browser}'s stepCleanupErrors`);
        assert.deepEqual(Object.fromEntries(Object.keys(ASKED).map((name) => [name, report[name]])),
          env.READS === 'never' ? FALLBACKS : ANSWERS, `${report.browser}'s reads`);
      }
      // The viewport goes back first, then the catch reads the page, each read
      // once, and then the screenshot and the browser's close.
      for (const name of ['chromium', 'webkit'])
        assert.deepEqual(lines.filter((line) => line.startsWith(`${name} `) && !/^\w+ (\d|[\w ]+: [\d.]+ s$)/.test(line)).map((line) => line.slice(name.length + 1)),
          ['puts the viewport back', ...Object.keys(ASKED).map((read) => `is asked for ${read}`), 'takes its screenshot', 'closes its browser'], stdout);
      assert.deepEqual(limits, { [READ_LIMIT]: 4, [CLOSE_LIMIT]: 2 }, 'in each engine one limit for putting the viewport back and one for the catch\'s reads');
      assert.equal(/no answer within/.test(stderr), failure.includes('no answer within'),
        'a call cut short is printed only as the failure of a step that passed');
      // Nor is the call printed otherwise, by its name or its error.
      for (const text of [VIEWPORT, CLOSED])
        assert.equal(stderr.includes(text), failure.includes(text), `"${text}" is printed only as the failure of a step that passed`);
    });
});
