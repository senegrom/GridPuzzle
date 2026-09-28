import test from "node:test";
import assert from "node:assert/strict";
import { puzzleFromReadings } from "../scanner.js";
import { readChevron } from "../scan-analysis.js";
import { structuralReview } from "../model.js";

// A 3 x 3 board: a clue in cell 0, and sign regions between neighbours.
const box = { x: 0, y: 0, w: 10, h: 10, confidence: 90 };
const clue = { kind: "value", cell: 0, text: "1", ...box, confidence: 99 };
const sign = (kind, cell, other, text, chevron) => ({ kind, cell, other, text, ...box, ...(chevron ? { chevron } : {}) });
const read = (entries, type = "futoshiki") => puzzleFromReadings({ entries, black: Array(9).fill(false),
  meta: { boxes: false, rows: 3, cols: 3 }, mask: new Uint8Array(300 * 300), width: 300, height: 300 }, type, 3, 3);

test("every sign region is structural review on both cells: read signs are proposed, unread ones are not", () => {
  const found = read([clue, sign("hsign", 1, 2, ""), sign("vsign", 3, 6, "^")]);
  assert.deepEqual([...found.cageUncertain].sort(), [1, 2, 3, 6]);
  assert.deepEqual(found.cellUncertain, [], "no digit is called doubtful for a sign");
  assert.ok([1, 2, 3, 6].every((cell) => found.uncertain.includes(cell)), "the combined review set covers every sign cell");
  assert.equal(found.needsReview, true);
  assert.deepEqual(found.puzzle.inequalities, [{ less: 3, greater: 6 }]);
  assert.ok(found.notes.some((note) => /^1 inequality sign read for checking, 1 more could not be read\./.test(note)));
});
test("a clear chevron reads the sign where the OCR read nothing, and outranks a conflicting OCR reading", () => {
  const found = read([clue, sign("hsign", 1, 2, "", ">"), sign("vsign", 3, 6, "^", "v"), sign("hsign", 7, 8, "3", "<")]);
  assert.deepEqual(found.puzzle.inequalities, [{ less: 2, greater: 1 }, { less: 6, greater: 3 }, { less: 7, greater: 8 }]);
  assert.deepEqual([...found.cageUncertain].sort(), [1, 2, 3, 6, 7, 8]);
  assert.ok(found.notes.some((note) => /^3 inequality signs read for checking\./.test(note)));
});
test("digits, operators and double letters without a chevron stay unread", () => {
  const found = read([clue, sign("hsign", 4, 5, "3"), sign("vsign", 2, 5, "+"), sign("hsign", 7, 8, "Vv")]);
  assert.deepEqual([...found.cageUncertain].sort(), [2, 4, 5, 7, 8]);
  assert.deepEqual(found.puzzle.inequalities, []);
  assert.ok(found.notes.some((note) => /^0 inequality signs read for checking, 3 more could not be read\./.test(note)));
});
test("no sign region: no structural review and no note; other families are left alone", () => {
  const plain = read([clue]);
  assert.deepEqual(plain.cageUncertain, []); assert.ok(!plain.notes.some((note) => /inequality sign/.test(note)));
  const latin = read([clue, sign("hsign", 1, 2, "", "<")], "latinsquare");
  assert.deepEqual(latin.cageUncertain, []); assert.ok(!latin.notes.some((note) => /inequality sign/.test(note)));
});
test("the structural channel speaks of signs in Futoshiki and of cages elsewhere", () => {
  assert.equal(structuralReview("futoshiki", 4).label, "check sign");
  assert.match(structuralReview("futoshiki", 4).message, /^4 cells border an inequality sign to check\. .*Inequality under Editing/);
  for (const type of ["kenken", "killersudoku"]) {
    assert.equal(structuralReview(type, 2).label, "check cage");
    assert.match(structuralReview(type, 2).message, /^2 cells need cage review\. Choose Cages/);
  }
});

// Chevron shapes drawn into a gray image: two 3 px strokes meeting at the apex.
function canvas(width = 60, height = 60) {
  const g = new Uint8Array(width * height).fill(235);
  const dot = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx >= 0 && yy >= 0 && xx < width && yy < height) g[yy * width + xx] = 20;
  } };
  const line = (x0, y0, x1, y1) => { const n = 200; for (let i = 0; i <= n; i++) dot(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); };
  return { g, width, line };
}
function chevron(direction) {
  const c = canvas();
  // Apex at the named side, open end opposite; drawn in a 30 x 30 box at (15, 15).
  const apex = { "<": [15, 30], ">": [45, 30], "^": [30, 15], v: [30, 45] }[direction];
  const ends = { "<": [[45, 15], [45, 45]], ">": [[15, 15], [15, 45]], "^": [[15, 45], [45, 45]], v: [[15, 15], [45, 15]] }[direction];
  for (const [x, y] of ends) c.line(apex[0], apex[1], x, y);
  return c;
}
test("readChevron reads the apex side of clear chevrons in both orientations", () => {
  for (const direction of ["<", ">"]) assert.equal(readChevron(chevron(direction).g, 60, "hsign", 13, 13, 35, 35), direction);
  for (const direction of ["^", "v"]) assert.equal(readChevron(chevron(direction).g, 60, "vsign", 13, 13, 35, 35), direction);
});
test("readChevron abstains on shapes that are not clear chevrons", () => {
  const bar = canvas(); bar.line(15, 30, 45, 30);                       // a dash: constant extent
  const box = canvas(); box.line(15, 15, 45, 15); box.line(15, 45, 45, 45); box.line(15, 15, 15, 45); box.line(45, 15, 45, 45);
  const short = canvas(); short.line(28, 28, 32, 26); short.line(28, 28, 32, 30); // under 8 positions of ink
  // Two strokes that spread only slightly (about 21 px to 27 px): not the 1.6x of a chevron.
  const taper = canvas(); taper.line(15, 20, 45, 17); taper.line(15, 40, 45, 43);
  for (const c of [bar, box, taper]) assert.equal(readChevron(c.g, 60, "hsign", 13, 13, 35, 35), null);
  assert.equal(readChevron(short.g, 60, "hsign", 26, 24, 8, 8), null);
  // A chevron read across its axis (as the other sign kind) is not a clear shape either.
  assert.equal(readChevron(chevron("<").g, 60, "vsign", 13, 13, 35, 35), null);
});
