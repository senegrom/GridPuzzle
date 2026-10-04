import test from "node:test";
import assert from "node:assert/strict";
import { Scanner, glyphAspect, confidentDigits, puzzleFromReadings } from "../scanner.js";
import { turnCorners } from "../geometry.js";

const glyphs = (n, w, h, extra = {}) => Array.from({ length: n }, (_, cell) => ({ kind: "value", cell, x: 0, y: 0, w, h, ...extra }));
const corners = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];
// A reading with `digits` unflagged digits out of `regions` value regions of the given shape.
function reading(regions, digits, [w, h] = [34, 50]) {
  const cells = Array(81).fill(null);
  for (let i = 0; i < digits; i++) cells[i] = 1 + (i % 9);
  return { puzzle: { cells }, uncertain: [], entries: glyphs(regions, w, h), notes: ["kept"] };
}
function reader(readings) {
  const calls = [];
  return { calls, epoch: 0, cancel() {}, orient: Scanner.prototype.orient,
    async readOnce(_canvas, quad, ...rest) { calls.push(quad); return readings[calls.length - 1]; } };
}
const read = (fake, options = {}, rows = 9, cols = 9) =>
  Scanner.prototype.read.call(fake, {}, corners, "sudoku", rows, cols, () => {}, options);

test("glyph aspect: upright print is tall, a quarter turn is wide, too few glyphs say nothing", () => {
  assert.ok(glyphAspect(glyphs(8, 34, 50)) > 1.4);
  assert.ok(glyphAspect(glyphs(8, 50, 34)) < 0.7);
  assert.equal(glyphAspect(glyphs(5, 50, 34)), Infinity);
  assert.equal(glyphAspect(glyphs(8, 50, 34, { glyphCount: 2 })), Infinity, "multi-glyph regions are not single glyphs");
  assert.equal(confidentDigits({ ...reading(8, 6), uncertain: [0, 1] }), 4);
});
test("the corner turn moves the first corner clockwise", () => {
  assert.deepEqual(turnCorners([1, 2, 3, 4], 1), [2, 3, 4, 1]);
  assert.deepEqual(turnCorners([1, 2, 3, 4], 3), [4, 1, 2, 3]);
});
test("a sideways, poorly read photograph is read both quarter turns and the clearly better one kept", async () => {
  const fake = reader([reading(20, 1, [50, 34]), reading(20, 3), reading(20, 18)]);
  const found = await read(fake);
  assert.deepEqual(fake.calls, [corners, turnCorners(corners, 1), turnCorners(corners, 3)]);
  assert.equal(found.turns, 3); assert.equal(confidentDigits(found), 18);
  assert.match(found.notes[0], /a quarter turn clockwise/); assert.equal(found.notes[1], "kept");
});
test("a turn that is not clearly better keeps the upright reading", async () => {
  for (const [upright, better] of [[1, 7], [4, 10]]) {
    const fake = reader([reading(20, upright, [50, 34]), reading(20, better), reading(20, 0)]);
    const found = await read(fake);
    assert.equal(fake.calls.length, 3); assert.equal(found.turns, undefined);
    assert.equal(confidentDigits(found), upright);
  }
});
test("a digit highlighted only for its size still counts toward a turn", async () => {
  // Read a quarter turn round: eight clear digits, exactly the bar of
  // max(8, 2 x 0 + 3), one of them half the height of the others.
  const entries = [50, 50, 50, 50, 50, 50, 50, 25].map((h, i) =>
      ({ kind: "value", cell: 10 * i, x: 0, y: 0, w: 34, h, text: String(i + 1), confidence: 99 })),
    turned = { ...puzzleFromReadings({ entries, black: Array(81).fill(false), meta: { boxes: true, rows: 9, cols: 9 },
      mask: null, width: 900, height: 900 }, "sudoku", 9, 9), entries };
  assert.ok(turned.uncertain.includes(70), "the short digit stays highlighted");
  const found = await read(reader([reading(20, 0, [50, 34]), turned, reading(20, 0)]));
  assert.equal(found.turns, 1); assert.equal(confidentDigits(found), 8);
});
test("upright-shaped glyphs or a good reading never pay for a turned read", async () => {
  for (const first of [reading(20, 2), reading(20, 12, [50, 34])]) {
    const fake = reader([first]);
    assert.equal(await read(fake), first); assert.equal(fake.calls.length, 1);
  }
});
test("live previews, targeted re-reads and non-square grids keep their orientation", async () => {
  const sideways = () => reader([reading(20, 1, [50, 34]), reading(20, 18), reading(20, 18)]);
  for (const [options, rows, cols] of [[{ orient: false }, 9, 9], [{ cells: [0] }, 9, 9], [{}, 6, 9]]) {
    const fake = sideways();
    const found = await read(fake, options, rows, cols);
    assert.equal(fake.calls.length, 1); assert.equal(found.turns, undefined);
  }
});
