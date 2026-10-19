import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { boxShape, conflicts, makePuzzle } from "../model.js";
import { puzzleFromReadings } from "../scanner.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
function photoFlow(t, { layout = { rows: 6, cols: 6, boxRows: 3, boxCols: 2 }, type = "sudoku" } = {}) {
  const noop = () => {}, nodes = new Map(), errors = [], solves = [];
  const context = new Proxy({}, {
    get: (target, key) => target[key] ?? noop,
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const canvas = () => ({ width: 600, height: 600, getContext: () => context });
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      ...canvas(), value: "", hidden: false, checked: false, style: {},
      scrollIntoView: noop,
    });
    return nodes.get(id);
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  });
  globalThis.document = { addEventListener: noop, createElement: canvas };
  const state = { photo: canvas(), history: [], puzzle: makePuzzle(), result: null };
  const setLayout = (value) => {
    state.layout = { ...value };
    for (const [key, id] of [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]])
      $(id).value = String(value[key]);
  };
  setLayout(layout);
  $("puzzle-type").value = type;
  $("auto-solve").checked = true;
  const scanner = {
    async detect() {
      return {
        rows: 6, cols: 6, confidence: 0.99,
        corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }],
      };
    },
    async read(_photo, _corners, type, rows, cols) {
      const puzzle = makePuzzle(type === "auto" ? "sudoku" : type, rows, cols);
      puzzle.cells[0] = 1;
      return {
        puzzle, uncertain: [], cageUncertain: [], needsReview: type === "auto",
        notes: [], rectified: canvas(),
      };
    },
  };
  let epoch = 0;
  const stopTask = () => { epoch++; };
  setupPhotoFlow({
    $, state, scanner, stopTask, invalidate: stopTask, begin: () => ++epoch,
    finish: noop, fail: (error) => errors.push(error.message), render: noop,
    status: noop, remember: noop, persist: noop, drawBoard: noop,
    clearPhotoMapping: noop, solveNow: () => solves.push(structuredClone(state.puzzle)),
    boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline: noop,
  });
  return {
    $, state, scanner, errors, solves, setLayout, stopTask,
    async click(id) { $(id).onclick(); await tick(); },
  };
}

for (const type of ["sudoku", "killersudoku"])
  test(`${type}: Find grid preserves chosen 3-row by 2-column boxes through reading`, async (t) => {
    const flow = photoFlow(t, { type });
    await flow.click("detect-photo");
    assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
    await flow.click("read-photo");
    assert.deepEqual(flow.errors, []);
    assert.equal(flow.solves.length, 1);
    assert.deepEqual([flow.solves[0].boxRows, flow.solves[0].boxCols], [3, 2]);
  });

test("repeated detection does not revert an explicitly chosen orientation", async (t) => {
  const flow = photoFlow(t);
  await flow.click("detect-photo");
  await flow.click("detect-photo");
  assert.deepEqual([flow.$("box-rows").value, flow.$("box-cols").value], ["3", "2"]);
});

test("a fresh box factorization remains review-gated even with confident explicit Sudoku OCR", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 2, boxCols: 3 });
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.match(flow.state.notes.join(" "), /2 rows × 3 columns.*not read from the photograph/);
  assert.equal(flow.solves.length, 0);
});

test("re-detecting a proposed box layout cannot silently promote it to a chosen layout", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  await flow.click("detect-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.equal(flow.solves.length, 0);
});

test("a user's compatible box correction replaces the proposal without being overwritten", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  flow.setLayout({ rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
  await flow.click("detect-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, false);
  assert.equal(flow.solves.length, 1);
  assert.deepEqual([flow.solves[0].boxRows, flow.solves[0].boxCols], [3, 2]);
});

test("changing box controls while OCR is pending cannot clear the scan's proposal review", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  const pending = deferred(), read = flow.scanner.read;
  flow.scanner.read = async (...args) => { await pending.promise; return read(...args); };
  await flow.click("read-photo");
  flow.setLayout({ rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
  pending.resolve();
  await tick();
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.deepEqual([flow.state.puzzle.boxRows, flow.state.puzzle.boxCols], [2, 3]);
  assert.equal(flow.solves.length, 0);
});

test("proposed Sudoku boxes do not add a review gate to a non-boxed family", async (t) => {
  const flow = photoFlow(t, { type: "numbrix", layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, false);
  assert.equal(flow.solves.length, 1);
});

test("preserving a box layout never clears the scanner's own uncertainty", async (t) => {
  const flow = photoFlow(t, { type: "auto" });
  await flow.click("detect-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.equal(flow.solves.length, 0);
});

// The box controls describe the printed puzzle, upright, and a reading comes
// back upright however the photograph lies, so Rotate keeps them. (It used to
// transpose them with the photograph, which put them in another frame than
// the reading's: photo-geometry-1 of the 2026-10-19 review.)
test("rotating a square photograph keeps its chosen non-square boxes", async (t) => {
  const flow = photoFlow(t);
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.solves.length, 1);
  assert.deepEqual([flow.solves[0].boxRows, flow.solves[0].boxCols], [3, 2]);
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
});

test("rotating a photograph of a grid that is not square swaps its rows and columns, not its boxes", async (t) => {
  const flow = photoFlow(t, { type: "numbrix", layout: { rows: 4, cols: 6, boxRows: 2, boxCols: 3 } });
  // No lattice found: only Rotate keeps the controls in step with the crop.
  flow.scanner.detect = async () => ({ rows: 0, cols: 0, confidence: 0.3,
    corners: [{ x: 10, y: 10 }, { x: 590, y: 10 }, { x: 590, y: 590 }, { x: 10, y: 590 }] });
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 4, boxRows: 2, boxCols: 3 });
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 4, cols: 6, boxRows: 2, boxCols: 3 });
});

