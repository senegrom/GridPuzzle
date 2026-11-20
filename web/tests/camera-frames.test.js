import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createScanDiagnostics } from '../scan-diagnostics.js';
import { createFrameScheduler } from '../live-frame-scheduler.js';

// live_camera's last read of its page after a failure: what the camera's
// frames are doing, over one second (the owner's choice of November 2026,
// after a wait for a freeze ran out in WebKit on the hosted runner with the
// video playing and the help line waiting for a new camera frame). The catch
// hands the camera panel's locator a function that runs in the page. Here it
// is taken from the catch itself, as the catch asks for it, and its text is
// run with the page's clock and timer in the test's hands: first on a
// stand-in for the panel whose report is the one scan-diagnostics.js makes,
// to see what the read keeps; then with the frame scheduler itself behind the
// panel (live-frame-scheduler.js), to see that the record reads as the
// suite's comment and web/TESTING.md say it does, case by case. Loading the
// suite needs no Playwright.
const require = createRequire(import.meta.url);
const camera = require('../../scripts/live_camera_regressions.cjs');

// What the catch asks the camera's panel for, and every locator it asks.
async function asked() {
  const locators = [];
  let run = null;
  const page = { textContent: async () => '', evaluate: async () => null,
    locator: (selector) => ({ evaluate: async (fn) => { locators.push(selector); if (selector === '#camera-panel') run = fn; return null; } }) };
  const report = {};
  await camera.readAfterFailure(page, report);
  return { run, locators, report };
}
// The catch's function with the page's timer and clock in place of this
// process's: its text, compiled with those two as names.
const compiled = (run, setTimeout, performance) => new Function('setTimeout', 'performance', `return (${run});`)(setTimeout, performance);

// The scan's own report, made by scan-diagnostics.js as a live scan makes it:
// fourteen events a tenth of a second apart, of which the read keeps the last
// twelve, the scheduler's numbers as its heartbeat hands them over, and much
// that the read does not keep.
const SCHEDULING = { mode: 'video-frame', fresh: false, callbackStalled: false, observed: 40, processed: 30, skipped: 10, duplicates: 3,
  intervalMilliseconds: 100, fallbacks: 0 };
function scanReport(scheduling = SCHEDULING) {
  let clock = 0;
  const diagnostics = createScanDiagnostics({ now: () => clock });
  diagnostics.begin('live', { type: 'auto', rows: 4, cols: 4, autoSolve: true });
  for (let n = 0; n < 14; n++) {
    clock = 100 * n;
    diagnostics.event(n % 2 ? { stage: 'reading', reason: 'full-read' } : { stage: 'tracking', reason: 'found' });
  }
  diagnostics.scheduling(scheduling);
  clock = 9000.5;
  return diagnostics.snapshot();
}
const KEPT_EVENTS = Array.from({ length: 12 }, (_, at) => `${at % 2 ? 'full-read' : 'found'} ${100 * (at + 2)}`);
const SCAN = (scheduling = SCHEDULING) => ({ source: 'live', stage: 'reading', reason: 'full-read', milliseconds: 9000.5, scheduling, events: KEPT_EVENTS });

