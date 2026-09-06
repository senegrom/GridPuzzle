import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../model.js";
test("Clear box geometry wins over an out-of-range OCR transcription", () => {
  assert.equal(
    classify({ rows: 9, cols: 9, boxes: true, values: [1, 38, 9] }).type,
    "sudoku",
  );
});
test("Structural cage and blocked-cell cues still override box geometry", () => {
  assert.equal(
    classify({ rows: 9, cols: 9, boxes: true, labels: 4 }).type,
    "killersudoku",
  );
  assert.equal(
    classify({ rows: 9, cols: 9, boxes: true, black: 4 }).type,
    "hidato",
  );
});
