import test from "node:test";
import assert from "node:assert/strict";
import { changePuzzleType, checkShape, makePuzzle, normalizePuzzle } from "../model.js";
import { puzzleFromReadings } from "../scanner.js";

function automaticBlackGrid() {
  return puzzleFromReadings({
    entries: [{ kind: "value", cell: 0, text: "1", confidence: 99 }],
    black: [false, false, false, false, true, false, false, false, false],
    meta: { boxes: false, rows: 3, cols: 3 },
    mask: new Uint8Array(900), width: 30, height: 30,
  }, "auto", 3, 3).puzzle;
}

test("an automatic Hidato proposal can become Str8ts without losing readings", () => {
  const proposal = automaticBlackGrid(), before = structuredClone(proposal);
  assert.equal(proposal.type, "hidato");
  assert.deepEqual(proposal.black, []);
  const corrected = changePuzzleType(proposal, "str8ts");
  assert.equal(corrected.type, "str8ts");
  assert.deepEqual(corrected.black, [4]);
  assert.deepEqual(corrected.cells, before.cells);
  assert.doesNotThrow(() => checkShape(corrected));
  assert.deepEqual(proposal, before, "conversion must not mutate the undo snapshot");
  corrected.cells[0] = 2;
  corrected.black.push(0);
  assert.deepEqual(proposal, before, "the converted board must own its arrays");
});

test("all existing blocked positions become Str8ts black metadata in row-major order", () => {
  const p = makePuzzle("hidato", 4);
  p.cells[0] = "#";
  p.cells[6] = "#";
  p.cells[15] = "#";
  p.cells[2] = 4;
  const corrected = changePuzzleType(p, "str8ts");
  assert.deepEqual(corrected.black, [0, 6, 15]);
  assert.deepEqual(corrected.cells, p.cells);
});

test("switching an existing Str8ts board preserves numbered black clues", () => {
  const p = makePuzzle("str8ts", 3);
  p.black = [0, 4];
  p.cells[0] = 2;
  p.cells[4] = "#";
  assert.deepEqual(changePuzzleType(p, "str8ts"), p);
});

test("a board with no blocked cells can still switch to Str8ts", () => {
  const p = makePuzzle("latinsquare", 4);
  p.cells[0] = 4;
  assert.deepEqual(changePuzzleType(p, "str8ts"), { ...p, type: "str8ts" });
});

test("type correction never repairs malformed imported Str8ts metadata", () => {
  const invalid = { ...automaticBlackGrid(), type: "str8ts" };
  for (const validate of [checkShape, normalizePuzzle, (p) => changePuzzleType(p, "str8ts")])
    assert.throws(() => validate(invalid), /outside the allowed range|listed as black/);
});

test("out-of-range Hidato readings remain an error instead of being erased", () => {
  const p = automaticBlackGrid();
  p.cells[0] = 8;
  const before = structuredClone(p);
  assert.throws(() => changePuzzleType(p, "str8ts"), /outside the allowed range/);
  assert.deepEqual(p, before);
});

for (const [rows, cols] of [[3, 4], [10, 10]])
  test(`incompatible ${rows} by ${cols} boards cannot become Str8ts`, () => {
    const p = makePuzzle("hidato", rows, cols), before = structuredClone(p);
    assert.throws(() => changePuzzleType(p, "str8ts"), /square|9/);
    assert.deepEqual(p, before);
  });

test("directional Kakuro clues are not silently dropped during type correction", () => {
  const p = makePuzzle("kakuro", 3);
  p.cells[0] = "#";
  p.clues = [{ cell: 0, across: 3 }];
  const before = structuredClone(p);
  assert.throws(() => changePuzzleType(p, "str8ts"), /structural clues/);
  assert.deepEqual(p, before);
  p.clues = [];
  assert.deepEqual(changePuzzleType(p, "str8ts").black, [0]);
});

test("cages, inequalities and Str8ts metadata cannot be discarded by switching types", () => {
  const cage = makePuzzle("kenken", 4);
  cage.cages = [{ cells: [0], target: 1, op: "=" }];
  const inequality = makePuzzle("futoshiki", 4);
  inequality.inequalities = [{ less: 0, greater: 1 }];
  const black = changePuzzleType(automaticBlackGrid(), "str8ts");
  for (const p of [cage, inequality, black]) {
    const before = structuredClone(p);
    assert.throws(() => changePuzzleType(p, "hidato"), /structural clues/);
    assert.deepEqual(p, before);
  }
});

test("non-sum KenKen cages cannot become Killer Sudoku cages", () => {
  const p = makePuzzle("kenken", 4);
  p.cages = [{ cells: [0, 1], target: 2, op: "*" }];
  assert.throws(() => changePuzzleType(p, "killersudoku"), /must be sums/);
});

test("compatible rule changes preserve explicitly selected Sudoku box orientation", () => {
  const p = { ...makePuzzle("latinsquare", 6), boxRows: 3, boxCols: 2 };
  p.cells[0] = 6;
  assert.deepEqual(changePuzzleType(p, "sudoku"), { ...p, type: "sudoku" });
  assert.throws(() => changePuzzleType(p, "auto"), /explicit puzzle type/);
});
