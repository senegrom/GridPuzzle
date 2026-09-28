import test from "node:test";
import assert from "node:assert/strict";
import { candidateNotes, prepareScan } from "../scan-analysis.js";
import { puzzleFromReadings } from "../scanner.js";

// 100 px cells, as the scanner's rectified grids up to 15 columns.
const glyph = (cell, { h = 50, dx = 0, dy = 0, kind = "value" } = {}) => {
  const r = Math.floor(cell / 9), c = cell % 9;
  return { kind, cell, x: c * 100 + 47 + dx, y: r * 100 + 50 - h / 2 + dy, w: 6, h };
};
const notesOf = (entries) => [...candidateNotes(entries)].map((e) => e.cell).sort((a, b) => a - b);

test("glyphs under 0.4 of the grid's clue height are notes wherever they sit", () => {
  const clues = [0, 1, 2, 3, 4].map((cell) => glyph(cell));
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 18 }), glyph(11, { h: 19, dx: 30, dy: -30 })]), [10, 11]);
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 21 })]), [], "just over 0.4 of the clue height is a clue");
});
test("small off-centre glyphs above the ratio stay clues: handwriting and shifted cells", () => {
  const clues = [0, 1, 2, 3].map((cell) => glyph(cell, { h: 40 }));
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 30, dx: 25, dy: 25 })]), []);
});
test("a grid printed in a small font keeps every clue, and too few glyphs set no norm", () => {
  assert.deepEqual(notesOf([0, 1, 2, 3, 4, 5].map((cell) => glyph(cell, { h: 27 }))), []);
  assert.deepEqual(notesOf([glyph(0), glyph(1), glyph(2, { h: 12 })]), []);
});
test("only value glyphs are judged: labels and black-cell numbers are left alone", () => {
  const clues = [0, 1, 2, 3].map((cell) => glyph(cell));
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 12, kind: "label" }), glyph(11, { h: 12, kind: "blackvalue" })]), []);
});

function board({ note = true } = {}) {
  const width = 300, height = 300, data = new Uint8ClampedArray(width * height * 4).fill(245);
  const fill = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const at = 4 * (yy * width + xx); data[at] = data[at + 1] = data[at + 2] = 10; data[at + 3] = 255;
    }
  };
  for (const cell of [0, 2, 6, 8]) fill((cell % 3) * 100 + 47, Math.floor(cell / 3) * 100 + 26, 6, 50);
  // Cell 4: a pencil note in the upper left of the cell, or a clue in its centre.
  if (note) fill(122, 120, 5, 18); else fill(147, 126, 6, 50);
  return { width, height, data };
}
test("a pencil note in a scanned grid reaches review with no digit, never a clue", () => {
  const prepared = prepareScan(board(), "latinsquare", 3, 3);
  assert.deepEqual(prepared.entries.filter((e) => e.kind === "value").map((e) => e.cell).sort(), [0, 2, 6, 8]);
  assert.deepEqual(prepared.unreadCells, [4]);
  const readings = prepared.entries.map((e) => ({ ...e, text: "1", confidence: 99 }));
  const found = puzzleFromReadings({ ...prepared, entries: readings, width: 300, height: 300 }, "latinsquare", 3, 3);
  assert.equal(found.puzzle.cells[4], null); assert.ok(found.uncertain.includes(4));
  const control = prepareScan(board({ note: false }), "latinsquare", 3, 3);
  assert.deepEqual(control.entries.map((e) => e.cell).sort(), [0, 2, 4, 6, 8]);
  assert.deepEqual(control.unreadCells, []);
});
