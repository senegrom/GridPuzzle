import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// live_camera's last read of its page after a failure: what the camera's
// frames are doing, over one second (the owner's choice of November 2026,
// after a wait for a freeze ran out in WebKit on the hosted runner with the
// video playing and the help line waiting for a new camera frame). The catch
// hands the camera panel's locator a function that runs in the page. Here it
// is taken from the catch itself, as the catch asks for it, and run on a
// stand-in for the panel: a video that counts its frames and gives frame
// callbacks, the diagnostics panel's three nodes, and the page's clock and
// timer, which the test moves by hand. Loading the suite needs no Playwright.
const require = createRequire(import.meta.url);
const camera = require('../../scripts/live_camera_regressions.cjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));

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

// The scan's own report, as scan-diagnostics.js gives it: more than the read
// keeps. Fourteen events, of which the read keeps the last twelve.
const EVENTS = Array.from({ length: 14 }, (_, n) => ({ milliseconds: 100 * n, stage: 'tracking', reason: n < 12 ? 'found' : 'video-stalled' }));
const REPORT = (scheduling) => ({ format: 'gridpuzzle-diagnostic', version: 1, source: 'live', settings: { type: 'auto', autoSolve: true },
  stage: 'tracking', reason: 'video-stalled', elapsedMilliseconds: 9000.5, counters: {}, tracking: { transport: 'bitmap' }, scheduling,
  lastReading: { rows: 4 }, events: EVENTS, privacy: { includesImage: false } });
const SCHEDULING = { mode: 'video-frame', fresh: false, callbackStalled: false, observed: 40, processed: 30, skipped: 10, duplicates: 3,
  intervalMilliseconds: 100, fallbacks: 0 };
const KEPT_EVENTS = EVENTS.slice(2).map((event) => `${event.reason} ${event.milliseconds}`);
const SCAN = (scheduling) => ({ source: 'live', stage: 'tracking', reason: 'video-stalled', milliseconds: 9000.5, scheduling, events: KEPT_EVENTS });

// A camera panel for the read. `report` is what the diagnostics panel prepares
// (a function is asked each time; null leaves the preview empty, as when the
// report could not be prepared), `listens` whether the video gives frame
// callbacks. `present(n)` is the browser presenting frame n: every callback
// asked for is called once, as requestVideoFrameCallback's are. `pass(ms)`
// moves the page's clock and runs the timers set.
function standInPanel({ report = REPORT(SCHEDULING), view = 'live', listens = true, quality = { totalVideoFrames: 100, droppedVideoFrames: 2 },
  tracks = [{ readyState: 'live', muted: false, enabled: true, label: 'not kept' }] } = {}) {
  const timers = [], callbacks = new Map(), clicks = [], cancelled = [], selectors = [];
  let clock = 5000, handles = 0;
  const preview = { textContent: '' };
  const video = { paused: false, ended: false, readyState: 4, videoWidth: 700, currentTime: 12.5,
    srcObject: tracks && { getVideoTracks: () => tracks } };
  if (quality) { video.quality = { ...quality }; video.getVideoPlaybackQuality = () => video.quality; }
  if (listens) {
    video.requestVideoFrameCallback = (callback) => { callbacks.set(++handles, callback); return handles; };
    video.cancelVideoFrameCallback = (handle) => { cancelled.push(handle); callbacks.delete(handle); };
  }
  const panel = { report, video, clicks, cancelled, preview, timers, selectors, waiting: callbacks,
    getAttribute: (name) => (name === 'data-view' ? view : null),
    querySelector(selector) {
      selectors.push(selector);
      if (selector === '#video') return video;
      const key = /^#live-diagnostics \[data-diagnostic="(\w+)"\]$/.exec(selector)?.[1];
      return { prepare: { click() {
        clicks.push('prepare');
        const value = typeof panel.report === 'function' ? panel.report() : panel.report;
        preview.textContent = value === null ? '' : JSON.stringify(value, null, 2);
      } }, preview, clear: { click() { clicks.push('clear'); preview.textContent = ''; } } }[key] ?? null;
    },
    present(frame) { for (const [handle, callback] of [...callbacks]) { callbacks.delete(handle); callback(clock, { presentedFrames: frame, mediaTime: frame / 12 }); } },
    pass(ms) { clock += ms; for (const timer of timers.splice(0)) timer.run(); },
    globals: [(run, ms) => { timers.push({ run, ms }); return timers.length; }, { now: () => clock }] };
  return panel;
}
// The catch's function with the page's timer and clock in place of this
// process's: its text, compiled with those two as names.
const reads = (run, panel) => new Function('setTimeout', 'performance', `return (${run});`)(...panel.globals)(panel);
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

test('frames the scheduler takes for repeats: callbacks come in the second, the duplicates go up and the frames observed stand still', async () => {
  const { run } = await asked(), panel = standInPanel();
  const reading = reads(run, panel);
  assert.deepEqual(panel.timers.map((timer) => timer.ms), [1000], 'one second');
  assert.deepEqual(panel.clicks, ['prepare', 'clear'], 'the report is prepared and its preview cleared again, before the second');
  assert.equal(panel.preview.textContent, '');
  assert.equal(panel.waiting.size, 1, 'one frame callback asked for');
  for (const frame of [53, 54, 55]) panel.present(frame);
  assert.equal(panel.waiting.size, 1, 'and asked for again after each');
  panel.report = REPORT({ ...SCHEDULING, duplicates: 6 });
  panel.video.quality.totalVideoFrames = 103; panel.video.currentTime = 13.5;
  panel.pass(1004);
  assert.deepEqual(await reading, { view: 'live',
    before: { scan: SCAN(SCHEDULING), player: PLAYER() },
    callbacks: { count: 3, first: 53, last: 55 }, milliseconds: 1004,
    after: { scan: SCAN({ ...SCHEDULING, duplicates: 6 }), player: PLAYER({ total: 103, time: 13.5 }) } });
  assert.deepEqual(panel.clicks, ['prepare', 'clear', 'prepare', 'clear']);
  assert.equal(panel.preview.textContent, '', 'the preview is left cleared');
  assert.deepEqual(panel.cancelled, [4], 'the callback still asked for is given back');
  assert.equal(panel.waiting.size, 0);
  panel.present(56);
  assert.deepEqual(panel.timers, [], 'and nothing is left running in the page');
});

test('frames that stopped: no callback in the second, and the counts stand still', async () => {
  const { run } = await asked(), stalled = { ...SCHEDULING, callbackStalled: true }, panel = standInPanel({ report: REPORT(stalled) });
  const reading = reads(run, panel);
  panel.pass(1000);
  assert.deepEqual(await reading, { view: 'live', before: { scan: SCAN(stalled), player: PLAYER() },
    callbacks: { count: 0, first: null, last: null }, milliseconds: 1000, after: { scan: SCAN(stalled), player: PLAYER() } });
  assert.deepEqual(panel.cancelled, [1]);
});

test('frames that are scanned: the frames observed go up with the callbacks', async () => {
  const { run } = await asked(), panel = standInPanel({ view: 'frozen' });
  const reading = reads(run, panel);
  for (let frame = 200; frame < 212; frame++) panel.present(frame);
  const later = { ...SCHEDULING, fresh: true, observed: 52, processed: 40, skipped: 12 };
  panel.report = REPORT(later);
  panel.video.quality.totalVideoFrames = 112;
  panel.pass(1000);
  const frames = await reading;
  assert.deepEqual(frames.callbacks, { count: 12, first: 200, last: 211 });
  assert.deepEqual([frames.before.scan.scheduling.observed, frames.after.scan.scheduling.observed], [40, 52]);
  assert.deepEqual([frames.before.player.total, frames.after.player.total], [100, 112]);
  assert.equal(frames.view, 'frozen', 'the panel\'s own word for its view');
});

test('of the scan\'s report the read keeps where the scan stands, the scheduler\'s numbers and the last twelve events, and nothing else', async () => {
  const { run } = await asked(), panel = standInPanel();
  const reading = reads(run, panel);
  panel.pass(1000);
  const { before } = await reading;
  assert.deepEqual(Object.keys(before.scan), ['source', 'stage', 'reason', 'milliseconds', 'scheduling', 'events']);
  assert.equal(before.scan.events.length, 12);
  assert.deepEqual([before.scan.events[0], before.scan.events.at(-1)], ['found 200', 'video-stalled 1300']);
  assert.deepEqual(panel.selectors.filter((selector) => selector !== '#video').slice(0, 3),
    ['#live-diagnostics [data-diagnostic="prepare"]', '#live-diagnostics [data-diagnostic="preview"]', '#live-diagnostics [data-diagnostic="clear"]'],
    'the camera panel\'s own diagnostics, not the photo scan\'s');
});

test('a report that cannot be prepared is its error, each time, and the player and the callbacks are read all the same', async () => {
  const { run } = await asked(), panel = standInPanel({ report: null });
  const reading = reads(run, panel);
  panel.present(7);
  panel.pass(1000);
  const frames = await reading;
  for (const scan of [frames.before.scan, frames.after.scan]) {
    assert.deepEqual(Object.keys(scan), ['error']);
    assert.match(scan.error, /JSON/);
  }
  assert.deepEqual(frames.before.player, PLAYER());
  assert.deepEqual(frames.callbacks, { count: 1, first: 7, last: 7 });
  assert.deepEqual(panel.clicks, ['prepare', 'clear', 'prepare', 'clear'], 'the preview is cleared after a report that failed too');
});

test('a browser whose video gives no frame callbacks: none are counted, and the rest is read', async () => {
  const { run } = await asked(), panel = standInPanel({ listens: false });
  const reading = reads(run, panel);
  panel.pass(1000);
  const frames = await reading;
  assert.equal(frames.callbacks, null, 'not a count of nought: nothing was listened to');
  assert.deepEqual(frames.after, { scan: SCAN(SCHEDULING), player: PLAYER() });
});

test('a video without playback quality or a stream: WebKit\'s decoded count where there is one, and nothing for the rest', async () => {
  const { run } = await asked(), panel = standInPanel({ quality: null, tracks: null });
  panel.video.webkitDecodedFrameCount = 77;
  const reading = reads(run, panel);
  panel.pass(1000);
  assert.deepEqual((await reading).before.player, PLAYER({ total: null, dropped: null, decoded: 77, tracks: null }));
});

test('a frame callback without a count is kept as nothing, and counted', async () => {
  const { run } = await asked(), panel = standInPanel();
  const reading = reads(run, panel);
  for (const [, callback] of [...panel.waiting]) { panel.waiting.clear(); callback(0, undefined); }
  panel.present(9);
  panel.pass(1000);
  assert.deepEqual((await reading).callbacks, { count: 2, first: null, last: 9 });
});
