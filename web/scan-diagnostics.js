import { createMetricWindow } from "./scan-metrics.js";
const STAGES = new Set(['idle','detecting','quality','tracking','preparing','reading','checking','solving','complete','error']);
const REASONS = new Set(['ready','started','stopped','reset','settings-or-detection','grid-lost','content-changed',
  'found','no-grid','small','blur','contrast','full-read','targeted','identical-crops','ocr-complete','read-complete',
  'retry-skipped','retry-exhausted','video-stalled','clearer-frame-needed','targeted-complete','retry-expired','retry-rejected','retry-failed','retry-timeout',
  'worker-error','worker-paused','worker-backoff','worker-restarted','tracking-pending','unique','multiple','no-solution','invalid','unfinished','failed','cancelled',
  'manual-corners','review-required','auto-solve-off']);
const indices = (value, max = 625) => Array.isArray(value) ? [...new Set(value.filter(i => Number.isInteger(i) && i >= 0 && i < 625))].slice(0, max) : [];
const number = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const settingsOf = value => {
  const out = {};
  for (const key of ['type','rows','cols','boxRows','boxCols','enabled','autoSolve']) {
    const v = value?.[key];
    if (key === 'type') { if (typeof v === 'string' && /^[a-z]{1,24}$/.test(v)) out[key] = v; }
    else if (typeof v === 'boolean' || (Number.isInteger(v) && v >= 0 && v <= 25)) out[key] = v;
  }
  return out;
};
function readingOf(found) {
  const p = found?.puzzle;
  if (!p || !Array.isArray(p.cells) || p.cells.length > 625) return null;
  return { ...settingsOf(p), cells: p.cells.map(v => v === '#' || v === null || (Number.isInteger(v) && v >= 0 && v <= 625) ? v : null),
    cellUncertain: indices(found.cellUncertain ?? found.uncertain), cageUncertain: indices(found.cageUncertain),
    markedCells: indices(found.markedCells), needsReview: !!found.needsReview };
}

