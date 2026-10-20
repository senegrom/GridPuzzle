import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { restoreSession, saveSession } from "../session.js";
import { boxShape, fitPlay, makePuzzle } from "../model.js";
import { turnCue } from "../scanner.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";

// The live camera reads each frame the way it lies (orient: false), so a
// capture of a page held upside down or sideways reaches the editor turned,
// with confident wrong clues: upside down, 6s and 9s read as each other and
// 2s as 4s. When the capture's reading shows what makes Scanner.orient try a
// turn (turnCue), Review captured clues reads the still again as Read puzzle
// reads a photograph, and a reading taken turned replaces the live one, under
// review like every capture.

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function canvas(width = 600, height = 600) {
  const ctx = new Proxy({}, { get: (o, k) => o[k] ?? (() => {}) });
  return { width, height, getContext: () => ctx, toDataURL: () => "data:image/jpeg;base64,aA==" };
}
function node(id) {
  return { ...canvas(), id, value: "", textContent: "", checked: false, hidden: false, disabled: false, open: false,
    style: {}, dataset: {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, pause() {}, load() {}, async play() {} };
}

// The value regions of a 9 × 9 reading: `size` gives each glyph's height and
// width, `digits` the digit read in each region (null: unread), and `flagged`
// the regions read without confidence.
function reading({ digits, flagged = [], size = [30, 20], rows = 9, cols = 9, type = "sudoku" }) {
  const puzzle = makePuzzle(type, rows, cols), cells = Object.keys(digits).map(Number);
  for (const cell of cells) puzzle.cells[cell] = digits[cell];
  const uncertain = [...new Set([...flagged, ...cells.filter((cell) => digits[cell] === null)])];
  return { puzzle, entries: cells.map((cell) => ({ kind: "value", cell, text: String(digits[cell] ?? ""),
    confidence: uncertain.includes(cell) ? 40 : 95, h: size[0], w: size[1] })),
  cellUncertain: uncertain, uncertain, cageUncertain: [], blackReadings: [], noteSized: [],
  notes: ["12 cells need checking."], rectified: canvas(300, 300), needsReview: true };
}
// An upside-down page as the live camera reads it: twelve regions, four read
// with confidence (a 1, an 8 and two 9s that are printed 6s), none with a 2, 3
// or 5, glyphs taller than wide.
const UPSIDE_DOWN = { 0: 1, 10: 8, 20: 9, 30: 9, 40: 4, 50: 4, 60: null, 70: 7, 80: 1, 8: 6, 16: null, 24: 7 };
const upsideDown = () => reading({ digits: UPSIDE_DOWN, flagged: [40, 50, 70, 8, 24, 80] });
// A sideways page: glyphs wider than tall, two of twelve regions confident.
const sideways = () => reading({ digits: UPSIDE_DOWN, flagged: [20, 30, 40, 50, 70, 8, 24, 80, 0, 10], size: [20, 30] });
// The same page read upright: confident clues with a 2, 3 or 5.
const upright = () => reading({ digits: { 0: 2, 10: 3, 20: 6, 30: 5, 40: 1, 50: 9, 60: 8, 70: 7, 80: 4, 8: 9, 16: 2, 24: 5 } });

test("the cue: an upside-down reading asks for a half turn, a sideways one for a quarter turn, an upright one for none", () => {
  assert.equal(turnCue(upsideDown()), "half");
  assert.equal(turnCue(sideways()), "quarter");
  assert.equal(turnCue(upright()), null);
  // One confident number with a 2, 3 or 5 shows the way up; no confident
  // digit, or fewer than six measurable glyphs, shows nothing either way.
  assert.equal(turnCue(reading({ digits: { ...UPSIDE_DOWN, 20: 5 }, flagged: [40, 50, 70, 8, 24, 80] })), null);
  assert.equal(turnCue(reading({ digits: UPSIDE_DOWN, flagged: Object.keys(UPSIDE_DOWN).map(Number) })), null);
  assert.equal(turnCue(reading({ digits: { 0: 1, 10: 8, 20: 9, 30: null, 40: null }, flagged: [] , size: [20, 30] })), null);
  assert.equal(turnCue({ puzzle: makePuzzle("sudoku", 9), notes: [] }), null);
});

function harness(t, { type = "sudoku" } = {}) {
  const globals = ["document", "window", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  for (const id of ["scan-diagnostics", "live-diagnostics"])
    $(id).querySelector = (selector) => $(id + "/" + selector.match(/"(.+)"/)[1]);
  globalThis.document = { createElement: () => canvas(), addEventListener() {}, removeEventListener() {},
    body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) } } });
  const puzzle = makePuzzle("sudoku", 9);
  const state = { puzzle, photo: null, corners: null, uncertain: new Set(), cageUncertain: new Set(), blackReadings: [],
    needsReview: false, notes: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [], history: [] };
  let epoch = 0, capture = null, saved, answer = null;
  const reads = [], errors = [], statuses = [], solves = [];
  const storage = { set: (_key, value) => { saved = value; }, get: () => saved };
  const stopTask = () => ++epoch;
  const fields = [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]];
  const setLayout = (layout) => {
    state.layout = Object.fromEntries(fields.map(([key, id]) => { $(id).value = String(layout[key]); return [key, layout[key]]; }));
  };
  setLayout(puzzle); $("puzzle-type").value = type; $("auto-capture").checked = true; $("auto-solve").checked = true;
  const flow = setupPhotoFlow({ $, state, scanner: {
    read: (image, corners, readType, rows, cols, onProgress, options = {}) => {
      reads.push({ image, corners, type: readType, rows, cols, options });
      onProgress("Straightening the photograph…", null);
      return answer.promise;
    },
    detect: async () => { throw Error("no detection here"); },
  }, stopTask, invalidate: stopTask, begin: stopTask, finish() {}, fail: (e) => errors.push(e.message),
  render() {}, status: (text) => statuses.push(text), remember: () => rememberEdit(state),
  persist: () => saveSession(storage, state), drawBoard() {},
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() { solves.push(state.puzzle.cells); },
  boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline() {}, savePicture: async () => true,
  liveFactory: () => ({ start() {}, stop() {}, capture: () => capture,
    diagnosticSource: () => ({ image: capture.photo, verified: true }) }) });
  t.after(() => { flow.stopCamera(); for (const [key, d] of globals) {
    if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key];
  } });
  const corners = [{ x: 60, y: 50 }, { x: 540, y: 60 }, { x: 550, y: 540 }, { x: 50, y: 550 }];
  return { $, state, reads, errors, statuses, solves, storage, corners, stopTask,
    // The still read again answers with `found` (or rejects), when released.
    answer(found) { answer = deferred(); answer.found = found; return answer; },
    async review(found) {
      capture = { photo: canvas(), annotated: canvas(), corners: corners.map((p) => ({ ...p })), createdAt: 1, found };
      await $("camera").onclick(); $("take-photo").onclick(); await tick();
      $("use-live-capture").onclick();
      assert.deepEqual(errors, []);
    },
  };
}
// The still read again the right way up: the page's clues, clean, and the
// scanner's note naming the turn.
function turned(turns) {
  const found = upright();
  return { ...found, cellUncertain: [], uncertain: [], needsReview: false, turns,
    notes: [turns === 2 ? "The photograph was upside down: its digits read clearly better turned half a turn, so the crop corners were turned with it. Check the clues against the photograph."
      : "The photograph was read turned a quarter turn: check the clues against the photograph."] };
}

