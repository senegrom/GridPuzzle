import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { MAX_REVIEW_NOTES, MAX_REVIEW_NOTE_LENGTH, restoreSession, saveSession } from "../session.js";
import { boxShape, fitPlay, makePuzzle } from "../model.js";
import { createBackup, parsePuzzleFile, puzzleDefinition } from "../backup.js";
import { puzzleFromReadings } from "../scanner.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";
import { retainPhotoSource } from "../photo-detail.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function photoImports(t) {
  const nodes = new Map(), queue = [], errors = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: false });
    return nodes.get(id);
  };
  const originals = ["document", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.document = { addEventListener() {} };
  globalThis.Image = class {
    decode() {
      const next = queue.shift();
      next.started.resolve();
      return next.decode.promise;
    }
  };
  let epoch = 0;
  const stopTask = () => { epoch++; };
  setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask,
    getJobId: () => epoch,
    fail: (error) => errors.push(error.message),
  });
  return {
    errors, stopTask,
    async choose(id = "photo-file") {
      const request = { started: deferred(), decode: deferred() };
      queue.push(request);
      const input = { files: [new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,16,0,0,0,16])])], value: "photo" };
      const completed = $(id).onchange({ target: input });
      await request.started.promise;
      return { completed, reject: request.decode.reject, input };
    },
  };
}
test("active photo decode failures still report an error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  first.reject(Error("Image cannot be decoded"));
  await first.completed;
  assert.deepEqual(imports.errors, ["Image cannot be decoded"]);
  assert.equal(first.input.value, "");
});
test("cancelling a photo decode suppresses its delayed error", async (t) => {
  const imports = photoImports(t), first = await imports.choose();
  imports.stopTask();
  first.reject(Error("Obsolete photo error"));
  await first.completed;
  assert.deepEqual(imports.errors, []);
});
test("an older native-photo failure cannot replace a newer import error", async (t) => {
  const imports = photoImports(t), first = await imports.choose("native-file"), second = await imports.choose();
  second.reject(Error("Current photo error"));
  await second.completed;
  first.reject(Error("Obsolete camera photo error"));
  await first.completed;
  assert.deepEqual(imports.errors, ["Current photo error"]);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

// --- photo-flow: captured still, track listeners, Escape -----------------
async function cameraHarness(t, { capture = null, play = async () => {} } = {}) {
  const { setupPhotoFlow } = await import("../photo-flow.js");
  const nodes = new Map(), statuses = [], listeners = {}, tracks = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "", style: {}, focus() { this.focused = (this.focused || 0) + 1; }, getContext: () => ({ clearRect() {} }) });
    return nodes.get(id);
  };
  for (const key of ["navigator", "document"]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const handlers = new Map();
  globalThis.document = { hidden: false, body: { classList: { add() {}, remove() {} } },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      listeners[type] = event => { for (const cb of [...handlers.get(type)]) cb(event); };
    },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
  };
  const track = { stopped: 0, events: {}, stop() { this.stopped++; }, addEventListener(type, fn) { this.events[type] = fn; } };
  tracks.push(track);
  const stream = { getTracks: () => tracks };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  $("video").play = play;
  let liveStarted = 0, liveStopped = 0;
  const flow = setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask() {}, status: (...args) => statuses.push(args),
    savePicture: async () => true,
    liveFactory: () => ({ start() { liveStarted++; }, stop() { liveStopped++; }, capture: () => capture }),
  });
  return { $, flow, statuses, listeners, track, get liveStarted() { return liveStarted; }, get liveStopped() { return liveStopped; } };
}

const stillPicture = () => ({ photo: {}, annotated: {}, found: null, corners: null, createdAt: 1 });