test("rotating a proposed box layout preserves the need to confirm it", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  await flow.click("rotate-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.deepEqual([flow.state.puzzle.boxRows, flow.state.puzzle.boxCols], [2, 3]);
  assert.match(flow.state.notes.join(" "), /2 rows × 3 columns.*not read from the photograph/);
  assert.equal(flow.solves.length, 0);
});

for (const [boxRows, boxCols] of [[0, 6], [1.5, 4], [3, 3]])
  test(`invalid ${boxRows} by ${boxCols} box settings become a reviewable proposal`, async (t) => {
    const flow = photoFlow(t, { layout: { rows: 6, cols: 6, boxRows, boxCols } });
    await flow.click("detect-photo");
    await flow.click("read-photo");
    assert.deepEqual(flow.errors, []);
    assert.equal(flow.state.needsReview, true);
    assert.equal(flow.solves.length, 0);
  });

test("an obsolete detection cannot change the pending layout", async (t) => {
  const flow = photoFlow(t), pending = deferred(), detect = flow.scanner.detect;
  flow.scanner.detect = () => pending.promise;
  await flow.click("detect-photo");
  flow.stopTask();
  flow.setLayout({ rows: 4, cols: 4, boxRows: 2, boxCols: 2 });
  pending.resolve(await detect());
  await tick();
  assert.deepEqual(flow.errors, []);
  assert.deepEqual(flow.state.layout, { rows: 4, cols: 4, boxRows: 2, boxCols: 2 });
});

// Leave these inputs invalid AFTER detection, as happens when a user edits
// Sudoku settings and then selects a family whose box controls are hidden.
for (const type of ["latinsquare", "futoshiki", "numbrix", "hidato", "kenken", "kakuro", "slitherlink", "str8ts"])
  for (const value of ["", "not-a-number", "-1", "1.5", "26"])
    test(`${type}: hidden box value ${JSON.stringify(value)} cannot block Read`, async t => {
      const flow = photoFlow(t, { type });
      await flow.click("detect-photo");
      flow.$("box-rows").value = flow.$("box-cols").value = value;
      let reads = 0; const read = flow.scanner.read;
      flow.scanner.read = (...args) => { reads++; return read(...args); };
      await flow.click("read-photo");
      assert.equal(reads, 1); assert.deepEqual(flow.errors, []);
      assert.equal(flow.state.puzzle.type, type);
      assert.deepEqual([flow.state.puzzle.rows, flow.state.puzzle.cols], [6, 6]);
    });
for (const type of ["sudoku", "killersudoku"])
  for (const value of ["", "not-a-number", "-1", "1.5", "26"])
    test(`${type}: relevant invalid box value ${JSON.stringify(value)} still blocks Read`, async t => {
      const flow = photoFlow(t, { type });
      await flow.click("detect-photo");
      const accepted = flow.state.puzzle;
      flow.$("box-rows").value = flow.$("box-cols").value = value;
      let reads = 0; flow.scanner.read = () => { reads++; throw Error("must not read"); };
      await flow.click("read-photo");
      assert.equal(reads, 0); assert.equal(flow.errors.length, 1);
      assert.equal(flow.state.puzzle, accepted);
    });