for (const [how, live, turns] of [["upside down", upsideDown, 2], ["sideways", sideways, 1], ["sideways", sideways, 3]])
  test(`a capture read ${how} is read again as a photograph, and the reading turned ${turns} replaces it, under review`, async (t) => {
    const h = harness(t), found = live(), answer = h.answer();
    await h.review(found);
    // The live reading is on the board while its picture is read again.
    assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
    assert.equal(h.statuses.at(-1), "Checking which way up the captured picture is…");
    assert.equal(h.reads.length, 1);
    const [read] = h.reads;
    assert.equal(read.image, h.state.photo); assert.deepEqual(read.corners, h.corners);
    assert.deepEqual([read.type, read.rows, read.cols], ["sudoku", 9, 9]);
    assert.notEqual(read.options.orient, false, "read as a photograph, orientation and all");
    answer.resolve(turned(turns)); await settle();
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.state.puzzle.cells, upright().puzzle.cells);
    assert.deepEqual([h.state.puzzle.boxRows, h.state.puzzle.boxCols], [3, 3]);
    assert.match(h.state.notes[0], turns === 2 ? /upside down/ : /quarter turn/);
    // Under review like every capture, also after a quarter turn, which a
    // photograph's Read solves automatically.
    assert.equal(h.state.needsReview, true); assert.deepEqual(h.solves, []);
    assert.deepEqual(h.state.corners, h.corners.map((_, i) => h.corners[(i + turns) % 4]));
    assert.equal(h.statuses.at(-1), "Captured clues read again, turned the right way up.");
    assert.equal(restoreSession(h.storage).needsReview, true);
    // Undo brings the live reading back.
    restoreEdit(h.state, h.state.history.pop());
    assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
    assert.deepEqual([...h.state.uncertain], found.cellUncertain);
  });