test("hiding the page keeps a captured still on screen but releases a live camera", async (t) => {
  const h = await cameraHarness(t, { capture: stillPicture() });
  await h.$("camera").onclick();
  assert.equal(h.liveStarted, 1);
  await h.$("take-photo").onclick();
  await tick();
  assert.equal(h.$("camera-panel").hidden, false);
  assert.equal(h.track.stopped, 1, "the shutter releases the camera");
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, false, "a still holds no camera and must survive an app switch");
  assert.equal(h.$("use-live-capture").hidden, false);
  globalThis.document.hidden = false;
  await h.$("retake-photo").onclick();
  assert.equal(h.liveStarted, 2);
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, true, "a live camera is released when the page is hidden");
  assert.equal(h.track.stopped, 2);
});

test("track-ended listeners are attached before playback is awaited", async (t) => {
  const playback = deferred();
  const h = await cameraHarness(t, { play: () => playback.promise });
  const opening = h.$("camera").onclick();
  await tick(); await tick();
  assert.equal(typeof h.track.events.ended, "function", "a stream that dies during play() must still close the panel");
  h.track.events.ended();
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera disconnected/);
  playback.resolve();
  await opening;
  assert.equal(h.liveStarted, 0, "playback resolving after the stream ended must not start a preview");
});

test("Escape closes the full-screen camera and returns focus to its opener", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  assert.equal(h.$("close-camera").focused, 1, "focus moves into the panel when it opens");
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera closed/);
  assert.equal(h.$("camera").focused, 1);
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera").focused, 1, "Escape with the panel closed is not ours");
});

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

function readings(text = "3") {
  return { entries: [
    { kind: "value", cell: 0, text: "1", confidence: 99 },
    { kind: "blackvalue", cell: 4, text, confidence: 99 },
  ], black: [false, false, false, false, true, false, false, false, false],
  meta: { boxes: false, rows: 3, cols: 3 }, mask: new Uint8Array(900), width: 30, height: 30 };
}

function scanned() { return puzzleFromReadings(readings(), "auto", 3, 3); }

function stateFor(found) {
  return { ...found, uncertain: new Set(found.cellUncertain), cageUncertain: new Set(),
    history: [], play: [], hints: new Set() };
}

function webp(kind, width, height, prefix = false) {
  const size = kind === "VP8L" ? 5 : 10, extra = prefix ? 10 : 0,
    bytes = new Uint8Array(20 + size + size % 2 + extra), view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
  text(0, "RIFF"); text(8, "WEBP"); view.setUint32(4, bytes.length - 8, true);
  if (prefix) { text(12, "TEST"); view.setUint32(16, 1, true); }
  const at = 12 + extra, data = at + 8;
  text(at, kind); view.setUint32(at + 4, size, true);
  if (kind === "VP8L") { bytes[data] = 0x2f; view.setUint32(data + 1, (width - 1) | ((height - 1) << 14), true); }
  else if (kind === "VP8 ") { text(data + 3, "\x9d\x01\x2a"); view.setUint16(data + 6, width, true); view.setUint16(data + 8, height, true); }
  else for (const [pos, value] of [[data + 4, width - 1], [data + 7, height - 1]])
    for (let i = 0; i < 3; i++) bytes[pos + i] = (value >>> (i * 8)) & 255;
  return bytes;
}