// A camera panel for the read. `report` is what the diagnostics panel prepares
// (a function is asked each time). With `refuses`, the panel cannot prepare
// one: as the page's own does (diagnostics-ui.js), it then says why in its
// error line and leaves its preview as it was. `listens`: the video gives
// frame callbacks. `present(n)` is the browser presenting frame n: every
// callback asked for is called once, as requestVideoFrameCallback's are.
// `pass(ms)` moves the page's clock and runs the timers set.
function standInPanel({ report = scanReport(), refuses = null, diagnostics = true, view = 'live', listens = true,
  quality = { totalVideoFrames: 100, droppedVideoFrames: 2 }, tracks = [{ readyState: 'live', muted: false, enabled: true, label: 'not kept' }] } = {}) {
  const timers = [], callbacks = new Map(), clicks = [], cancelled = [], selectors = [];
  let clock = 5000, handles = 0;
  const preview = { textContent: '' }, error = { textContent: '' };
  const video = { paused: false, ended: false, readyState: 4, videoWidth: 700, currentTime: 12.5,
    srcObject: tracks && { getVideoTracks: () => tracks } };
  if (quality) { video.quality = { ...quality }; video.getVideoPlaybackQuality = () => video.quality; }
  if (listens) {
    video.requestVideoFrameCallback = (callback) => { callbacks.set(++handles, callback); return handles; };
    video.cancelVideoFrameCallback = (handle) => { cancelled.push(handle); callbacks.delete(handle); };
  }
  const nodes = { preview, error,
    prepare: { click() {
      clicks.push('prepare'); error.textContent = '';
      if (panel.refuses) { error.textContent = panel.refuses; return; }
      preview.textContent = JSON.stringify(typeof panel.report === 'function' ? panel.report() : panel.report, null, 2);
    } },
    clear: { click() { clicks.push('clear'); preview.textContent = ''; error.textContent = ''; } } };
  const panel = { report, refuses, video, clicks, cancelled, preview, error, timers, selectors, waiting: callbacks,
    getAttribute: (name) => (name === 'data-view' ? view : null),
    querySelector(selector) {
      selectors.push(selector);
      if (selector === '#video') return video;
      const key = /^#live-diagnostics \[data-diagnostic="(\w+)"\]$/.exec(selector)?.[1];
      return diagnostics ? nodes[key] ?? null : null;
    },
    present(frame) { for (const [handle, callback] of [...callbacks]) { callbacks.delete(handle); callback(clock, { presentedFrames: frame, mediaTime: frame / 12 }); } },
    pass(ms) { clock += ms; for (const timer of timers.splice(0)) timer.run(); },
    globals: [(run, ms) => { timers.push({ run, ms }); return timers.length; }, { now: () => clock }] };
  return panel;
}
const reads = (run, panel) => compiled(run, ...panel.globals)(panel);
const PLAYER = (rest = {}) => ({ paused: false, ended: false, ready: 4, width: 700, time: 12.5, total: 100, dropped: 2, decoded: null,
  tracks: [{ ready: 'live', muted: false, enabled: true }], ...rest });

test('the catch reads the camera\'s panel after the reads it always made, with nothing for a read that fails', async () => {
  const { run, locators, report } = await asked();
  assert.equal(typeof run, 'function');
  assert.deepEqual(locators, ['#video', '#camera-panel']);
  assert.equal(Object.keys(report).at(-2), 'frames', 'the last of the reads in the report, before the list of reads cut short');
  assert.equal(report.frames, null);
  const failing = { textContent: async () => '', evaluate: async () => null, locator: () => ({ evaluate: async () => { throw new Error('gone'); } }) };
  const failed = {};
  await camera.readAfterFailure(failing, failed);
  assert.equal(failed.frames, null);
  assert.deepEqual(failed.readsCutShort, []);
});

test('the read: the report and the player before and after one second, and the frame callbacks in between', async () => {
  const { run } = await asked(), panel = standInPanel();
  const reading = reads(run, panel);
  assert.deepEqual(panel.timers.map((timer) => timer.ms), [1000], 'one second');
  assert.deepEqual(panel.clicks, ['prepare', 'clear'], 'the report is prepared and its preview cleared again, before the second');
  assert.equal(panel.preview.textContent, '');
  assert.equal(panel.waiting.size, 1, 'one frame callback asked for');
  for (const frame of [53, 54, 55]) panel.present(frame);
  assert.equal(panel.waiting.size, 1, 'and asked for again after each');
  panel.report = scanReport({ ...SCHEDULING, duplicates: 6 });
  panel.video.quality.totalVideoFrames = 103; panel.video.currentTime = 13.5;
  panel.pass(1004);
  assert.deepEqual(await reading, { view: 'live',
    before: { scan: SCAN(), player: PLAYER() },
    callbacks: { count: 3, first: 53, last: 55 }, milliseconds: 1004,
    after: { scan: SCAN({ ...SCHEDULING, duplicates: 6 }), player: PLAYER({ total: 103, time: 13.5 }) } });
  assert.deepEqual(panel.clicks, ['prepare', 'clear', 'prepare', 'clear']);
  assert.equal(panel.preview.textContent, '', 'the preview is left cleared');
  assert.deepEqual(panel.cancelled, [4], 'the callback still asked for is given back');
  assert.equal(panel.waiting.size, 0);
  panel.present(56);
  assert.deepEqual(panel.timers, [], 'and nothing is left running in the page');
});