test("a capture whose picture reads the way it lies keeps its own reading", async (t) => {
  const h = harness(t), found = upsideDown(), answer = h.answer();
  await h.review(found);
  assert.equal(h.reads.length, 1);
  answer.resolve({ ...upright(), cellUncertain: [], uncertain: [], needsReview: false });
  await settle();
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
  assert.deepEqual([...h.state.uncertain], found.cellUncertain); assert.deepEqual(h.state.notes, found.notes);
  assert.equal(h.state.needsReview, true); assert.deepEqual(h.state.history.length, 1);
  assert.deepEqual(h.state.corners, h.corners);
  assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
});

test("a capture whose check fails keeps its own reading, without an error", async (t) => {
  const h = harness(t), found = upsideDown(), answer = h.answer();
  await h.review(found);
  answer.reject(Error("No printed clues found. Adjust the crop, dimensions or lighting.")); await settle();
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells); assert.equal(h.state.needsReview, true);
  assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
});

test("a check stopped before it ends, by an edit, Solve, Stop or another task, leaves the capture's reading", async (t) => {
  const h = harness(t), found = upsideDown(), answer = h.answer();
  await h.review(found);
  h.stopTask(); // as opening a cell to edit does (app.js openCell)
  answer.resolve(turned(2)); await settle();
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells); assert.equal(h.state.needsReview, true);
  assert.deepEqual(h.state.corners, h.corners);
});

const unchecked = {
  "an upright reading": () => upright(),
  "a reading too poor to show its glyphs": () => reading({ digits: { 0: 1, 10: 8, 20: 9 } }),
  "a grid that is not square": () => {
    const found = reading({ digits: { 0: 1, 1: 8, 2: 9, 3: 9, 4: 4, 5: 4, 6: null, 7: 7, 8: 1, 9: 6, 10: null, 11: 7 },
      flagged: [4, 5, 7, 8, 9, 11], rows: 6, cols: 7, type: "numbrix" });
    assert.equal(turnCue(found), "half");
    return found;
  },
};
for (const [what, live] of Object.entries(unchecked))
  test(`a capture of ${what} is handed over as it is, without reading its picture again`, async (t) => {
    const h = harness(t, { type: live().puzzle.type }), found = live();
    await h.review(found);
    assert.equal(h.reads.length, 0);
    assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells); assert.equal(h.state.needsReview, true);
    assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
  });
