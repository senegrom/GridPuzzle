import test from "node:test";
import assert from "node:assert/strict";
import { Scanner, confidentDigits, wayUpDigits, glyphAspect, HALF_TURN_BAR } from "../scanner.js";
import { turnCorners } from "../geometry.js";

// Scanner.orient's half-turn check, with readOnce replaced by the readings a
// real read would return: these test the decision, not the OCR.
const corners = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];
// A 9 x 9 reading: `digits` are its unflagged clues, `flagged` its flagged
// ones, and every clue a value region of the given shape, with `extra` more
// regions that read nothing (upright print is taller than wide).
function board(digits, { flagged = [], extra = 0, w = 34, h = 50 } = {}) {
  const cells = Array(81).fill(null), uncertain = [], entries = [];
  [...digits, ...flagged].forEach((value, i) => {
    cells[i] = value;
    if (i >= digits.length) uncertain.push(i);
  });
  for (let i = 0; i < digits.length + flagged.length + extra; i++) {
    entries.push({ kind: "value", cell: i, x: 0, y: 0, w, h });
    if (i >= digits.length + flagged.length) uncertain.push(i);
  }
  return { puzzle: { cells }, uncertain, entries, notes: ["kept"] };
}
function reader(readings) {
  const calls = [];
  return { calls, epoch: 0, cancel() {}, orient: Scanner.prototype.orient, halfTurn: Scanner.prototype.halfTurn,
    async readOnce(_canvas, quad) {
      calls.push(quad);
      const next = readings[calls.length - 1];
      if (next instanceof Error) throw next;
      return next;
    } };
}
const read = (fake, options = {}, rows = 9, cols = 9, progress = () => {}) =>
  Scanner.prototype.read.call(fake, {}, corners, "sudoku", rows, cols, progress, options);
const halfTurned = turnCorners(corners, 2);
// An upside-down page as it reads: only its 6s, 8s and 9s (the 9s really 6s)
// with confidence, its 2s as flagged 4s; half a turn round, 26 clues.
const inverted = () => board([9, 6, 9, 6, 8, 6, 8, 9], { flagged: [1, 4, 4, 14, 6, 5, 14, 14, 4], extra: 11 });
const upright = () => board([7, 1, 4, 6, 4, 2, 8, 9, 5, 7, 1, 7, 8, 9, 4, 3, 6, 2, 4, 9, 3, 5, 2, 5, 9, 6], { flagged: [5, 3] });
// A poor reading with no number that shows the way up.
const unsure = () => board([8, 9], { extra: 20 });

