import test from "node:test";
import assert from "node:assert/strict";
import { makePuzzle, normalizePuzzle, checkShape, boxShape } from "../model.js";
import { restoreSession } from "../session.js";

test("imported Latin squares without box metadata can become Sudoku without losing clues", () => {
  for (const size of [4, 6, 9, 16]) {
    const imported = makePuzzle("latinsquare", size);
    imported.cells[0] = size;
    delete imported.boxRows;
    delete imported.boxCols;
    const before = structuredClone(imported), puzzle = normalizePuzzle(imported);
    assert.deepEqual([puzzle.boxRows, puzzle.boxCols], boxShape(size));
    puzzle.type = "sudoku";
    assert.doesNotThrow(() => checkShape(puzzle));
    assert.deepEqual(puzzle.cells, before.cells);
    assert.deepEqual(imported, before);
  }
});

test("legacy autosaves with incompatible 3x3 defaults can change to Sudoku", () => {
  const imported = { ...makePuzzle("latinsquare", 4), boxRows: 3, boxCols: 3 };
  imported.cells[0] = 4;
  const saved = restoreSession({ get: () => ({ puzzle: imported }) });
  const puzzle = normalizePuzzle(saved.puzzle);
  puzzle.type = "sudoku";
  assert.doesNotThrow(() => checkShape(puzzle));
  assert.deepEqual([puzzle.boxRows, puzzle.boxCols], [2, 2]);
  assert.deepEqual(puzzle.cells, imported.cells);
});

test("valid explicit box dimensions survive normalization and rule changes", () => {
  for (const type of ["latinsquare", "sudoku", "killersudoku"]) {
    const imported = { ...makePuzzle(type, 6), boxRows: 3, boxCols: 2 };
    const puzzle = normalizePuzzle(imported);
    assert.deepEqual([puzzle.boxRows, puzzle.boxCols], [3, 2]);
    puzzle.type = "sudoku";
    assert.doesNotThrow(() => checkShape(puzzle));
  }
});

test("normalization rejects invalid Sudoku rules instead of changing them", () => {
  for (const type of ["sudoku", "killersudoku"]) {
    const imported = { ...makePuzzle(type, 4), boxRows: 3, boxCols: 3 };
    assert.throws(() => normalizePuzzle(imported), /Box dimensions/);
  }
});

test("valid Sudoku imports with one omitted box dimension keep the same rules", () => {
  for (const type of ["sudoku", "killersudoku"]) {
    for (const [supplied, expected] of [["boxRows", [2, 3]], ["boxCols", [3, 2]]]) {
      const imported = makePuzzle(type, 6);
      delete imported.boxRows;
      delete imported.boxCols;
      imported[supplied] = 2;
      assert.doesNotThrow(() => checkShape(imported));
      const puzzle = normalizePuzzle(imported);
      assert.deepEqual([puzzle.boxRows, puzzle.boxCols], expected);
      assert.doesNotThrow(() => checkShape(puzzle));
    }
  }
});