test('of the scan\'s report the read keeps where the scan stands, the scheduler\'s numbers and the last twelve events, and nothing else', async () => {
  const { run } = await asked(), panel = standInPanel();
  // The report as the page's own module makes it has what the read asks it for.
  for (const key of ['source', 'stage', 'reason', 'elapsedMilliseconds', 'scheduling', 'events', 'settings', 'lastReading', 'tracking'])
    assert.ok(Object.hasOwn(panel.report, key), key);
  assert.equal(panel.report.events.length, 14);
  const reading = reads(run, panel);
  panel.pass(1000);
  const { before } = await reading;
  assert.deepEqual(Object.keys(before.scan), ['source', 'stage', 'reason', 'milliseconds', 'scheduling', 'events']);
  assert.deepEqual(before.scan, SCAN());
  assert.deepEqual([before.scan.events[0], before.scan.events.at(-1)], ['found 200', 'full-read 1300']);
  assert.deepEqual(panel.selectors.filter((selector) => selector !== '#video').slice(0, 4),
    ['#live-diagnostics [data-diagnostic="prepare"]', '#live-diagnostics [data-diagnostic="error"]',
      '#live-diagnostics [data-diagnostic="preview"]', '#live-diagnostics [data-diagnostic="clear"]'],
    'the camera panel\'s own diagnostics, not the photo scan\'s');
});

test('a report the panel could not prepare is what the panel says of it, and a preview left from before is not taken for it', async () => {
  const { run } = await asked(), panel = standInPanel({ refuses: 'No current source picture is available.' });
  panel.preview.textContent = JSON.stringify(scanReport()); // Left there by whatever prepared a report before.
  const reading = reads(run, panel);
  panel.present(7);
  panel.pass(1000);
  const frames = await reading;
  assert.deepEqual([frames.before.scan, frames.after.scan], [{ error: 'No current source picture is available.' }, { error: 'No current source picture is available.' }]);
  assert.deepEqual(frames.before.player, PLAYER(), 'the player is read all the same');
  assert.deepEqual(frames.callbacks, { count: 1, first: 7, last: 7 }, 'and the callbacks');
  assert.deepEqual(panel.clicks, ['prepare', 'clear', 'prepare', 'clear'], 'the preview is cleared after a report that failed too');
});

test('a preview that is no report, and a panel without its diagnostics, are errors of the scan alone', async () => {
  const { run } = await asked();
  const empty = standInPanel({ report: () => undefined }); // JSON.stringify gives nothing: the preview holds "undefined".
  const first = reads(run, empty);
  empty.pass(1000);
  const unreadable = await first;
  assert.deepEqual(Object.keys(unreadable.before.scan), ['error']);
  assert.match(unreadable.before.scan.error, /JSON/);
  assert.deepEqual(unreadable.after.player, PLAYER());
  const bare = standInPanel({ diagnostics: false });
  const second = reads(run, bare);
  bare.present(3);
  bare.pass(1000);
  const frames = await second;
  assert.deepEqual(Object.keys(frames.before.scan), ['error']);
  assert.deepEqual(Object.keys(frames.after.scan), ['error']);
  assert.deepEqual(frames.before.player, PLAYER());
  assert.deepEqual(frames.callbacks, { count: 1, first: 3, last: 3 });
});

test('a browser whose video gives no frame callbacks: none are counted, and the rest is read', async () => {
  const { run } = await asked(), panel = standInPanel({ listens: false });
  const reading = reads(run, panel);
  panel.pass(1000);
  const frames = await reading;
  assert.equal(frames.callbacks, null, 'not a count of nought: nothing was listened to');
  assert.deepEqual(frames.after, { scan: SCAN(), player: PLAYER() });
});

test('the player\'s state as it is: paused, ended, without playback quality or a stream, with WebKit\'s decoded count', async () => {
  const { run } = await asked();
  for (const [change, expected] of [
    [(video) => { video.paused = true; }, { paused: true }],
    [(video) => { video.ended = true; }, { ended: true }],
    [(video) => { video.readyState = 1; video.videoWidth = 0; }, { ready: 1, width: 0 }],
  ]) {
    const panel = standInPanel();
    change(panel.video);
    const reading = reads(run, panel);
    panel.pass(1000);
    assert.deepEqual((await reading).before.player, PLAYER(expected));
  }
  const panel = standInPanel({ quality: null, tracks: null });
  panel.video.webkitDecodedFrameCount = 77;
  const reading = reads(run, panel);
  panel.pass(1000);
  assert.deepEqual((await reading).before.player, PLAYER({ total: null, dropped: null, decoded: 77, tracks: null }));
  assert.equal((await asked()).report.frames, null);
});