function harness(t) {
  const descriptors = ["document", "Image", "createImageBitmap"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  t.after(() => { for (const [k, d] of descriptors) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } });
  const noop = () => {}, ctx = new Proxy({}, { get: (o, k) => o[k] ?? noop }),
    canvas = () => ({ width: 600, height: 600, getContext: () => ctx }), nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { ...canvas(), value: "", checked: false, hidden: false, style: {}, scrollIntoView: noop });
    return nodes.get(id);
  };
  globalThis.document = { createElement: canvas, addEventListener: noop };
  let bitmapCalls = 0, fullCalls = 0, closed = 0, epoch = 0, mappingsCleared = 0;
  globalThis.createImageBitmap = async (_file, options) => {
    bitmapCalls++; assert.ok(options.resizeWidth <= 1600);
    return { width: 1600, height: 1600, close() { closed++; } };
  };
  globalThis.Image = class { naturalWidth = 600; naturalHeight = 600; async decode() { fullCalls++; } };
  const state = stateFor(scanned()); state.photo = canvas();
  state.corners = [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }];
  const errors = [], scanner = { async detect() { return { rows: 3, cols: 3, confidence: 0.99, corners: state.corners }; } };
  const setLayout = (layout) => {
    state.layout = { ...layout };
    for (const [k, id] of [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]]) $(id).value = String(layout[k]);
  };
  setLayout({ rows: 3, cols: 3, boxRows: 1, boxCols: 3 });
  const stopTask = () => ++epoch;
  setupPhotoFlow({ $, state, scanner, stopTask, invalidate: stopTask, begin: stopTask, finish: noop,
    fail: (e) => errors.push(e.message), render: noop, status: noop, remember: () => rememberEdit(state),
    persist: noop, drawBoard: noop, clearPhotoMapping: () => mappingsCleared++, solveNow: noop,
    boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline: noop });
  return { $, state, scanner, errors, stopTask, counts: () => ({ bitmapCalls, fullCalls, closed, mappingsCleared }),
    import: (bytes) => $("photo-file").onchange({ target: { files: [new Blob([bytes])], value: "photo" } }) };
}

test("a highly compressed 36MP WebP takes the resized route, never full decode", async (t) => {
  const h = harness(t);
  await h.import(webp("VP8L", 6000, 6000));
  assert.deepEqual(h.errors, []);
  assert.equal(h.counts().bitmapCalls, 1); assert.equal(h.counts().fullCalls, 0); assert.equal(h.counts().closed, 1);
});

for (const bitmap of [undefined, async () => { throw Error("Unavailable"); }])
  test("36MP WebP is rejected before full decode when resized decoding is unavailable", async (t) => {
    const h = harness(t); globalThis.createImageBitmap = bitmap;
    await h.import(webp("VP8L", 6000, 6000));
    assert.equal(h.counts().fullCalls, 0); assert.match(h.errors[0], /cannot downscale/);
  });

test("unknown and above-budget images never reach either decoder", async (t) => {
  const h = harness(t);
  await h.import(new Uint8Array([1, 2, 3]));
  await h.import(webp("VP8X", 20000, 10000));
  assert.equal(h.errors.length, 2);
  assert.equal(h.counts().bitmapCalls, 0); assert.equal(h.counts().fullCalls, 0);
});

test("small WebP still has a safe full-decode fallback", async (t) => {
  const h = harness(t); globalThis.createImageBitmap = undefined;
  await h.import(webp("VP8L", 600, 600));
  assert.deepEqual(h.errors, []); assert.equal(h.counts().fullCalls, 1);
});

for (const outcome of ["success", "failure", "cancel"])
  test(`Find grid preserves undo and the puzzle on ${outcome}`, async (t) => {
    const h = harness(t), s = h.state;
    rememberEdit(s); s.puzzle.cells[0] = 2; rememberEdit(s); s.puzzle.cells[0] = 3;
    const history = structuredClone(s.history), before = structuredClone(s.puzzle), corners = s.corners;
    let resume;
    if (outcome === "failure") h.scanner.detect = async () => { throw Error("Detector unavailable"); };
    if (outcome === "cancel") h.scanner.detect = () => new Promise((resolve) => { resume = resolve; });
    const task = h.$("detect-photo").onclick();
    if (outcome === "cancel") { h.stopTask(); resume({ rows: 9, cols: 9, corners: [] }); }
    await task;
    assert.deepEqual(s.history, history); assert.deepEqual(s.puzzle, before);
    if (outcome !== "success") { assert.equal(s.corners, corners); assert.equal(h.counts().mappingsCleared, 0); }
    restoreEdit(s, s.history.pop()); assert.equal(s.puzzle.cells[0], 2);
  });
