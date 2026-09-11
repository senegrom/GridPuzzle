import test from "node:test";
import assert from "node:assert/strict";
import { prepareEdit } from "../edit-history.js";
import { makePuzzle } from "../model.js";

function state() {
  return {
    puzzle: makePuzzle("str8ts", 3),
    layout: { rows: "3", cols: "3", boxRows: "1", boxCols: "3" },
    uncertain: new Set([0]), blackReadings: [{ cell: 0, value: 2 }],
    cageUncertain: new Set([1]), needsReview: true, notes: ["Review"],
    puzzleSource: 7, selected: [0, 1], play: [2, null, null, null, null, null, null, null, null],
    hints: new Set([0]), playFeedback: { wrong: new Set([0]) },
    result: { status: "unique" }, playSolution: [2], history: [], photo: {},
  };
}

test("a callback failure cannot mutate any live editable collection", () => {
  const live = state(), before = structuredClone(live);
  assert.throws(() => prepareEdit(live, (draft) => {
    draft.puzzle.cells[0] = 1;
    draft.layout.rows = "4";
    draft.uncertain.clear(); draft.cageUncertain.clear();
    draft.notes.push("changed"); draft.selected.pop();
    draft.play[0] = 1; draft.hints.clear(); draft.needsReview = false;
    throw Error("Rejected callback");
  }), /Rejected callback/);
  assert.deepEqual(live, before);
});

test("invalid puzzle data is rejected before a draft can be committed", () => {
  const live = state(), before = structuredClone(live);
  assert.throws(() => prepareEdit(live, (draft) => {
    draft.puzzle.cells[0] = 10;
  }), /value|range/i);
  assert.deepEqual(live, before);
});

test("accepted drafts normalize play and hints without carrying derived results or resources", () => {
  const live = state(), before = structuredClone(live);
  const draft = prepareEdit(live, (d) => { d.puzzle.cells[0] = 2; });
  assert.deepEqual(live, before);
  assert.equal(draft.puzzle.cells[0], 2);
  assert.equal(draft.play[0], null, "a new printed clue replaces the playable cell");
  assert.equal(draft.hints.size, 0);
  assert.equal(draft.playFeedback, null);
  assert.deepEqual(draft.selected, live.selected);
  assert.notEqual(draft.selected, live.selected);
  for (const key of ["result", "playSolution", "history", "photo"])
    assert.equal(Object.hasOwn(draft, key), false, `${key} must not undo commit-time invalidation`);
});
