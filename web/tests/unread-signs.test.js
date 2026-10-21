import test from "node:test";
import assert from "node:assert/strict";
import { puzzleFromReadings } from "../scanner.js";
import { prepareScan, readChevron } from "../scan-analysis.js";
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
test("readChevron rejects a long stroke that only thickens, for its slope alone", () => {
  // A smudged dash, 2 px thick at one end and 4 px at the other: the end ratio
  // of a chevron (2x), but its extent grows by 2 px over 30, not a spread.
  const wedge = canvas();
  for (let x = 15; x < 45; x++) {
    const thickness = 2 + Math.round((2 * (x - 15)) / 29);
    for (let y = 30 - (thickness >> 1); y < 30 - (thickness >> 1) + thickness; y++) wedge.g[y * 60 + x] = 20;
  }
  assert.equal(readChevron(wedge.g, 60, "hsign", 13, 13, 35, 35), null);
});

// A 3 x 3 Futoshiki print as prepareScan gets it: 60 px boxes 100 px apart,
// no digits, and in four of the gaps a chevron, one per direction, 16 px along
// its axis and 28 px across it (so its ink box is not square).
function futoshikiPrint() {
  const size = 300, g = new Uint8Array(size * size).fill(238);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * size + x] = 25; };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const x = c * 100 + 20, y = r * 100 + 20;
    ink(x, y, x + 60, y + 2); ink(x, y + 58, x + 60, y + 60); ink(x, y, x + 2, y + 60); ink(x + 58, y, x + 60, y + 60);
  }
  const stroke = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= n; s++) { const x = Math.round(x0 + ((x1 - x0) * s) / n), y = Math.round(y0 + ((y1 - y0) * s) / n); ink(x - 1, y - 1, x + 2, y + 2); }
  };
  const sign = ([ax, ay], ...ends) => { for (const [x, y] of ends) stroke(ax, ay, x, y); };
  sign([108, 50], [92, 36], [92, 64]);    // ">" between cells 0 and 1 (apex right)
  sign([150, 108], [136, 92], [164, 92]); // "v" between cells 1 and 4 (apex down)
  sign([50, 192], [36, 208], [64, 208]);  // "^" between cells 3 and 6 (apex up)
  sign([192, 150], [208, 136], [208, 164]); // "<" between cells 4 and 5 (apex left)
  const data = new Uint8ClampedArray(size * size * 4);
  g.forEach((v, i) => { data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v; data[4 * i + 3] = 255; });
  return { width: size, height: size, data };
}
test("prepareScan reads each printed sign's chevron, so signs the OCR misses still become inequalities", () => {
  const prepared = prepareScan(futoshikiPrint(), "futoshiki", 3, 3);
  assert.deepEqual(prepared.entries.filter((e) => e.kind === "hsign" || e.kind === "vsign").map((e) => [e.kind, e.cell, e.other, e.chevron ?? null]),
    [["hsign", 0, 1, ">"], ["vsign", 1, 4, "v"], ["vsign", 3, 6, "^"], ["hsign", 4, 5, "<"]]);
  // The OCR has read no text at all: the chevrons alone give the four inequalities, still for checking.
  const found = puzzleFromReadings(prepared, "futoshiki", 3, 3);
  assert.deepEqual(found.puzzle.inequalities, [{ less: 1, greater: 0 }, { less: 4, greater: 1 }, { less: 3, greater: 6 }, { less: 4, greater: 5 }]);
  assert.ok(found.notes.some((note) => /^4 inequality signs read for checking\./.test(note)));
  assert.deepEqual([...found.cageUncertain].sort(), [0, 1, 3, 4, 5, 6]);
});
