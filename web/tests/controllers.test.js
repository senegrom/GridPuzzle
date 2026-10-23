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

// --- task controller: Check and Hint are protected like Solve -------------
test("a running task disables Check and Hint until it finishes", () => {
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: false, disabled: false }); return nodes.get(id); };
  const tasks = createTaskController({ $, scanner: { cancel() {} }, status() {}, onStop() {} });
  tasks.begin();
  assert.equal($("check-play").disabled, true);
  assert.equal($("hint-play").disabled, true);
  tasks.finish();
  assert.equal($("check-play").disabled, false);
  assert.equal($("hint-play").disabled, false);
});

// --- task controller: the elapsed time, and a second line a task keeps -----
// The elapsed time replaces a running task's second line every half second
// (on a mock clock here). A task may keep the line it has just set (the photo
// flow keeps the promise of a Read that waits for the grid): the elapsed time
// then follows it, until another status replaces the line or the task ends.
test("the elapsed time replaces a task's second line unless the task keeps the line it shows", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const nodes = new Map(), $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: false, disabled: false, textContent: "" });
    return nodes.get(id);
  };
  const status = (text, detail = "") => { $("status-text").textContent = text; $("status-detail").textContent = detail; };
  const tasks = createTaskController({ $, scanner: { cancel() {} }, status, onStop() {} });
  t.after(() => tasks.stop());
  const TIME = String.raw`\d+\.\d seconds elapsed · Stop cancels this task\.`,
    ELAPSED = new RegExp(`^${TIME}$`), KEPT = new RegExp(`^Kept line\\. ${TIME}$`);
  const tick = () => { t.mock.timers.tick(500); return $("status-detail").textContent; };
  // A task that keeps nothing: the elapsed time replaces its line, as before.
  tasks.begin(); status("Working…", "A line of its own.");
  assert.match(tick(), ELAPSED);
  // A kept line: the elapsed time follows it, tick after tick.
  status("Waiting…", "Kept line."); tasks.keep("Kept line.");
  assert.match(tick(), KEPT); assert.match(tick(), KEPT);
  // Another status replaces it: the elapsed time replaces that status's line.
  status("Something else.", "Its own line.");
  assert.match(tick(), ELAPSED); assert.match(tick(), ELAPSED);
  // A line kept again, and the task ends with it on screen: the next task,
  // even before a status of its own, shows its elapsed time alone.
  status("Waiting…", "Kept line."); tasks.keep("Kept line.");
  assert.match(tick(), KEPT);
  tasks.finish();
  assert.match(tick(), KEPT, "no elapsed time once the task ends");
  tasks.begin();
  assert.match(tick(), ELAPSED);
  // Nothing is kept from a line not on screen, or while no task runs.
  status("Waiting…", "Another line."); tasks.keep("Kept line.");
  assert.match(tick(), ELAPSED);
  tasks.finish(); status("Idle.", "Kept line."); tasks.keep("Kept line.");
  tasks.begin();
  assert.match(tick(), ELAPSED);
});