test('a player that will not give its counts, take the listener or give it back loses that alone, not the read', async () => {
  const { run } = await asked();
  const silent = standInPanel();
  silent.video.getVideoPlaybackQuality = () => { throw new Error('no quality'); };
  const first = reads(run, silent);
  silent.present(9);
  silent.pass(1000);
  const quiet = await first;
  assert.deepEqual(quiet.before.player, PLAYER({ total: null, dropped: null }));
  assert.deepEqual(quiet.callbacks, { count: 1, first: 9, last: 9 });
  const deaf = standInPanel();
  deaf.video.requestVideoFrameCallback = () => { throw new Error('no callbacks'); };
  const second = reads(run, deaf);
  deaf.pass(1000);
  const unheard = await second;
  assert.equal(unheard.callbacks, null, 'as a video that gives none');
  assert.deepEqual(unheard.after, { scan: SCAN(), player: PLAYER() });
  assert.deepEqual(deaf.cancelled, [], 'and nothing to give back');
  // One that takes the listener and refuses it when it is asked for again: what came is kept.
  const once = standInPanel(), take = once.video.requestVideoFrameCallback;
  let taken = 0;
  once.video.requestVideoFrameCallback = (callback) => { if (taken++) throw new Error('no more'); return take(callback); };
  const again = reads(run, once);
  once.present(5);
  once.pass(1000);
  assert.deepEqual((await again).callbacks, { count: 1, first: 5, last: 5 });
  assert.deepEqual(once.cancelled, [], 'with nothing left to give back');
  const stuck = standInPanel();
  stuck.video.cancelVideoFrameCallback = () => { throw new Error('gone'); };
  const third = reads(run, stuck);
  stuck.present(4);
  stuck.pass(1000);
  assert.deepEqual((await third).callbacks, { count: 1, first: 4, last: 4 });
});

test('a frame callback without a count is kept as nothing, and counted', async () => {
  const { run } = await asked(), panel = standInPanel();
  const reading = reads(run, panel);
  for (const [, callback] of [...panel.waiting]) { panel.waiting.clear(); callback(0, undefined); }
  panel.present(9);
  panel.pass(1000);
  assert.deepEqual((await reading).callbacks, { count: 2, first: null, last: 9 });
});

