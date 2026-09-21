import test from "node:test";
import assert from "node:assert/strict";
import { makePuzzle } from "../model.js";
import { saveSession, restoreSession } from "../session.js";
import { captureEdit, restoreEdit } from "../edit-history.js";
function store() {
  const data = new Map();
  return { get: (k) => data.get(k), set: (k, v) => data.set(k, v), data };
}
test("Reload preserves uncertain clues and rule confirmation without saving photographs", () => {
  const storage = store(),
    p = makePuzzle();
  p.cells[0] = 7;
  saveSession(storage, {
    puzzle: p,
    uncertain: new Set([0, 3]),
    needsReview: true,
    notes: ["Check type"],
    photo: { private: "IMAGE DATA" },
    result: { status: "unique" },
  });
  const restored = restoreSession(storage);
  assert.deepEqual(restored.uncertain, [0, 3]);
  assert.equal(restored.needsReview, true);
  assert.equal(restored.puzzle.cells[0], 7);
  const raw = JSON.stringify([...storage.data.values()]);
  assert.ok(!raw.includes("IMAGE DATA"));
  assert.ok(!raw.includes("unique"));
});
test("Confirmed clues stay confirmed", () => {
  const storage = store();
  saveSession(storage, {
    puzzle: makePuzzle(),
    uncertain: new Set(),
    needsReview: false,
    notes: [],
  });
  assert.equal(restoreSession(storage).needsReview, false);
});
test("Metadata is bounded and cannot reference nonexistent cells", () => {
  const storage = store();
  storage.set("gridpuzzle-session-v1", {
    puzzle: makePuzzle(),
    uncertain: [0, 0, -1, 900, true, "2"],
    notes: [false, "ok"],
    needsReview: false,
  });
  assert.deepEqual(restoreSession(storage).uncertain, [0]);
  assert.deepEqual(restoreSession(storage).notes, ["ok"]);
  assert.equal(restoreSession(storage).needsReview, true);
});
test("Existing data-only autosaves migrate without executing any content", () => {
  const storage = store();
  storage.set("gridpuzzle-puzzle-v1", makePuzzle());
  assert.equal(restoreSession(storage).puzzle.type, "sudoku");
  storage.set("gridpuzzle-puzzle-v1", { type: "__import__" });
  assert.equal(restoreSession(storage), null);
});
test("cage and cell warnings remain independent through autosave and undo", () => {
  const storage = store(), state = {
    puzzle: makePuzzle("killersudoku", 4),
    uncertain: new Set([0, 2]),
    cageUncertain: new Set([0, 1]),
    needsReview: true,
    notes: [],
    puzzleSource: 8,
  };
  const before = captureEdit(state);
  state.cageUncertain.delete(0);
  saveSession(storage, state);
  const restored = restoreSession(storage);
  assert.deepEqual(restored.uncertain, [0, 2]);
  assert.deepEqual(restored.cageUncertain, [1]);
  // Older versions still see every warning in their combined list.
  assert.deepEqual(storage.get("gridpuzzle-session-v1").uncertain, [0, 2, 1]);
  state.uncertain.clear();
  restoreEdit(state, before);
  assert.deepEqual([...state.uncertain], [0, 2]);
  assert.deepEqual([...state.cageUncertain], [0, 1]);
});
test("legacy cage sessions retain ambiguous flags as cell warnings", () => {
  const storage = store();
  storage.set("gridpuzzle-session-v1", {
    puzzle: makePuzzle("killersudoku", 4),
    uncertain: [0, 1],
    needsReview: true,
  });
  assert.deepEqual(restoreSession(storage).uncertain, [0, 1]);
  assert.deepEqual(restoreSession(storage).cageUncertain, []);
});
