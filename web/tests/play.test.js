import test from "node:test";
import assert from "node:assert/strict";
import {
  demo,
  makePuzzle,
  maxValue,
  playable,
  isPlayableCell,
  fitPlay,
  playConflicts,
  checkPlay,
  nextHint,
} from "../model.js";
import { captureEdit, restoreEdit } from "../edit-history.js";
import { saveSession, restoreSession } from "../session.js";

const SOLUTION = [..."534678912672195348198342567859761423426853791713924856961537284287419635345286179"].map(Number);

test("value bounds follow the family", () => {
  assert.equal(maxValue(demo()), 9);
  assert.equal(maxValue(demo("kakuro")), 9);
  assert.equal(maxValue(demo("hidato")), demo("hidato").cells.filter((v) => v !== "#").length);
  assert.equal(maxValue(makePuzzle("kenken", 6)), 6);
  assert.equal(playable(demo("slitherlink")), false);
  assert.equal(playable(demo("str8ts")), true);
});

test("only blank, non-black cells accept answers", () => {
  const p = demo();
  assert.equal(isPlayableCell(p, 0), false, "printed clue");
  assert.equal(isPlayableCell(p, 2), true);
  const s = demo("str8ts");
  assert.equal(isPlayableCell(s, 4), false, "black cell");
  assert.equal(isPlayableCell(s, 8), true);
  const k = demo("kakuro");
  assert.equal(isPlayableCell(k, 0), false, "blocked cell");
  assert.equal(isPlayableCell(k, 5), true);
});

test("fitPlay drops entries on clues, black cells, out-of-range values and wrong lengths", () => {
  const p = demo();
  const fitted = fitPlay(p, [9, 4, 4, 0, 10, "x"]);
  assert.equal(fitted.length, p.cells.length);
  assert.equal(fitted[0], null, "clue cell");
  assert.equal(fitted[2], 4);
  assert.equal(fitted[3], null);
  assert.equal(fitted[4], null, "cell 4 is a clue");
  assert.deepEqual(fitPlay(p, undefined).filter(Number.isInteger), []);
  const s = demo("str8ts");
  assert.equal(fitPlay(s, [null, null, null, null, 2, null, null, null, 2])[4], null);
  assert.equal(fitPlay(s, [null, null, null, null, 2, null, null, null, 2])[8], 2);
});

test("conflicts consider answers together with printed clues", () => {
  const p = demo(), play = fitPlay(p, []);
  assert.equal(playConflicts(p, play).size, 0);
  play[2] = 3; // duplicates the printed 3 in row 1
  const bad = playConflicts(p, play);
  assert.ok(bad.has(2) && bad.has(1));
  play[2] = 4;
  assert.equal(playConflicts(p, play).size, 0);
});

test("checking answers classifies right, wrong and remaining cells", () => {
  const p = demo(), play = fitPlay(p, []);
  play[2] = 4;
  play[3] = 1; // solution has 6
  const r = checkPlay(p, play, SOLUTION);
  assert.deepEqual(r.correct, [2]);
  assert.deepEqual(r.wrong, [3]);
  assert.equal(r.remaining.length, 51 - 2);
  const complete = checkPlay(p, SOLUTION.map((v, i) => (p.cells[i] === null ? v : null)), SOLUTION);
  assert.deepEqual([complete.wrong, complete.remaining], [[], []]);
  assert.equal(complete.correct.length, 51);
});

test("hints fix the first wrong or empty cell in reading order", () => {
  const p = demo(), play = fitPlay(p, []);
  assert.deepEqual(nextHint(p, play, SOLUTION), { cell: 2, value: 4 });
  play[2] = 4;
  play[3] = 1;
  assert.deepEqual(nextHint(p, play, SOLUTION), { cell: 3, value: 6 });
  const done = SOLUTION.map((v, i) => (p.cells[i] === null ? v : null));
  assert.equal(nextHint(p, done, SOLUTION), null);
});

test("answers and hints survive undo snapshots and reloads without leaking solutions", () => {
  const p = demo();
  const state = {
    puzzle: p, play: fitPlay(p, []), hints: new Set([2]), uncertain: new Set(), cageUncertain: new Set(),
    needsReview: false, notes: [], puzzleSource: null, layout: null,
  };
  state.play[2] = 4;
  const snapshot = captureEdit(state);
  state.play[2] = 9;
  state.hints.clear();
  restoreEdit(state, snapshot);
  assert.equal(state.play[2], 4);
  assert.ok(state.hints.has(2));
  const data = new Map(), storage = { get: (k) => data.get(k), set: (k, v) => data.set(k, v) };
  saveSession(storage, { ...state, playSolution: SOLUTION, result: { status: "unique" } });
  const restored = restoreSession(storage);
  assert.equal(restored.play[2], 4);
  assert.deepEqual(restored.hints, [2]);
  assert.equal(JSON.stringify([...data.values()]).includes("playSolution"), false);
});
