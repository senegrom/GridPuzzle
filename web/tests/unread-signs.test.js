import test from "node:test";
import assert from "node:assert/strict";
import { puzzleFromReadings } from "../scanner.js";
import { structuralReview } from "../model.js";

// A 3 x 3 board: a clue in cell 0, and sign regions between neighbours.
const box = { x: 0, y: 0, w: 10, h: 10, confidence: 90 };
const clue = { kind: "value", cell: 0, text: "1", ...box, confidence: 99 };
const sign = (kind, cell, other, text) => ({ kind, cell, other, text, ...box });
const read = (entries, type = "futoshiki") => puzzleFromReadings({ entries, black: Array(9).fill(false),
  meta: { boxes: false, rows: 3, cols: 3 }, mask: new Uint8Array(300 * 300), width: 300, height: 300 }, type, 3, 3);

test("an unread sign region puts both its cells under structural review, not digit review", () => {
  const found = read([clue, sign("hsign", 1, 2, ""), sign("vsign", 3, 6, "^")]);
  assert.deepEqual([...found.cageUncertain].sort(), [1, 2]);
  assert.ok(!found.cellUncertain.includes(1) && !found.cellUncertain.includes(2), "the digits are not in doubt");
  assert.ok(found.uncertain.includes(1) && found.uncertain.includes(2), "the combined review set still covers them");
  assert.equal(found.needsReview, true);
  assert.ok(found.notes.some((note) => /^1 possible inequality sign could not be read/.test(note)));
  // The read sign keeps its meaning and its existing digit-cell flag.
  assert.deepEqual(found.puzzle.inequalities, [{ less: 3, greater: 6 }]);
  assert.ok(found.cellUncertain.includes(3));
});
test("digits and operators in a sign region are not signs either", () => {
  const found = read([clue, sign("hsign", 4, 5, "3"), sign("vsign", 2, 5, "+"), sign("hsign", 7, 8, "Vv")]);
  assert.deepEqual([...found.cageUncertain].sort(), [2, 4, 5, 7, 8]);
  assert.ok(found.notes.some((note) => /^3 possible inequality signs could not be read/.test(note)));
  assert.deepEqual(found.puzzle.inequalities, []);
});
test("every sign read, or no sign region at all: no structural review and no note", () => {
  for (const entries of [[clue, sign("hsign", 1, 2, "<"), sign("vsign", 3, 6, "v")], [clue]]) {
    const found = read(entries);
    assert.deepEqual(found.cageUncertain, []);
    assert.ok(!found.notes.some((note) => /inequality sign/.test(note)));
  }
});
test("sign regions in other families are left alone", () => {
  const found = read([clue, sign("hsign", 1, 2, "")], "latinsquare");
  assert.deepEqual(found.cageUncertain, []);
  assert.ok(!found.notes.some((note) => /inequality sign/.test(note)));
});
test("the structural channel speaks of signs in Futoshiki and of cages elsewhere", () => {
  assert.equal(structuralReview("futoshiki", 4).label, "check sign");
  assert.match(structuralReview("futoshiki", 4).message, /^4 cells border an inequality sign .*Inequality under Editing/);
  for (const type of ["kenken", "killersudoku"]) {
    assert.equal(structuralReview(type, 2).label, "check cage");
    assert.match(structuralReview(type, 2).message, /^2 cells need cage review\. Choose Cages/);
  }
});