test("only numbers with a 2, 3 or 5 show which way up a reading is", () => {
  const found = board([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 18, 19, 23, 47, 81], { flagged: [2, 5] });
  found.puzzle.cells[20] = 0; found.puzzle.cells[21] = 69; found.puzzle.cells[22] = 35;
  assert.equal(confidentDigits(found), 20);
  assert.equal(wayUpDigits(found), 6, "2, 3, 5, 12, 23 and 35; never 0, 1, 4, 6, 7, 8, 9, 10, 16, 18, 19, 47, 69 or 81");
  // A digit flagged only for its size still counts, as in confidentDigits.
  const sized = { ...board([2, 3]), noteSized: [1] };
  sized.uncertain = [1];
  assert.equal(wayUpDigits(sized), 2);
  assert.equal(wayUpDigits({ ...board([2, 3]), uncertain: [1] }), 1);
});
test("an upside-down page is read half a turn round and kept when its digits read clearly better that way", async () => {
  const turned = upright(), fake = reader([inverted(), turned]), progress = [];
  const found = await read(fake, {}, 9, 9, (text) => progress.push(text));
  assert.deepEqual(fake.calls, [corners, halfTurned]);
  assert.deepEqual(progress, ["Checking which way up the photograph is…"]);
  assert.equal(found.puzzle, turned.puzzle);
  assert.equal(found.turns, 2);
  assert.match(found.notes[0], /^The photograph was upside down: .*turned half a turn/);
  assert.equal(found.notes[1], "kept");
});
test("a poor reading with a confident 2, 3 or 5 is upright enough and pays for no other read", async () => {
  for (const shown of [2, 3, 5, 25, 53]) {
    const first = board([shown, 1, 8, 6, 9], { extra: 20 }), fake = reader([first, upright()]);
    assert.equal(await read(fake), first);
    assert.equal(fake.calls.length, 1, `a confident ${shown}`);
  }
});
test("a reading without one confident digit is not read again", async () => {
  // Every clue flagged, the 2s, 3s and 5s too: nothing shows the way up.
  const first = board([], { flagged: [2, 3, 5, 1, 8], extra: 20 }), fake = reader([first, upright()]);
  assert.equal(await read(fake), first);
  assert.equal(fake.calls.length, 1);
});
test("a page that reads well is never read again, even with no digit that shows the way up", async () => {
  // Half its value regions or more read as confident digits: 6s, 9s, 1s and
  // 8s read either way up, so nothing here could tell an upside-down page.
  for (const digits of [[6, 9, 6, 9, 1, 8], [8, 1, 1, 8, 6, 9, 6, 9, 1, 8, 8, 1]]) {
    const first = board(digits, { extra: digits.length }), fake = reader([first, upright()]);
    assert.equal(await read(fake), first);
    assert.equal(fake.calls.length, 1);
  }
});
test("6s and 9s never turn a page: half a turn round they read as each other", async () => {
  // A 6/9-heavy page read poorly: both readings are equally confident, and
  // neither has a number that shows the way up.
  const sixes = board([6, 9, 6, 6, 9, 1, 8, 6, 9, 9, 6, 16, 69], { extra: 14 }),
    nines = board([9, 6, 9, 9, 6, 1, 8, 9, 6, 6, 9, 91, 69], { extra: 14 });
  for (const [first, turned] of [[sixes, nines], [nines, sixes]]) {
    const fake = reader([first, turned]);
    assert.equal(await read(fake), first);
    assert.deepEqual(fake.calls, [corners, halfTurned]);
  }
});
test("4s and 7s, as an upright page's 2s and 4s read upside down, never turn a page", async () => {
  // The half-turned reading has many more confident digits than the upright
  // one, every one of them a 4, 7, 6, 9, 1 or 8.
  const first = board([6, 8, 1], { extra: 30 }),
    turned = board([4, 4, 4, 4, 4, 7, 7, 7, 7, 7, 6, 9, 47, 74, 44, 77, 1, 8], { extra: 10 });
  const fake = reader([first, turned]);
  assert.equal(await read(fake), first);
  assert.equal(fake.calls.length, 2);
  // An upside-down page reads its 2s as 4s, so 4s and 7s do not show an
  // upright page either: a reading of them alone is still checked.
  const fours = reader([board([4, 7, 4, 4, 9], { extra: 20 }), upright()]);
  assert.equal((await read(fours)).turns, 2);
});
test("0s, 1s and 8s, which read the same half a turn round, never turn a page", async () => {
  // Even when the half turn reads more of them than the upright reading did.
  for (const digits of [[1, 8, 1, 0, 8], [1, 1, 1, 0, 0, 0, 8, 8, 1, 0, 1, 10, 11, 18, 81, 88]]) {
    const fake = reader([board([1, 8], { extra: 40 }), board(digits, { extra: 40 })]);
    const found = await read(fake);
    assert.equal(found.turns, undefined); assert.equal(fake.calls.length, 2);
  }
});
test("the half-turned reading must read HALF_TURN_BAR numbers with a 2, 3 or 5", async () => {
  assert.equal(HALF_TURN_BAR, 5);
  const shown = (n, { rest = 0, flagged = [] } = {}) =>
    board([...[2, 3, 5, 23, 35, 52].slice(0, n), ...Array(rest).fill(8)], { flagged, extra: 30 });
  for (const [turned, turns, why] of [
    [shown(HALF_TURN_BAR), 2, "enough"],
    [shown(HALF_TURN_BAR - 1, { rest: 20 }), undefined, "one short, however many 8s"],
    [shown(HALF_TURN_BAR - 1, { flagged: [2, 3, 5] }), undefined, "one short, flagged ones aside"],
  ]) {
    const fake = reader([unsure(), turned]);
    assert.equal((await read(fake)).turns, turns, why);
    assert.equal(fake.calls.length, 2);
  }
});
test("glyphs exactly as tall as wide count as upright-shaped, too few glyphs as no evidence", async () => {
  const square = board([8, 9], { extra: 20, w: 40, h: 40 });
  assert.equal(glyphAspect(square.entries), 1);
  let fake = reader([square, upright()]);
  assert.equal((await read(fake)).turns, 2);
  // Five value regions give no glyph aspect at all.
  const few = board([8, 9], { extra: 3 });
  assert.equal(glyphAspect(few.entries), Infinity);
  fake = reader([few, upright()]);
  assert.equal(await read(fake), few); assert.equal(fake.calls.length, 1);
});
test("a sideways page takes the quarter-turn check and never a half-turned read", async () => {
  const sideways = board([9, 8], { extra: 20, w: 50, h: 34 }), fake = reader([sideways, upright(), board([])]);
  const found = await read(fake);
  assert.deepEqual(fake.calls, [corners, turnCorners(corners, 1), turnCorners(corners, 3)]);
  assert.equal(found.turns, 1);
});
test("live previews, targeted re-reads and non-square grids never read a half turn", async () => {
  for (const [options, rows, cols] of [[{ orient: false }, 9, 9], [{ cells: [0] }, 9, 9], [{}, 6, 9]]) {
    const fake = reader([inverted(), upright()]);
    const found = await read(fake, options, rows, cols);
    assert.equal(fake.calls.length, 1); assert.equal(found.turns, undefined);
  }
});
test("a failed half-turned read keeps the upright reading; a cancelled one never returns it", async () => {
  const first = inverted();
  let fake = reader([first, Error("No printed clues found. Adjust the crop, dimensions or lighting.")]);
  assert.equal(await read(fake), first); assert.equal(fake.calls.length, 2);
  const cancelled = Object.assign(Error("Scan cancelled"), { name: "AbortError" });
  fake = reader([inverted(), cancelled]);
  await assert.rejects(read(fake), (error) => error === cancelled);
});
test("a scan superseded during the half-turned read is rejected, not answered", async () => {
  for (const fails of [false, true]) {
    const first = inverted(), fake = reader([first, upright()]);
    fake.readOnce = async function (_canvas, quad) {
      fake.calls.push(quad);
      if (fake.calls.length === 1) return first;
      fake.epoch++; // a new Read starts meanwhile
      if (fails) throw Error("Image processing failed");
      return upright();
    };
    await assert.rejects(read(fake), { name: "AbortError" }, fails ? "a failed read" : "a completed read");
    assert.equal(fake.calls.length, 2);
  }
});
test("cancellation from the progress message stops before the half-turned read starts", async () => {
  const fake = reader([inverted(), upright()]);
  await assert.rejects(read(fake, {}, 9, 9, () => fake.epoch++), { name: "AbortError" });
  assert.equal(fake.calls.length, 1);
});