// The reader checks a reading for duplicates under the size's default boxes
// (2 × 3 for 6 × 6); the photo flow sets the chosen boxes afterwards and
// solves under those. A digit repeated inside a chosen box must be flagged,
// so that a misread never solves automatically.
const digit = (cell, text) => ({ kind: "value", cell, text, confidence: 96, x: 0, y: 0, w: 10, h: 30 });
function readingOf(entries) {
  return async (_photo, _corners, type, rows, cols) => ({
    ...puzzleFromReadings({ entries: entries.map((entry) => ({ ...entry })), black: Array(rows * cols).fill(false),
      meta: { rows, cols, boxes: true }, mask: new Uint8Array(100), width: 10, height: 10,
      // One cage per row keeps a Killer partition out of the way.
      cageAreas: type === "killersudoku" ? Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * cols + c)) : null },
    type, rows, cols),
    rectified: { width: 600, height: 600, getContext() {} },
  });
}
// Two 4s at r1c1 and r3c2: inside one 3 × 2 box, in two different 2 × 3 boxes.
const repeatedIn3x2 = [digit(0, "4"), digit(13, "4"), digit(3, "1"), digit(10, "2"), digit(20, "3"), digit(33, "5")];
for (const type of ["sudoku", "killersudoku"])
  test(`${type}: a digit repeated inside a chosen 3 × 2 box is flagged and never solves automatically`, async (t) => {
    const flow = photoFlow(t, { type });
    flow.scanner.read = readingOf(repeatedIn3x2);
    await flow.click("detect-photo");
    await flow.click("read-photo");
    assert.deepEqual(flow.errors, []);
    assert.deepEqual([flow.state.puzzle.boxRows, flow.state.puzzle.boxCols], [3, 2]);
    assert.deepEqual([...conflicts(flow.state.puzzle)].sort((a, b) => a - b), [0, 13]);
    assert.deepEqual([...flow.state.uncertain].sort((a, b) => a - b), [0, 13]);
    assert.equal(flow.solves.length, 0);
  });
test("the same digits in two different chosen boxes are not flagged and solve automatically", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 6, cols: 6, boxRows: 2, boxCols: 3 } });
  flow.scanner.read = readingOf(repeatedIn3x2);
  await flow.click("detect-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.deepEqual([...flow.state.uncertain], []);
  assert.equal(flow.solves.length, 1);
});

// A box layout taken from the grid's size is suggested only where the size
// leaves a choice, and a suggestion retires once the user decides the boxes:
// by confirming the reading it came with (Solve, Check or Hint clear that
// board's review, as app.js confirmTranscription does here) or by setting
// other boxes. Each photograph arrives through the file input.
function photographs(t, layout) {
  const noop = () => {}, nodes = new Map(), errors = [], solves = [];
  const context = new Proxy({}, { get: (target, key) => target[key] ?? noop });
  const canvas = () => ({ width: 600, height: 600, getContext: () => context });
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { ...canvas(), value: "", hidden: false, checked: false, style: {}, scrollIntoView: noop });
    return nodes.get(id);
  };
  const originals = ["document", "createImageBitmap"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, d] of originals) { if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key]; } });
  globalThis.document = { addEventListener: noop, createElement: canvas };
  globalThis.createImageBitmap = async () => ({ width: 600, height: 600, close: noop });
  const state = { photo: null, corners: null, history: [], puzzle: makePuzzle(), result: null,
    uncertain: new Set(), cageUncertain: new Set(), needsReview: false, notes: [] };
  const setLayout = (value) => {
    state.layout = { ...value };
    for (const [key, id] of [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]])
      $(id).value = String(value[key]);
  };
  setLayout(layout);
  $("puzzle-type").value = "sudoku";
  $("auto-solve").checked = true;
  let size = 9, epoch = 0;
  // A clean reading: the first row 1 … n, nothing else.
  const scanner = {
    detect: async () => ({ rows: size, cols: size, confidence: 0.99,
      corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }] }),
    read: async (_photo, _corners, type, rows, cols) => ({
      ...puzzleFromReadings({ entries: Array.from({ length: cols }, (_, c) => digit(c, String(c + 1))),
        black: Array(rows * cols).fill(false), meta: { rows, cols, boxes: true }, mask: new Uint8Array(100), width: 10, height: 10 },
      type, rows, cols),
      rectified: canvas(),
    }),
  };
  const confirm = () => { state.uncertain.clear(); state.cageUncertain.clear(); state.needsReview = false; state.notes = []; };
  const stopTask = () => { epoch++; };
  setupPhotoFlow({
    $, state, scanner, stopTask, invalidate: stopTask, begin: () => ++epoch,
    finish: noop, fail: (error) => errors.push(error.message), render: noop,
    status: noop, remember: () => rememberEdit(state), persist: noop, drawBoard: noop, clearPhotoMapping: noop,
    solveNow: () => { confirm(); solves.push(structuredClone(state.puzzle)); },
    boxDefault: boxShape, setLayout, getJobId: () => epoch, setDeadline: noop,
  });
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 2, 88, 0, 0, 2, 88,
    8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]);
  const flow = {
    $, state, errors, setLayout, confirm,
    // A new photograph of an n × n grid, and its grid found.
    async photograph(n) {
      size = n;
      await $("photo-file").onchange({ target: { files: [new Blob([png])], value: "photo" } });
      assert.deepEqual(errors, []);
    },
    // Find grid again on the same photograph, which now finds n × n.
    async findGrid(n) {
      size = n;
      await $("detect-photo").onclick();
      assert.deepEqual(errors, []);
    },
    // Read with the controls as they stand.
    async read() {
      const before = solves.length;
      $("read-photo").onclick(); await tick();
      assert.deepEqual(errors, []);
      return { autoSolved: solves.length > before, needsReview: state.needsReview,
        boxNote: state.notes.some((note) => /was suggested from the grid size/.test(note)),
        boxes: [state.puzzle.boxRows, state.puzzle.boxCols] };
    },
    async scan(n) { await flow.photograph(n); return flow.read(); },
    // Undo as app.js does it: the board, then the controls from its layout.
    undo() { restoreEdit(state, state.history.pop()); setLayout(state.layout || state.puzzle); },
  };
  return flow;
}
const gated = { autoSolved: false, needsReview: true, boxNote: true };
const clear = { autoSolved: true, needsReview: false, boxNote: false };
const outcome = ({ autoSolved, needsReview, boxNote }) => ({ autoSolved, needsReview, boxNote });

