import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { boxShape, makePuzzle } from "../model.js";

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

test("rotating a square photograph also rotates its chosen non-square boxes", async (t) => {
  const flow = photoFlow(t);
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 2, boxCols: 3 });
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.solves.length, 1);
  assert.deepEqual([flow.solves[0].boxRows, flow.solves[0].boxCols], [2, 3]);
  await flow.click("rotate-photo");
  assert.deepEqual(flow.state.layout, { rows: 6, cols: 6, boxRows: 3, boxCols: 2 });
});

test("rotating a proposed box layout preserves the need to confirm it", async (t) => {
  const flow = photoFlow(t, { layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } });
  await flow.click("detect-photo");
  await flow.click("rotate-photo");
  await flow.click("read-photo");
  assert.deepEqual(flow.errors, []);
  assert.equal(flow.state.needsReview, true);
  assert.deepEqual([flow.state.puzzle.boxRows, flow.state.puzzle.boxCols], [3, 2]);
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
