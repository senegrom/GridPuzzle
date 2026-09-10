import test from "node:test";
import assert from "node:assert/strict";
import { makePuzzle, boxShape, changePuzzleType, fitBlackReadings, checkSolveReady, normalizePuzzle } from "../model.js";
import { puzzleFromReadings } from "../scanner.js";
import { setupPhotoFlow } from "../photo-flow.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";
import { saveSession, restoreSession } from "../session.js";
import { sniffDimensions } from "../image-dimensions.js";

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
test("one numbered black reading survives automatic type correction and remains flagged", () => {
  const found = scanned();
  assert.equal(found.puzzle.type, "hidato");
  assert.deepEqual(found.blackReadings, [{ cell: 4, value: 3 }]);
  assert.ok(found.cellUncertain.includes(4));
  const corrected = changePuzzleType(found.puzzle, "str8ts", found.blackReadings);
  const explicit = puzzleFromReadings(readings(), "str8ts", 3, 3).puzzle;
  assert.deepEqual(corrected, explicit);
  assert.equal(found.puzzle.cells[4], "#");
  assert.doesNotThrow(() => checkSolveReady(corrected));
});
test("raw evidence is bounded and cannot replace a manually edited cell", () => {
  const p = scanned().puzzle;
  const raw = [{ cell: 4, value: 3 }, { cell: 4, value: 1 }, { cell: 0, value: 2 },
    { cell: -1, value: 2 }, { cell: 12, value: 2 }, null, { cell: 4, value: 1e12 }];
  assert.deepEqual(fitBlackReadings(p, raw), [{ cell: 4, value: 3 }]);
  p.cells[4] = 2;
  assert.equal(changePuzzleType(p, "str8ts", raw).cells[4], 2);
  assert.deepEqual(fitBlackReadings(p, raw), []);
  assert.deepEqual(fitBlackReadings(p, {}), []);
});
test("out-of-range black readings stay flagged but cannot be installed as invalid Str8ts clues", () => {
  const found = puzzleFromReadings(readings("12"), "auto", 3, 3);
  assert.ok(found.cellUncertain.includes(4));
  assert.equal(changePuzzleType(found.puzzle, "str8ts", found.blackReadings).cells[4], "#");
  assert.doesNotThrow(() => checkSolveReady(changePuzzleType(found.puzzle, "str8ts", found.blackReadings)));
});
test("pending evidence survives autosave and undo without entering exported puzzle data", () => {
  const state = stateFor(scanned());
  let saved;
  const storage = { set(_key, value) { saved = value; }, get() { return saved; } };
  rememberEdit(state);
  saveSession(storage, state);
  assert.equal(Object.hasOwn(saved.puzzle, "blackReadings"), false);
  saved.cellUncertain = [];
  const restored = restoreSession(storage);
  assert.deepEqual(restored.blackReadings, [{ cell: 4, value: 3 }]);
  assert.ok(restored.uncertain.includes(4));
  assert.ok(restored.needsReview);
  assert.equal(changePuzzleType(restored.puzzle, "str8ts", restored.blackReadings).cells[4], 3);
  state.blackReadings[0].value = 1;
  restoreEdit(state, state.history.pop());
  assert.deepEqual(state.blackReadings, [{ cell: 4, value: 3 }]);
});
for (const op of [null, "", false, {}, 1])
  test(`invalid cage operator ${JSON.stringify(op)} fails before Python starts`, () => {
    const p = makePuzzle("kenken", 2);
    p.cages = [1, 2, 2, 1].map((target, i) => ({ cells: [i], target, op }));
    assert.throws(() => normalizePuzzle(p), /operator/);
    assert.throws(() => checkSolveReady(p), /operator/);
  });
test("omitted and explicit sum operators remain accepted", () => {
  for (const op of [undefined, "+"]) {
    const p = makePuzzle("kenken", 2);
    p.cages = [1, 2, 2, 1].map((target, i) => ({ cells: [i], target, ...(op === undefined ? {} : { op }) }));
    assert.doesNotThrow(() => checkSolveReady(normalizePuzzle(p)));
  }
});

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
for (const kind of ["VP8 ", "VP8L", "VP8X"])
  test(`${kind} dimensions are read, including padded preceding chunks and nonzero byte offsets`, () => {
    for (const prefix of [false, true]) {
      const bytes = webp(kind, 6000, 4000, prefix), padded = new Uint8Array(bytes.length + 7);
      padded.set(bytes, 7);
      assert.deepEqual(sniffDimensions(padded.subarray(7)), { width: 6000, height: 4000 });
      for (let end = 0; end < bytes.length - 2; end++)
        assert.doesNotThrow(() => sniffDimensions(bytes.subarray(0, end), bytes.length));
    }
  });
test("truncated, forged and unrecognized image headers are rejected", () => {
  const bytes = webp("VP8L", 6000, 6000);
  assert.equal(sniffDimensions(bytes.subarray(0, 24), bytes.length), null);
  new DataView(bytes.buffer).setUint32(16, 1000, true);
  assert.equal(sniffDimensions(bytes), null);
  assert.equal(sniffDimensions(new TextEncoder().encode('<svg width="99999"/>')), null);
  assert.equal(sniffDimensions(Uint8Array.of(137, 80, 78, 71, ...Array(20).fill(0))), null);
});

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