for (const n of [4, 9, 25])
  test(`a ${n} × ${n} grid's boxes are its only shape: no suggestion to confirm after a size switch`, async (t) => {
    const flow = photographs(t, { rows: 6, cols: 6, boxRows: 2, boxCols: 3 });
    const read = await flow.scan(n), side = Math.sqrt(n);
    assert.deepEqual(outcome(read), clear);
    assert.deepEqual(read.boxes, [side, side]);
  });
for (const [n, boxes] of [[6, [2, 3]], [16, [4, 4]]])
  test(`a ${n} × ${n} grid's suggested ${boxes.join(" × ")} boxes still wait for confirmation`, async (t) => {
    const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
    const read = await flow.scan(n);
    assert.deepEqual(outcome(read), gated);
    assert.deepEqual(read.boxes, boxes);
  });
test("confirming the reading a suggestion came with retires it: the next photographs at that size solve", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  flow.confirm();
  for (let photo = 2; photo <= 3; photo++) {
    const read = await flow.scan(6);
    assert.deepEqual(outcome(read), clear, `photograph ${photo}`);
    assert.deepEqual(read.boxes, [2, 3]);
  }
});
test("a confirmed suggestion no longer holds a repeat Read of the same photograph", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  flow.confirm();
  assert.deepEqual(outcome(await flow.read()), clear);
});
test("confirming the reading of an earlier suggestion does not retire a newer one", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  // Find grid finds 8 × 8 on the same photograph: a new suggestion, 2 × 4,
  // while the board is still the 6 × 6 reading, which the user then confirms.
  await flow.findGrid(8);
  flow.confirm();
  const read = await flow.read();
  assert.deepEqual(outcome(read), gated); assert.deepEqual(read.boxes, [2, 4]);
});
test("Undo of a repeat Read brings back the reading the suggestion came with: confirming it retires the suggestion", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  // Read the same photograph again, unconfirmed, and undo that Read: the
  // board is the first reading again, and the suggestion is that reading's.
  assert.deepEqual(outcome(await flow.read()), gated);
  flow.undo();
  assert.equal(flow.state.needsReview, true);
  flow.confirm();
  const read = await flow.read();
  assert.deepEqual(outcome(read), clear); assert.deepEqual(read.boxes, [2, 3]);
});
test("an unconfirmed suggestion still waits for confirmation on the next photograph", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  assert.deepEqual(outcome(await flow.scan(6)), gated);
});
test("confirming another board does not retire a suggestion no reading has shown yet", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  await flow.photograph(6);
  // The board on screen, an earlier 9 × 9, is confirmed; the suggestion from
  // this 6 × 6 photograph's detection has not been read yet.
  flow.state.needsReview = false; flow.state.puzzleSource = 1;
  assert.deepEqual(outcome(await flow.read()), gated);
});
test("setting other boxes retires a suggestion, and setting its boxes again is the user's own choice", async (t) => {
  const flow = photographs(t, { rows: 9, cols: 9, boxRows: 3, boxCols: 3 });
  assert.deepEqual(outcome(await flow.scan(6)), gated);
  flow.setLayout({ rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
  const chosen = await flow.scan(6);
  assert.deepEqual(outcome(chosen), clear); assert.deepEqual(chosen.boxes, [3, 2]);
  flow.setLayout({ rows: 6, cols: 6, boxRows: 2, boxCols: 3 });
  const again = await flow.scan(6);
  assert.deepEqual(outcome(again), clear); assert.deepEqual(again.boxes, [2, 3]);
});