// How the record reads, with the scheduler itself behind the panel: its
// video, the report's module and the read share one clock, which the test
// moves a millisecond at a time. The camera's heartbeat is the part of
// live-camera.js's that matters here: it hands the scheduler's numbers to the
// report. `rvfc`: the video gives frame callbacks. `counts`: the player
// counts its frames. The paper gives twelve frames a second, as the suite's
// does; `advance(ms, frame)` asks `frame()` for the count of each frame the
// browser presents, or null for none.
function world({ rvfc = true, counts = true } = {}) {
  const FRAME = 83, timers = [], callbacks = new Map();
  let clock = 0, ids = 0, handles = 0, nextFrame = FRAME;
  const now = () => clock;
  const setTimer = (run, ms) => { timers.push({ id: ++ids, at: clock + ms, run }); return ids; };
  const clearTimer = (id) => { const at = timers.findIndex((timer) => timer.id === id); if (at >= 0) timers.splice(at, 1); };
  const video = { videoWidth: 700, videoHeight: 700, readyState: 4, paused: false, ended: false, currentTime: 0, total: 0,
    srcObject: { getVideoTracks: () => [{ readyState: 'live', muted: false, enabled: true }] } };
  if (counts) video.getVideoPlaybackQuality = () => ({ totalVideoFrames: video.total, droppedVideoFrames: 0 });
  if (rvfc) {
    video.requestVideoFrameCallback = (callback) => { callbacks.set(++handles, callback); return handles; };
    video.cancelVideoFrameCallback = (handle) => { callbacks.delete(handle); };
  }
  const diagnostics = createScanDiagnostics({ now });
  diagnostics.begin('live', { type: 'auto' });
  const scheduler = createFrameScheduler({ video, now, setTimer, clearTimer, onFrame() {},
    onHeartbeat: () => diagnostics.scheduling(scheduler.stats) });
  const preview = { textContent: '' }, error = { textContent: '' };
  const nodes = { preview, error, prepare: { click() { preview.textContent = JSON.stringify(diagnostics.snapshot()); } },
    clear: { click() { preview.textContent = ''; } } };
  const panel = { getAttribute: () => 'live',
    querySelector: (selector) => (selector === '#video' ? video : nodes[/data-diagnostic="(\w+)"/.exec(selector)[1]]) };
  async function advance(ms, frame) {
    for (const end = clock + ms; clock < end;) {
      clock++; video.currentTime = clock / 1000;
      let ran = false;
      if (clock >= nextFrame) {
        nextFrame += FRAME;
        const count = frame();
        if (count !== null) {
          video.total++;
          for (const [handle, callback] of [...callbacks]) { callbacks.delete(handle); callback(clock, { presentedFrames: count, mediaTime: clock / 1000 }); }
          ran = true;
        }
      }
      for (const timer of timers.filter((due) => due.at <= clock)) { clearTimer(timer.id); timer.run(); ran = true; }
      if (ran) for (let turn = 0; turn < 8; turn++) await null;
    }
  }
  return { video, scheduler, advance, callbacks, read: (run) => compiled(run, setTimer, { now })(panel) };
}
// What a case's record says: the read's own callbacks, and each of the
// scheduler's numbers and the player's count before and after its second.
const told = (frames) => {
  const pair = (key) => [frames.before.scan.scheduling[key], frames.after.scan.scheduling[key]];
  return { callbacks: frames.callbacks?.count ?? null, mode: pair('mode'), observed: pair('observed'), duplicates: pair('duplicates'),
    fallbacks: pair('fallbacks'), stalled: pair('callbackStalled'), total: [frames.before.player.total, frames.after.player.total] };
};
const VIDEO_FRAME = ['video-frame', 'video-frame'], FALLBACK = ['fallback', 'fallback'];

test('how the record reads: frames that are scanned', async () => {
  const { run } = await asked(), w = world();
  let count = 0;
  w.scheduler.start(); await w.advance(2500, () => ++count);
  const reading = w.read(run); await w.advance(1000, () => ++count);
  const says = told(await reading);
  assert.equal(says.callbacks, 12, 'the paper\'s twelve frames a second reach the read\'s own listener');
  assert.deepEqual(says.mode, VIDEO_FRAME);
  assert.equal(says.observed[1] - says.observed[0], 12, 'the frames observed go up with them');
  assert.deepEqual(says.duplicates, [0, 0]);
  assert.equal(says.total[1] - says.total[0], 12);
  assert.deepEqual(says.stalled, [false, false]);
});

test('how the record reads: frames that stopped', async () => {
  const { run } = await asked(), w = world();
  let count = 0;
  w.scheduler.start(); await w.advance(2500, () => ++count); await w.advance(2000, () => null);
  const reading = w.read(run); await w.advance(1000, () => null);
  const says = told(await reading);
  assert.equal(says.callbacks, 0, 'no callback in the second');
  assert.deepEqual(says.mode, VIDEO_FRAME);
  assert.equal(says.observed[0], says.observed[1], 'the frames observed stand still');
  assert.deepEqual(says.duplicates, [0, 0], 'no duplicate is counted');
  assert.equal(says.total[0], says.total[1], 'and the player\'s own count stands still');
  assert.deepEqual(says.stalled, [true, true]);
});

test('how the record reads: frames the scheduler takes for repeats, on a player that counts none', async () => {
  const { run } = await asked(), w = world({ counts: false });
  let count = 0;
  w.scheduler.start(); await w.advance(2500, () => ++count);
  count = 0; // A new player: its count of frames presented starts over, below the scheduler's.
  await w.advance(1000, () => ++count);
  const reading = w.read(run); await w.advance(1000, () => ++count);
  const says = told(await reading);
  assert.equal(says.callbacks, 12, 'callbacks come');
  assert.deepEqual(says.mode, VIDEO_FRAME);
  assert.equal(says.observed[0], says.observed[1], 'the frames observed stand still');
  assert.equal(says.duplicates[1] - says.duplicates[0], 12, 'and the duplicates go up with the callbacks');
  assert.deepEqual(says.stalled, [true, true], 'callbackStalled says that no callback has brought a NEW frame, though callbacks come');
  assert.deepEqual(says.total, [null, null]);
});