// In-memory, bounded and allowlisted. No image bytes, original filenames,
// URLs, stack traces, user notes, Play answers or solver solutions enter here.
export function createScanDiagnostics({ now = () => performance.now(), build = '__BUILD_ID__' } = {}) {
  let started = now(), source = 'none', settings = {}, stage = 'idle', reason = 'ready', reading = null, geometry = null;
  let events = [], timings = {}, stageAt = started, counters = {}, tracking = {}, scheduling = {};
  let paintMetrics = createMetricWindow(), workerMetrics = createMetricWindow(), ageMetrics = createMetricWindow();
  let paintRequests = 0, lastMetricFrame = -1, firstReading = null;
  const listeners = new Set();
  function notify() { for (const listener of listeners) { try { listener(); } catch { /* Diagnostics cannot interrupt scanning. */ } } }
  function event(value) {
    const next = STAGES.has(value.stage) ? value.stage : stage;
    const why = REASONS.has(value.reason) ? value.reason : 'failed';
    if (value.background !== true && next !== stage) { timings[stage] = (timings[stage] ?? 0) + now() - stageAt; stageAt = now(); stage = next; }
    const entry = { milliseconds: number(now() - started), stage: next, reason: why, ...(value.background ? {background:true} : {}) };
    if (value.targets) entry.targets = indices(value.targets, 12);
    for (const key of ['regions','calls','changed']) if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 10000) entry[key] = value[key];
    if (value.cancelledRead) counters.cancelledReads = (counters.cancelledReads ?? 0) + 1;
    if (value.cancelledSolve) counters.cancelledSolves = (counters.cancelledSolves ?? 0) + 1;
    if (stage === 'reading' && value.regions === undefined && ['full-read','targeted'].includes(why)) {
      const key = why === 'targeted' ? 'targetedReads' : 'fullReads'; counters[key] = (counters[key] ?? 0) + 1;
    }
    if (value.found) reading = readingOf(value.found);
    if (firstReading === null && why === 'read-complete' && reading && !value.found?.refining)
      firstReading = number(now() - started);
    if (!value.background) reason = why;
    const previous = events.at(-1);
    if (!previous || previous.stage !== next || previous.reason !== why || JSON.stringify(previous.targets) !== JSON.stringify(entry.targets) || value.calls !== undefined) {
      events.push(entry); events = events.slice(-64); notify();
    }
  }
  return {
    begin(kind, value) {
      started = stageAt = now(); source = ['live','photo'].includes(kind) ? kind : 'none'; settings = settingsOf(value);
      stage = 'idle'; reason = 'ready'; reading = geometry = null; events = []; timings = {}; counters = {}; tracking = {}; scheduling = {};
      paintMetrics = createMetricWindow(); workerMetrics = createMetricWindow(); ageMetrics = createMetricWindow();
      paintRequests = 0; lastMetricFrame = -1; firstReading = null; notify();
    },
    event,
    configure(value) { settings = settingsOf(value); reading = geometry = null; notify(); },
    geometry(found) {
      geometry = { rows: number(found.rows), cols: number(found.cols), confidence: number(found.confidence),
        width: number(found.width), height: number(found.height),
        coordinateSpace: ['source-preview', 'detector-input'].includes(found.coordinateSpace) ? found.coordinateSpace : null,
        corners: Array.isArray(found.corners) && found.corners.length === 4 ? found.corners.map(p => ({x:number(p.x),y:number(p.y)})) : null,
        quality: found.quality ? { score: number(found.quality.score), contrast: number(found.quality.contrast),
          cellPixels: number(found.quality.cellPixels), weakCells: indices(found.quality.weakCells),
          reason: ['small','blur','contrast'].includes(found.quality.reason) ? found.quality.reason : null } : null };
      notify();
    },
    rendering(value) {
      paintRequests++;
      if (value.painted) paintMetrics.add(value.milliseconds);
    },
    tracking(stats, frame) {
      if (Number.isSafeInteger(frame.frame) && frame.frame > lastMetricFrame) {
        lastMetricFrame = frame.frame;
        workerMetrics.add(stats?.milliseconds); ageMetrics.add(frame.age);
      }
      tracking = {};
      for (const key of ['submitted','completed','dropped','failures','milliseconds','active','queuedFrames','queuedAnchors']) tracking[key] = number(stats?.[key]);
      tracking.frame = number(frame.frame); tracking.ageMilliseconds = number(frame.age); tracking.verified = !!frame.matched;
      tracking.tier = frame.stale ? 'delayed' : 'live';
    },
    scheduling(stats) {
      scheduling = { mode: stats.mode === 'video-frame' ? 'video-frame' : 'fallback', fresh: !!stats.fresh, callbackStalled: !!stats.callbackStalled };
      for (const key of ['observed','processed','skipped','duplicates','intervalMilliseconds','fallbacks']) scheduling[key] = number(stats[key]);
    },
    snapshot() {
      return structuredClone({ format: 'gridpuzzle-diagnostic', version: 1, build, source, settings, stage, reason,
        elapsedMilliseconds: number(now() - started),
        stageMilliseconds: Object.fromEntries(Object.entries({...timings, [stage]: (timings[stage] ?? 0) + now() - stageAt}).map(([k,v]) => [k, number(v)])),
        counters, tracking, scheduling,
        performance: { firstCompletedReadingMilliseconds: firstReading, paintRequests,
          rendering: paintMetrics.snapshot(), trackingWorker: workerMetrics.snapshot(), trackingFrameAge: ageMetrics.snapshot() }, geometry, lastReading: reading, events,
        privacy: { includesImage: false, automaticUpload: false, includesSolutions: false } });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const STAGE_LABELS = Object.freeze({ idle: 'Ready', detecting: 'Finding the grid', quality: 'Checking image quality',
  tracking: 'Aligning and checking the current grid', preparing: 'Preparing the clue crops', reading: 'Reading printed clues',
  checking: 'Checking the readings', solving: 'Solving', complete: 'Finished', error: 'Could not complete this scan' });
export const REASON_LABELS = Object.freeze({ 'no-grid': 'No convincing grid found. Keep all four corners visible or adjust them manually.',
  small: 'The numbers occupy too few pixels. Move closer.', blur: 'The printed clues are blurred. Hold still.',
  contrast: 'The clues have low contrast. Change the light or camera angle.',
  'clearer-frame-needed': 'Some clues need a clearer view. Only those numeric cells will be retried; capture to check them manually.',
  'worker-paused': 'Tracking paused after repeated failures. Restart live scanning or save a picture for manual review.',
  'worker-backoff': 'Tracking will retry after a short delay. You can still capture a picture.',
  'worker-restarted': 'Live tracking restarted. A fresh frame and puzzle verification are required.',
  'worker-error': 'Background tracking failed. Capture a picture for manual review or restart the camera.',
  'content-changed': 'The printed content changed. Old readings were retired.',
  'grid-lost': 'The grid was lost. Old readings are not being displayed.',
  'identical-crops': 'The retry has the same crop pixels; no additional OCR evidence was counted.',
  'no-solution': 'These transcribed clues have no solution. Check the readings and puzzle rules.',
  multiple: 'These clues allow more than one solution. Check for a missing clue or rule.',
  unfinished: 'Search ended before a definitive result.', 'review-required': 'Check highlighted clues and confirm the rules.',
  'auto-solve-off': 'Clues can be read without revealing a solution.',
  'retry-skipped': 'No new crop evidence was read. The OCR retry allowance is unchanged; waiting for a clearer frame.',
  'retry-exhausted': 'Automatic retries finished. Capture to review the remaining clues manually.',
  'retry-timeout': 'The clue retry timed out. The previous reading is retained and only shown while verified.',
  'retry-failed': 'The clue retry failed. The previous reading is retained; capture to review.',
  'video-stalled': 'The camera has stopped presenting new frames. Old overlays are hidden; resume the camera or capture for review.',
  'retry-rejected': 'The retry did not match the original puzzle; its readings were not applied.',
  'targeted-complete': 'The selected clue proposals were refreshed. They still require review.',
});
