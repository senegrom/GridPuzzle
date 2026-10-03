import test from "node:test";
import assert from "node:assert/strict";
import { candidateNotes, prepareScan } from "../scan-analysis.js";
import { puzzleFromReadings } from "../scanner.js";
import { clueHeight } from "../geometry.js";

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
test("the norm is the upper quarter of clue heights that vary, not their middle or their tallest", () => {
  // Clues 44-54 px: the 75th percentile is 51, so a note is under 20.4.
  const clues = [44, 46, 48, 50, 52, 54].map((h, cell) => glyph(cell, { h }));
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 20 })]), [10]);
  assert.deepEqual(notesOf([...clues, glyph(10, { h: 21 })]), []);
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

test("the clue height is the interpolated 75th percentile of the glyph heights", () => {
  assert.equal(clueHeight([40, 10, 30, 20].map((h) => ({ h }))), 32.5);
  assert.equal(clueHeight([100, 9, 20, 10].map((h) => ({ h }))), 40, "heights sort as numbers");
  assert.equal(clueHeight([{ h: 50 }]), 50);
});

// After the OCR, a 9 x 9 Latin square: confident digits 1, 2, ... down the
// diagonal, in distinct rows and columns so that none conflicts.
function latin(entries, black = []) {
  return puzzleFromReadings({ entries, black: Array.from({ length: 81 }, (_, cell) => black.includes(cell)),
    meta: { boxes: false, rows: 9, cols: 9 }, mask: null, width: 900, height: 900 }, "latinsquare", 9, 9);
}
const read = (cell, h, { text = cell / 10 + 1, kind = "value" } = {}) => ({ ...glyph(cell, { h, kind }), text: String(text), confidence: 99 });
const clues = (n) => Array.from({ length: n }, (_, i) => read(10 * i, 50));
const highlighted = (found) => [...found.cellUncertain].sort((a, b) => a - b);
test("a read digit about half the grid's clue height is highlighted and kept, and a note says why", () => {
  for (const ratio of [0.5, 0.535]) {
    const found = latin([...clues(8), read(80, 50 * ratio)]);
    assert.deepEqual(highlighted(found), [80], `${ratio} of the clue height`);
    assert.equal(found.puzzle.cells[80], 9);
    assert.deepEqual(found.noteSized, [80]);
    assert.deepEqual(found.notes, ["1 highlighted digit is much smaller than the grid's other clues, so it may be a pencil or app note. Clear it if it is not a printed clue."]);
  }
  const two = latin([...clues(7), read(70, 25), read(80, 25)]);
  assert.deepEqual(two.noteSized, [70, 80]);
  assert.deepEqual(two.notes, ["2 highlighted digits are much smaller than the grid's other clues, so they may be pencil or app notes. Clear them if they are not printed clues."]);
});
test("a read digit 0.6 of the grid's clue height is not highlighted", () => {
  for (const ratio of [0.545, 0.6]) {
    const found = latin([...clues(8), read(80, 50 * ratio)]);
    assert.deepEqual(highlighted(found), [], `${ratio} of the clue height`);
    assert.deepEqual(found.noteSized, []); assert.deepEqual(found.notes, []);
  }
});
test("labels, signs and black-cell numbers are never judged, even short ones in digit cells", () => {
  const sign = { ...read(40, 20, { text: "<", kind: "hsign" }), other: 41 },
    found = latin([...clues(8), read(30, 20, { kind: "label" }), sign, read(80, 20, { kind: "blackvalue" })], [80]);
  assert.deepEqual(highlighted(found), []);
  assert.deepEqual(found.notes, []);
});
test("a short digit flagged for another reason does not count as highlighted for its size alone", () => {
  const unsure = latin([...clues(8), { ...read(80, 25), confidence: 50 }]);
  assert.deepEqual(highlighted(unsure), [80]); assert.deepEqual(unsure.noteSized, []);
  // Cell 8 repeats row 0's 1, and the conflict flags both cells.
  const repeated = latin([...clues(8), read(8, 25, { text: 1 })]);
  assert.deepEqual(highlighted(repeated), [0, 8]); assert.deepEqual(repeated.noteSized, []);
  // Every cell of a cage is reviewed already.
  const caged = puzzleFromReadings({ entries: [...clues(8), read(80, 25)], black: Array(81).fill(false),
    meta: { boxes: true, rows: 9, cols: 9 }, mask: null, width: 900, height: 900, cageAreas: [Array.from({ length: 81 }, (_, cell) => cell)] },
  "killersudoku", 9, 9);
  assert.ok(caged.uncertain.includes(80)); assert.deepEqual(caged.noteSized, []);
});
test("fewer than six read digits set no clue height", () => {
  assert.deepEqual(highlighted(latin([...clues(4), read(80, 25)])), []);
  assert.deepEqual(highlighted(latin([...clues(5), read(80, 25)])), [80]);
});
test("the clue height comes from the value digits read, not from unread regions or black-cell numbers", () => {
  const unread = [1, 2].map((cell) => read(cell, 200, { text: "" })),
    outOfRange = [3, 4, 5].map((cell) => read(cell, 200, { text: 12 })),
    black = [60, 70, 80].map((cell) => read(cell, 200, { kind: "blackvalue" }));
  assert.deepEqual(highlighted(latin([...clues(5), read(50, 25), ...unread, ...outOfRange, ...black], [60, 70, 80])), [1, 2, 3, 4, 5, 50]);
});