// Two real cases: readings recorded with master 889181c in Chromium from
// corpus photographs (unflagged and flagged values, value-region boxes as
// [cell, w, h, glyph count]), the first reading and the half-turned one.
function real(values, uncertain, boxes) {
  const cells = Array(81).fill(null);
  for (const [cell, value] of Object.entries(values)) cells[cell] = value;
  return { puzzle: { cells }, uncertain, notes: ["kept"],
    entries: boxes.map(([cell, w, h, glyphCount = 1]) => ({ kind: "value", cell, x: 0, y: 0, w, h, glyphCount })) };
}
test("real: wichtounet-newspaper image1083, stored upside down, reads upright", async () => {
  // Upside down it reads eight clues with confidence, all 6s, 8s and 9s. Half
  // a turn round it reads 26 with confidence, eight with a 2, 3 or 5, and all
  // 28 clues as the corpus target has them.
  const first = real({ 2: 9, 3: 6, 6: 1, 17: 6, 22: 4, 26: 9, 28: 5, 33: 6, 39: 8, 61: 6, 63: 8, 65: 4, 73: 9 },
    [6, 7, 9, 15, 17, 19, 22, 28, 32, 41, 47, 48, 52, 54, 58, 65, 71, 74, 77, 78],
    [[2, 26, 39], [3, 26, 39], [6, 26, 40], [7, 27, 39], [9, 27, 40], [15, 27, 40], [17, 27, 39], [19, 28, 39], [22, 26, 39],
      [26, 27, 39], [28, 27, 40], [32, 27, 39], [33, 27, 40], [39, 26, 39], [41, 26, 38], [47, 16, 39], [48, 26, 39], [52, 26, 38],
      [54, 27, 39], [58, 26, 38], [61, 26, 39], [63, 27, 40], [65, 26, 38], [71, 28, 38], [73, 26, 40], [74, 27, 39], [77, 16, 39],
      [78, 27, 39]]);
  const target = { 2: 7, 3: 1, 6: 4, 7: 6, 9: 4, 15: 2, 17: 8, 19: 9, 22: 5, 26: 7, 28: 5, 32: 3, 33: 1, 39: 7, 41: 8, 47: 9,
    48: 4, 52: 3, 54: 6, 58: 2, 61: 4, 63: 9, 65: 3, 71: 5, 73: 2, 74: 5, 77: 9, 78: 6 };
  const turned = real(target, [28, 32],
    [[2, 27, 39], [3, 16, 39], [6, 27, 39], [7, 26, 40], [9, 28, 38], [15, 26, 38], [17, 27, 40], [19, 26, 39], [22, 26, 38],
      [26, 27, 39], [28, 26, 38], [32, 26, 39], [33, 16, 39], [39, 26, 38], [41, 26, 39], [47, 27, 40], [48, 27, 39], [52, 27, 40],
      [54, 27, 39], [58, 26, 39], [61, 28, 39], [63, 27, 39], [65, 27, 40], [71, 27, 40], [73, 27, 39], [74, 26, 40], [77, 26, 39],
      [78, 26, 39]]);
  assert.equal(confidentDigits(first), 8); assert.equal(wayUpDigits(first), 0);
  assert.equal(confidentDigits(turned), 26); assert.equal(wayUpDigits(turned), 8);
  const fake = reader([first, turned]), found = await read(fake);
  assert.deepEqual(fake.calls, [corners, halfTurned]);
  assert.equal(found.turns, 2); assert.deepEqual(found.puzzle.cells, real(target, [], []).puzzle.cells);
});
test("real: lexski-mixed train-e7u07n8vxc8c1, an upright screenshot read poorly, stays upright", async () => {
  // Its 12 confident clues are 4s, 6s, 7s and 8s. Half a turn round it reads
  // 14 with confidence, five of them 4s, and not one with a 2, 3 or 5.
  const first = real({ 2: 4, 4: 6, 5: 1, 12: 4, 13: 2, 15: 6, 17: 7, 19: 6, 25: 5, 26: 4, 27: 8, 30: 6, 39: 1, 43: 1, 44: 8,
    45: 5, 50: 4, 53: 6, 56: 8, 58: 4, 60: 9, 61: 6, 63: 7, 67: 9, 73: 9, 76: 3, 80: 1 },
  [72, 10, 1, 5, 13, 24, 25, 26, 30, 39, 43, 45, 56, 58, 60, 67, 73, 76, 80],
  [[2, 49, 64], [4, 49, 67], [5, 32, 61, 2], [12, 47, 60], [13, 48, 71], [15, 50, 67], [17, 44, 64], [19, 51, 70], [24, 25, 46, 2],
    [25, 48, 69], [26, 48, 63], [27, 50, 71], [30, 51, 70], [39, 47, 72], [43, 30, 60, 2], [44, 50, 70], [45, 48, 70], [50, 49, 64],
    [53, 48, 66], [56, 50, 70, 2], [58, 46, 60], [60, 51, 68], [61, 50, 69], [63, 45, 65], [67, 51, 68], [73, 51, 66], [76, 46, 68],
    [80, 30, 61, 2]]);
  const turned = real({ 4: 2, 7: 6, 13: 6, 17: 1, 19: 9, 20: 6, 22: 4, 24: 8, 27: 9, 30: 4, 36: 8, 37: 1, 41: 2, 50: 9, 53: 8,
    54: 4, 61: 9, 63: 1, 65: 9, 67: 2, 68: 4, 76: 9, 78: 4 },
  [51, 49, 26, 23, 16, 15, 8, 0, 4, 17, 24, 35, 36, 37, 41, 55, 56, 61, 63, 67, 75],
  [[0, 30, 61, 2], [4, 46, 71], [7, 51, 68], [13, 51, 70], [17, 45, 69], [19, 50, 68], [20, 51, 69], [22, 46, 60], [24, 50, 71, 2],
    [27, 48, 66], [30, 49, 64], [35, 48, 71], [36, 50, 69], [37, 30, 60, 2], [41, 47, 69], [50, 51, 68], [53, 50, 72], [54, 48, 63],
    [55, 48, 72], [56, 25, 46, 2], [61, 51, 68], [63, 44, 68], [65, 50, 67], [67, 48, 70], [68, 47, 60], [75, 32, 61, 2], [76, 49, 67],
    [78, 49, 64]]);
  assert.equal(confidentDigits(first), 12); assert.equal(wayUpDigits(first), 0);
  assert.equal(confidentDigits(turned), 14); assert.equal(wayUpDigits(turned), 0);
  assert.equal(turned.puzzle.cells.filter((v, cell) => v === 4 && !turned.uncertain.includes(cell)).length, 5);
  const fake = reader([first, turned]);
  assert.equal(await read(fake), first);
  assert.deepEqual(fake.calls, [corners, halfTurned]);
});
