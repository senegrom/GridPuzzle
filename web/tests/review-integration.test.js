// Production controllers with controlled camera/OCR I/O. Native dialog event
// ordering and streamed capture handoff are also exercised by browser suites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, boxShape, fitPlay } from '../model.js';
import { createBackup, parsePuzzleFile, puzzleDefinition } from '../backup.js';
import { saveSession, restoreSession, MAX_REVIEW_NOTES, MAX_REVIEW_NOTE_LENGTH } from '../session.js';
import { createTrackingRecovery, MAX_VERIFIED_TRACK_AGE } from '../tracking-recovery.js';
import { setupPhotoFlow } from '../photo-flow.js';
import { setupClueReread } from '../clue-reread.js';
import { retainPhotoSource } from '../photo-detail.js';
import { puzzleFromReadings } from '../scanner.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function canvas(width = 600, height = 600) {
  const ctx = new Proxy({
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    drawImage(source) { this.source = source; },
  }, { get: (o, k) => o[k] ?? (() => {}) });
  return { width, height, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,aA==' };
}
function node(id) {
  const callbacks = new Map();
  return { ...canvas(), id, value: '', textContent: '', checked: false, hidden: false, disabled: false,
    open: false, style: {}, dataset: {}, focus() {}, scrollIntoView() {}, setAttribute() {},
    removeAttribute(key) { delete this[key]; },
    addEventListener(type, fn) { if (!callbacks.has(type)) callbacks.set(type, []); callbacks.get(type).push(fn); },
    emit(type) { for (const fn of callbacks.get(type) ?? []) fn({ type, target: this }); },
    pause() {}, load() {}, async play() {},
  };
}
function photoHarness(t) {
  const globals = ['document', 'window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  for (const id of ['scan-diagnostics', 'live-diagnostics'])
    $(id).querySelector = selector => $(id + '/' + selector.match(/"(.+)"/)[1]);
  const encoded = [];
  globalThis.document = { createElement() { const c = canvas(); encoded.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) },
  } });
  const puzzle = makePuzzle('latinsquare', 2); puzzle.cells[0] = 1;
  const state = { puzzle, photo: canvas(), rectified: canvas(200, 200),
    corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }],
    puzzleSource: 7, photoSource: 7, photoRows: 2, photoCols: 2,
    uncertain: new Set([0]), cageUncertain: new Set(), blackReadings: [], needsReview: true,
    notes: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [], history: [] };
  let epoch = 0, capture, found, saved;
  const errors = [], stopTask = () => ++epoch;
  const storage = { set: (_key, value) => { saved = value; }, get: key => key === 'gridpuzzle-session-v1' ? saved : null };
  const setLayout = layout => {
    state.layout = { ...layout };
    for (const [key, id] of [['rows', 'rows'], ['cols', 'cols'], ['boxRows', 'box-rows'], ['boxCols', 'box-cols']])
      $(id).value = String(layout[key]);
  };
  setLayout(puzzle); $('puzzle-type').value = 'latinsquare'; $('auto-capture').checked = true;
  const flow = setupPhotoFlow({ $, state, scanner: {
    read: async () => found,
    detect: async () => ({ rows: found.puzzle.rows, cols: found.puzzle.cols, confidence: .99, corners: state.corners }),
  }, stopTask, invalidate: stopTask, begin: stopTask, finish() {}, fail: e => errors.push(e.message),
  render() {}, status() {}, remember() {}, persist: () => saveSession(storage, state), drawBoard() {},
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() {}, boxDefault: boxShape,
  setLayout, getJobId: () => epoch, setDeadline() {}, savePicture: async () => true,
  liveFactory({ diagnostics }) { return {
    start() { diagnostics.event({ stage: 'checking', reason: 'read-complete', found: capture.found }); },
    // Deliberately leave the prepared report in place: the handoff itself must
    // retire consent, independently of whether camera shutdown already did so.
    stop() {}, capture: () => capture, diagnosticSource: () => ({ image: capture.photo, verified: true }),
  }; } });
  t.after(() => { flow.stopCamera(); for (const [key, desc] of globals) {
    if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key];
  } });
  const diag = (id = 'scan-diagnostics') => Object.fromEntries(
    ['prepare', 'image-toggle', 'preview', 'error', 'image', 'download'].map(key => [key, $(id + '/' + key)]));
  return { $, state, errors, storage, encoded, diag, setLayout,
    setFound: value => { found = value; }, setCapture: value => { capture = value; } };
}
function cageWarnings() {
  const n = 9, cw = 40, width = n * cw, mask = new Uint8Array(width * width), groups = [];
  let serial = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n;) {
    const length = Math.min(r + 1, n - c);
    for (let k = 0; k < length; k++) groups[r * n + c + k] = serial;
    serial++; c += length;
  }
  const paint = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++)
    if (xx >= 0 && yy >= 0 && xx < width && yy < width) mask[yy * width + xx] = 1; };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (c < n - 1 && groups[r * n + c] !== groups[r * n + c + 1])
      for (const offset of [-3, 3]) paint((c + 1) * cw + offset - 1, r * cw, 2, cw);
    if (r < n - 1 && groups[r * n + c] !== groups[(r + 1) * n + c])
      for (const offset of [-3, 3]) paint(c * cw, (r + 1) * cw + offset - 1, cw, 2);
  }
  return { ...puzzleFromReadings({ entries: [], black: Array(n * n).fill(false),
    meta: { boxes: true, rows: n, cols: n }, mask, width, height: width }, 'killersudoku', n, n),
  rectified: canvas(900, 900) };
}
for (const proposed of [false, true]) test(`maximum cage warnings plus photo context round-trip, suggested boxes ${proposed}`, async t => {
  const h = photoHarness(t), found = cageWarnings(), originalNotes = [...found.notes]; assert.equal(found.notes.length, 8);
  h.setFound(found); h.setLayout(found.puzzle); h.$('puzzle-type').value = 'killersudoku';
  if (proposed) {
    h.setLayout({ ...found.puzzle, boxRows: 0 });
    await h.$('detect-photo').onclick();
  }
  retainPhotoSource(h.state.photo, new Blob(['controlled image I/O']), { width: 5000, height: 4000 });
  h.$('read-photo').onclick(); await tick(); assert.deepEqual(h.errors, []);
  assert.equal(h.state.notes.length, proposed ? 10 : 9);
  assert.deepEqual(h.state.notes.slice(0, 8), originalNotes);
  const backup = createBackup(h.state), restored = parsePuzzleFile(backup), reloaded = restoreSession(h.storage);
  for (const value of [restored, reloaded]) {
    assert.deepEqual(value.notes, h.state.notes); assert.equal(value.needsReview, true);
    assert.deepEqual(value.uncertain, [...h.state.uncertain]);
    assert.deepEqual(value.cageUncertain, [...h.state.cageUncertain]);
  }
  assert.throws(() => puzzleDefinition(h.state), /review/i);
});
test('notes have one bounded session/backup contract without losing flags, pending evidence or Play', t => {
  const h = photoHarness(t), s = h.state; s.puzzle = makePuzzle('hidato', 2); s.puzzle.cells[0] = '#';
  s.blackReadings = [{ cell: 0, value: 7 }]; s.play = [null, 2, null, null]; s.hints = new Set([1]);
  s.notes = Array.from({ length: MAX_REVIEW_NOTES + 5 }, (_, i) => String(i) + 'x'.repeat(MAX_REVIEW_NOTE_LENGTH));
  const r = parsePuzzleFile(createBackup(s, 'play'));
  assert.equal(r.notes.length, MAX_REVIEW_NOTES); assert.ok(r.notes.every(n => n.length === MAX_REVIEW_NOTE_LENGTH));
  assert.deepEqual(r.blackReadings, s.blackReadings); assert.deepEqual(r.uncertain, [0]);
  assert.deepEqual(r.play, s.play); assert.deepEqual(r.hints, [1]); assert.equal(r.needsReview, true);
  const b = createBackup(s); b.session.notes.push('extra'); assert.throws(() => parsePuzzleFile(b), /review metadata/);
  b.session.notes.pop(); b.session.notes[0] += 'x'; assert.throws(() => parsePuzzleFile(b), /review metadata/);
});
for (const cadence of [250, 1000, 1800, MAX_VERIFIED_TRACK_AGE]) test(`sustained verified work clears isolated failures at ${cadence}ms`, () => {
  let time = 0; const gate = createTrackingRecovery({ now: () => time });
  for (let incident = 0; incident < 4; incident++) {
    gate.fail(); assert.equal(gate.blocked, false); assert.equal(gate.stats.failures, 1);
    time = gate.nextAttempt;
    for (let i = 0; i < 12; i++) { gate.succeeded(); time += cadence; }
    assert.equal(gate.stats.failures, 0);
  }
});
test('isolated, duplicate, expired and backoff replies cannot defeat the three-failure circuit', () => {
  let time = 0; const gate = createTrackingRecovery({ now: () => time }); gate.fail();
  for (time = 0; time < 2000; time += 200) gate.succeeded(); assert.equal(gate.stats.failures, 1);
  time = gate.nextAttempt; gate.succeeded();
  for (let i = 0; i < 20; i++) gate.succeeded(); assert.equal(gate.stats.failures, 1);
  time += MAX_VERIFIED_TRACK_AGE + 1; gate.succeeded(); assert.equal(gate.stats.failures, 1);
  gate.fail(); time = gate.nextAttempt; gate.succeeded(); gate.fail(); assert.equal(gate.blocked, true);
  for (let i = 0; i < 10; i++) { time += 1000; gate.succeeded(); }
  assert.equal(gate.blocked, true); assert.equal(gate.nextAttempt, Infinity);
  gate.reset(); assert.equal(gate.blocked, false); assert.equal(gate.stats.failures, 0);
});
test('capture handoff retires prior diagnostic consent and uses the exact raw photo with fresh opt-in', async t => {
  const h = photoHarness(t), found = { puzzle: h.state.puzzle, notes: [], rectified: canvas(200, 200),
    cellUncertain: [0], cageUncertain: [], needsReview: false };
  const photo = canvas(), annotated = canvas();
  h.setCapture({ photo, annotated, found, corners: h.state.corners, createdAt: 1 });
  await h.$('camera').onclick(); const live = h.diag('live-diagnostics');
  live.prepare.onclick(); live['image-toggle'].checked = true; live['image-toggle'].onchange();
  assert.equal(live.download.disabled, false);
  h.$('take-photo').onclick(); await tick(); h.$('use-live-capture').onclick();
  assert.deepEqual(h.errors, []); assert.equal(h.state.photo, photo);
  assert.equal(h.state.photoSource, h.state.puzzleSource); assert.equal(h.state.needsReview, true);
  for (const panel of [h.diag(), live]) {
    assert.equal(panel['image-toggle'].checked, false); assert.equal(panel.download.disabled, true);
    assert.equal(panel.preview.textContent, ''); assert.equal(panel.image.src, undefined);
  }
  const diag = h.diag(); diag.prepare.onclick();
  const report = JSON.parse(diag.preview.textContent);
  assert.equal(report.source, 'photo'); assert.equal(report.readingVerifiedForImage, true);
  assert.equal(report.privacy.includesImage, false); assert.equal(report.image, undefined);
  assert.equal(report.lastReading.needsReview, true); assert.deepEqual(report.lastReading.cellUncertain, [0]);
  assert.equal(report.geometry.coordinateSpace, 'source-preview'); assert.deepEqual(report.geometry.corners, h.state.corners);
  diag['image-toggle'].checked = true; diag['image-toggle'].onchange();
  assert.equal(diag.error.textContent, ''); assert.equal(diag.download.disabled, false);
  assert.equal(h.encoded.at(-1).getContext('2d').source, photo);
  assert.notEqual(h.encoded.at(-1).getContext('2d').source, annotated);
  assert.equal(JSON.parse(diag.preview.textContent).privacy.includesImage, true);
  await h.$('camera').onclick();
  assert.equal(diag['image-toggle'].checked, false); assert.equal(diag.download.disabled, true);
  assert.equal(diag.image.src, undefined);
});
test('queued close from the previous clue cannot cancel a reopened clue, but genuine close cancels it', async () => {
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  const p = makePuzzle('latinsquare', 2); p.cells = [1, 2, null, null];
  const selection = { puzzle: p, cell: 0, uncertain: new Set([0, 1]), image: canvas(200, 200),
    source: 7, photoSource: 7, rows: 2, cols: 2 };
  const jobs = []; let cancellations = 0;
  const reread = setupClueReread({ $, getSelection: () => selection,
    makeReader: () => ({ cancel() { cancellations++; }, readCells: (...args) => new Promise(resolve => jobs.push({ resolve, cell: args[3][0] })) }) });
  $('cell-dialog').open = true; reread.open(); const old = $('reread-clue').onclick();
  selection.cell = 1; selection.uncertain.delete(0); reread.open();
  const current = $('reread-clue').onclick(), before = cancellations;
  $('cell-dialog').emit('close'); assert.equal(cancellations, before);
  assert.equal($('reread-clue-panel').hidden, false); assert.equal($('reread-clue').disabled, true);
  jobs[0].resolve({}); await old; assert.equal($('reread-clue').disabled, true);
  $('cell-dialog').open = false; $('cell-dialog').emit('close');
  assert.equal(cancellations, before + 1); assert.equal($('reread-clue-panel').hidden, true);
  jobs[1].resolve({}); await current; assert.equal($('use-reread').hidden, true);
});
