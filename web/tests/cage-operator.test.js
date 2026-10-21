import test from "node:test";
import assert from "node:assert/strict";
import { readOperator } from "../cage-operator.js";
import { puzzleFromReadings } from "../scanner.js";

// A clue crop as cageLabelCrop lays it out: a 90 x 40 clue box at (16, 16)
// inside a 16 px margin, 1 for ink.
const W = 122, H = 72;
function crop() {
  const ink = new Uint8Array(W * H);
  const box = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * W + x] = 1; };
  // A stroke three pixels thick from (x0, y0) to (x1, y1).
  const stroke = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) { const x = Math.round(x0 + ((x1 - x0) * s) / steps), y = Math.round(y0 + ((y1 - y0) * s) / steps); box(x - 1, y - 1, x + 2, y + 2); }
  };
  // A stroke one pixel thick: its pixels touch only at their corners.
  const line = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) ink[Math.round(y0 + ((y1 - y0) * s) / steps) * W + Math.round(x0 + ((x1 - x0) * s) / steps)] = 1;
  };
  // An outlined "0", 14 px wide, from row y0 to row y1 - 1.
  const zero = (x, y0, y1) => { box(x, y0, x + 14, y0 + 3); box(x, y1 - 3, x + 14, y1); box(x, y0, x + 3, y1); box(x + 11, y0, x + 14, y1); };
  // A digit-like glyph, 14 x 26, from x; the band is y 22..47.
  const digit = (x) => zero(x, 22, 48);
  return { ink, box, stroke, line, zero, digit };
}
const read = ({ ink }, core = null) => readOperator(ink, W, H, core);

test("each operator sign reads from its shape after the digits", () => {
  const plus = crop(); plus.digit(20); plus.digit(38); plus.box(58, 33, 74, 36); plus.box(64, 27, 67, 43);
  assert.equal(read(plus), "+");
  const minus = crop(); minus.digit(20); minus.box(40, 33, 52, 36);
  assert.equal(read(minus), "-");
  const times = crop(); times.digit(20); times.stroke(41, 28, 53, 40); times.stroke(41, 40, 53, 28);
  assert.equal(read(times), "*");
  const slash = crop(); slash.digit(20); slash.stroke(41, 47, 50, 22);
  assert.equal(read(slash), "/");
  const divide = crop(); divide.digit(20); divide.box(40, 33, 56, 36); divide.box(46, 26, 50, 30); divide.box(46, 39, 50, 43);
  assert.equal(read(divide), "/");
});
test("no operator is read from digits alone, a lone glyph or an empty box", () => {
  const two = crop(); two.digit(20); two.digit(38);
  assert.equal(read(two), null);
  const narrow = crop(); narrow.digit(20); narrow.box(40, 22, 43, 48); // a "1" after a digit
  assert.equal(read(narrow), null);
  const lone = crop(); lone.box(40, 33, 52, 36);
  assert.equal(read(lone), null);
  assert.equal(read(crop()), null);
  // A speck is no hyphen, and a sign far from the digits belongs to nothing.
  const speck = crop(); speck.digit(20); speck.box(38, 34, 41, 36);
  assert.equal(read(speck), null);
  const far = crop(); far.digit(20); far.box(80, 33, 92, 36);
  assert.equal(read(far), null);
  // A sign follows a digit, not another short mark.
  const dashes = crop(); dashes.digit(20); dashes.box(38, 33, 48, 36); dashes.box(52, 33, 62, 36);
  assert.equal(read(dashes), null);
});
test("cage lines crossing the clue box are not signs", () => {
  // A thick cage border a little inside the box's top and left edges.
  const ruled = crop(); ruled.box(16, 19, 106, 23); ruled.box(19, 16, 23, 56); ruled.digit(26); ruled.box(44, 33, 56, 36);
  assert.equal(read(ruled), "-");
  // Dashes of an inset outline along the box's top edge, past the sign.
  const dashed = crop(); dashed.digit(20); dashed.box(38, 33, 54, 36); dashed.box(44, 27, 47, 43);
  for (let x = 60; x < 104; x += 14) dashed.box(x, 16, x + 7, 18);
  assert.equal(read(dashed), "+");
});
test("a division sign blurred into a cross reads as one when its core parts the dots", () => {
  const blurred = crop(); blurred.digit(20);
  // Dots joined to the bar by one-pixel bridges: in the ink, a cross.
  blurred.box(40, 33, 56, 36); blurred.box(46, 26, 50, 30); blurred.box(46, 39, 50, 43); blurred.box(47, 30, 49, 33); blurred.box(47, 36, 49, 39);
  assert.equal(read(blurred), "+");
  const core = crop(); core.digit(20); core.box(40, 33, 56, 36); core.box(46, 26, 50, 30); core.box(46, 39, 50, 43);
  assert.equal(read(blurred, core.ink), "/");
  // A true cross stays one at its core.
  const plus = crop(); plus.digit(20); plus.box(40, 33, 56, 36); plus.box(46, 27, 49, 43);
  assert.equal(read(plus, plus.ink), "+");
});
// A times sign has ink on both diagonals: one short stroke is none.
test("a single short diagonal is no times sign", () => {
  const diagonal = crop(); diagonal.digit(20); diagonal.stroke(41, 40, 51, 30);
  assert.equal(read(diagonal), null);
});

