import test from "node:test";
import assert from "node:assert/strict";
import { createTaskController } from "../task-controller.js";
import { captureEdit, restoreEdit, rememberEdit } from "../edit-history.js";
import { makePuzzle } from "../model.js";
import { prepareScan } from "../scan-analysis.js";
test("task generations invalidate earlier jobs and finish clears deadlines", async () => {
  const nodes = new Map(),
    events = [],
    $ = (id) => {
      if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: false });
      return nodes.get(id);
    };
  const tasks = createTaskController({
    $,
    scanner: { cancel: () => events.push("cancel") },
    status: () => {},
    onStop: (busy) => events.push(busy),
  });
  const first = tasks.begin();
  assert.ok(tasks.busy);
  tasks.setDeadline(() => events.push("expired"), 5);
  tasks.finish();
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(!events.includes("expired"));
  assert.equal(tasks.busy, false);
  const second = tasks.begin();
  assert.ok(second > first);
  tasks.stop();
  assert.ok(tasks.id > second);
  assert.equal(tasks.busy, false);
});
test("edit snapshots detach values and restore review metadata", () => {
  const state = {
    puzzle: makePuzzle(),
    uncertain: new Set([0]),
    needsReview: true,
    notes: ["review"],
    puzzleSource: 7,
    history: [],
    selected: [0],
  };
  const snapshot = captureEdit(state);
  rememberEdit(state);
  state.puzzle.cells[0] = 9;
  state.uncertain.clear();
  assert.equal(snapshot.puzzle.cells[0], null);
  restoreEdit(state, snapshot);
  assert.ok(state.uncertain.has(0));
  assert.equal(state.puzzleSource, 7);
  assert.equal(state.puzzle.cells[0], null);
});
test("off-thread scan preparation handles a whole image without DOM access", () => {
  const width = 100,
    height = 100,
    image = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    };
  const result = prepareScan(image, "sudoku", 4, 4);
  assert.equal(result.entries.length, 0);
  assert.equal(result.mask.length, width * height);
  assert.equal(result.g.length, width * height);
  assert.equal(result.black.length, 16);
});
test("undo retains a detached pending photo layout distinct from the board", () => {
  const state = {
    puzzle: makePuzzle("sudoku", 9),
    layout: { rows: "4", cols: "4", boxRows: "1", boxCols: "4" },
    uncertain: new Set(), needsReview: false, notes: [],
  };
  const snapshot = captureEdit(state);
  state.layout.rows = "6";
  state.puzzle = makePuzzle("sudoku", 4);
  restoreEdit(state, snapshot);
  assert.equal(state.puzzle.rows, 9);
  assert.deepEqual(state.layout, { rows: "4", cols: "4", boxRows: "1", boxCols: "4" });
});