test('how the record reads: the same on a player that counts its frames, where the scheduler falls back to that count and scans again', async () => {
  const { run } = await asked(), w = world();
  let count = 0;
  w.scheduler.start(); await w.advance(2500, () => ++count);
  count = 0;
  await w.advance(2000, () => ++count);
  const reading = w.read(run); await w.advance(1000, () => ++count);
  const says = told(await reading);
  assert.deepEqual(says.mode, FALLBACK);
  assert.deepEqual(says.fallbacks, [1, 1]);
  assert.ok(says.observed[1] > says.observed[0], 'the frames observed go up again');
  assert.equal(says.duplicates[0], says.duplicates[1], 'and no more duplicates are counted');
  assert.deepEqual(says.stalled, [false, false], 'never in fallback mode');
});

test('how the record reads: callbacks with neither count moving, the scheduler\'s own callback lost or its guard dropping the frames', async () => {
  const { run } = await asked();
  // The scheduler's callback is never called again; the read's own is.
  const lost = world({ counts: false });
  let count = 0;
  lost.scheduler.start(); await lost.advance(2500, () => ++count);
  lost.callbacks.clear(); await lost.advance(1000, () => ++count);
  const first = lost.read(run); await lost.advance(1000, () => ++count);
  const unheard = told(await first);
  assert.equal(unheard.callbacks, 12);
  assert.equal(unheard.observed[0], unheard.observed[1]);
  assert.equal(unheard.duplicates[0], unheard.duplicates[1]);
  assert.deepEqual(unheard.mode, VIDEO_FRAME);
  // A video that is not ready: the scheduler's guard returns before it counts, and the player's state says why.
  const unready = world({ counts: false });
  count = 0;
  unready.scheduler.start(); await unready.advance(2500, () => ++count);
  unready.video.readyState = 1; await unready.advance(1000, () => ++count);
  const second = unready.read(run); await unready.advance(1000, () => ++count);
  const frames = await second, dropped = told(frames);
  assert.equal(dropped.callbacks, 12);
  assert.equal(dropped.observed[0], dropped.observed[1]);
  assert.equal(dropped.duplicates[0], dropped.duplicates[1]);
  assert.equal(frames.before.player.ready, 1);
});

test('how the record reads: in fallback mode frames that stopped count a duplicate every tenth of a second', async () => {
  const { run } = await asked();
  // A video without frame callbacks: fallback mode from the start, and no callback for the read either.
  const w = world({ rvfc: false });
  let count = 0;
  w.scheduler.start(); await w.advance(2500, () => ++count); await w.advance(2000, () => null);
  const reading = w.read(run); await w.advance(1000, () => null);
  const says = told(await reading);
  assert.equal(says.callbacks, null);
  assert.deepEqual(says.mode, FALLBACK);
  assert.equal(says.observed[0], says.observed[1], 'the frames observed stand still');
  assert.equal(says.duplicates[1] - says.duplicates[0], 10, 'ten heartbeats in the second, a duplicate each');
  assert.equal(says.total[0], says.total[1], 'the player\'s own count says that frames stopped');
  assert.deepEqual(says.stalled, [false, false]);
  // A scheduler that fell back (its own callback lost on a player that counts its frames), and then frames stop.
  const fallen = world();
  count = 0;
  fallen.scheduler.start(); await fallen.advance(2500, () => ++count);
  fallen.callbacks.clear(); await fallen.advance(2000, () => ++count); await fallen.advance(2000, () => null);
  const second = fallen.read(run); await fallen.advance(1000, () => null);
  const after = told(await second);
  assert.equal(after.callbacks, 0, 'the video gives callbacks, and none came');
  assert.deepEqual(after.mode, FALLBACK);
  assert.deepEqual(after.fallbacks, [1, 1]);
  assert.equal(after.observed[0], after.observed[1]);
  assert.equal(after.duplicates[1] - after.duplicates[0], 10);
  assert.equal(after.total[0], after.total[1]);
  assert.deepEqual(after.stalled, [false, false]);
});