// Each rule pinned below earns its place on the clue crops #115 recorded from
// the corpus's KenKen renders (5,008 clues, replayed in the 2026-10-19
// review): without it, between 2 and 19 more operators that read right read
// wrong than the other way round. Each case is drawn after a shape that went
// wrong there.
test("a stroke one pixel thick stays one piece: a thin cross of diagonals reads as times", () => {
  const thin = crop(); thin.digit(20); thin.line(41, 28, 53, 40); thin.line(41, 40, 53, 28);
  assert.equal(read(thin), "*");
});
test("a thick cage line down the box's side is no glyph, beside a clue shorter than the box", () => {
  // Kept, the 40 px line would set the digits' scale and leave the 20 px "0" too short to count as one.
  const ruled = crop(); ruled.box(19, 16, 24, 56); ruled.zero(26, 26, 46); ruled.box(44, 34, 56, 37);
  assert.equal(read(ruled), "-");
});
test("an outline's dashes along the box's top edge are no glyphs where the clue reaches up to them", () => {
  // The clue fills the box from row 18, so its band takes in the dashes in rows 17 and 18.
  const tall = crop(); tall.zero(20, 18, 47); tall.box(38, 31, 54, 34); tall.box(44, 25, 47, 41);
  for (let x = 60; x < 100; x += 14) tall.box(x, 17, x + 7, 19);
  assert.equal(read(tall), "+");
});
test("an outline's dash down the box's left edge does not stretch the digits' band", () => {
  // Counted, the dash under this short "1" would put the hyphen too high in the band to read.
  const edged = crop(); edged.box(24, 18, 27, 38); edged.box(32, 26, 44, 29); edged.box(16, 40, 18, 56);
  assert.equal(read(edged), "-");
});
test("specks under 3 px are no glyphs, even right after the sign", () => {
  const specked = crop(); specked.digit(20); specked.digit(38); specked.box(58, 33, 74, 36); specked.box(64, 27, 67, 43); specked.box(78, 34, 80, 35);
  assert.equal(read(specked), "+");
});
test("a division sign's dots partly past the ends of its bar still belong to it", () => {
  // Slanted, as in a skewed photograph: a quarter of the upper dot hangs past the bar's right end, of the lower one past its left.
  const slanted = crop(); slanted.digit(20); slanted.box(40, 33, 56, 36); slanted.box(53, 26, 57, 30); slanted.box(39, 39, 43, 43);
  assert.equal(read(slanted), "/");
});
test("a sign more than a third of the digits' height is no hyphen however wide: a blurred sign is left to the OCR", () => {
  // A plus whose thick arms have run together into a 22 x 12 px blob.
  const blurred = crop(); blurred.digit(20); blurred.box(38, 31, 60, 37); blurred.box(44, 28, 54, 40);
  assert.equal(read(blurred), null);
});
test("a KenKen cage takes its operator from the clue's shape before the OCR's", () => {
  const halves = [[0, 1], [2, 3]], reading = (entries) => puzzleFromReadings({ entries, black: Array(4).fill(false),
    meta: { rows: 2, cols: 2, boxes: false }, mask: new Uint8Array(200 * 200), width: 200, height: 200, cageAreas: halves }, "kenken", 2, 2);
  const label = (cell, text, operator) => ({ kind: "label", cell, text, confidence: 90, x: 0, y: 0, w: 10, h: 10, ...(operator !== undefined ? { operator } : {}) });
  // "2+" whose ink is a division sign; "1" whose hyphen the OCR dropped.
  assert.deepEqual(reading([label(0, "2+", "/"), label(2, "1", "-")]).puzzle.cages,
    [{ cells: [0, 1], target: 2, op: "/" }, { cells: [2, 3], target: 1, op: "-" }]);
  // No clear shape keeps the OCR's operator, and a Killer cage stays a sum.
  assert.deepEqual(reading([label(0, "3x", null), label(2, "5")]).puzzle.cages,
    [{ cells: [0, 1], target: 3, op: "*" }, { cells: [2, 3], target: 5, op: "+" }]);
  const killer = puzzleFromReadings({ entries: [label(0, "7", "-")], black: Array(4).fill(false), meta: { rows: 2, cols: 2, boxes: false },
    mask: new Uint8Array(200 * 200), width: 200, height: 200, cageAreas: halves }, "killersudoku", 2, 2);
  assert.equal(killer.puzzle.cages[0].op, "+");
});
test("an operator impossible for its cage still drops the cage, and the note shows the sign read", () => {
  const found = puzzleFromReadings({ entries: [{ kind: "label", cell: 0, text: "12+", confidence: 90, x: 0, y: 0, w: 10, h: 10, operator: "-" }],
    black: Array(4).fill(false), meta: { rows: 2, cols: 2, boxes: false }, mask: new Uint8Array(200 * 200), width: 200, height: 200,
    cageAreas: [[0, 1, 2], [3]] }, "kenken", 2, 2);
  assert.deepEqual(found.puzzle.cages.map((c) => c.cells), [[3]]);
  assert.ok(found.notes.some((note) => note.includes("incompatible “12-” reading")));
});
