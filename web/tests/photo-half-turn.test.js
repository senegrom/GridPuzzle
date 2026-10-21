import test from "node:test";
import assert from "node:assert/strict";
import { Scanner } from "../scanner.js";
import { confidentDigits, wayUpDigits, glyphAspect, HALF_TURN_BAR, HALF_TURN_FLOOR } from "../turn-cues.js";
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
  // Any digit counts, not only the last: Hidato and Numbrix numbers.
  assert.equal(wayUpDigits(board([21, 50, 31, 8])), 3, "21, 50 and 31");
  // A digit flagged only for its size still counts, as in confidentDigits.
  const sized = { ...board([2, 3]), noteSized: [1] };
  sized.uncertain = [1];
  assert.equal(wayUpDigits(sized), 2);
  assert.equal(wayUpDigits({ ...board([2, 3]), uncertain: [1] }), 1);
  // A Kakuro or Str8ts reading's blocked "#" cells are no digits at all.
  const blocked = board([8, 9, 2]);
  blocked.puzzle.cells[40] = "#"; blocked.puzzle.cells[41] = "#";
  assert.equal(confidentDigits(blocked), 3); assert.equal(wayUpDigits(blocked), 1);
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
  // One confident digit is enough to be read again.
  const one = reader([board([8], { flagged: [2, 3, 5], extra: 20 }), upright()]);
  assert.equal((await read(one)).turns, 2);
  assert.equal(one.calls.length, 2);
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
    [shown(HALF_TURN_BAR, { rest: 10 }), 2, "enough"],
    [shown(HALF_TURN_BAR - 1, { rest: 20 }), undefined, "one short, however many 8s"],
    [shown(HALF_TURN_BAR - 1, { rest: 10, flagged: [2, 3, 5] }), undefined, "one short, flagged ones aside"],
  ]) {
    const fake = reader([unsure(), turned]);
    assert.equal((await read(fake)).turns, turns, why);
    assert.equal(fake.calls.length, 2);
  }
});
test("the half-turned reading must also read clearly better: more confident digits, HALF_TURN_FLOOR or half its regions", async () => {
  assert.equal(HALF_TURN_FLOOR, 12);
  // Five numbers with a 2, 3 or 5 and `rest` confident 8s, among `extra`
  // value regions that read nothing.
  const turned = (rest, extra = 30) => board([2, 3, 5, 23, 35, ...Array(rest).fill(8)], { extra });
  const fourteen = () => board([8, 9, 6, 1, 8, 9, 6, 1, 8, 9, 6, 1, 4, 7], { extra: 26 });
  for (const [first, half, turns, why] of [
    // Upside down, an upright page in some handwriting fonts reads its 8s, 3s
    // or 5s as confident 3s and 5s, and little else: five such numbers alone.
    [unsure(), turned(0), undefined, "five such numbers and nothing else"],
    [unsure(), turned(HALF_TURN_FLOOR - 6), undefined, "one short of the floor"],
    [unsure(), turned(HALF_TURN_FLOOR - 5), 2, "the floor"],
    // A page with fewer clues needs half its value regions: 8 of 16.
    [board([8], { extra: 15 }), turned(3, 8), 2, "half the regions of a small page"],
    [board([8], { extra: 15 }), turned(2, 9), undefined, "one short of half the regions"],
    // More confident digits than the first reading, not as many.
    [fourteen(), turned(9, 26), undefined, "as many as the first"],
    [fourteen(), turned(10, 26), 2, "one more than the first"],
  ]) {
    const fake = reader([first, half]);
    assert.equal((await read(fake)).turns, turns, why);
    assert.equal(fake.calls.length, 2, why);
  }
});
test("glyphs exactly as tall as wide, as whole-cell boxes are, and too few glyphs are no evidence of a half turn", async () => {
  // Kakuro entries and cell-filling blobs are whole cells: a median of
  // exactly 1 says nothing of the glyphs, so no other read, as on master.
  const square = board([8, 9], { extra: 20, w: 40, h: 40 });
  assert.equal(glyphAspect(square.entries), 1);
  let fake = reader([square, upright()]);
  assert.equal(await read(fake), square); assert.equal(fake.calls.length, 1);
  // Glyphs any taller than wide are upright-shaped.
  const taller = board([8, 9], { extra: 20, w: 40, h: 41 });
  assert.ok(glyphAspect(taller.entries) > 1);
  fake = reader([taller, upright()]);
  assert.equal((await read(fake)).turns, 2);
  // Five value regions give no glyph aspect at all.
  const few = board([8, 9], { extra: 3 });
  assert.equal(glyphAspect(few.entries), Infinity);
  fake = reader([few, upright()]);
  assert.equal(await read(fake), few); assert.equal(fake.calls.length, 1);
});
test("a sideways page takes the quarter-turn check and never a half-turned read", async () => {
  // Glyphs well wider than tall, and only slightly wider (0.9).
  for (const h of [34, 45]) {
    const sideways = board([9, 8], { extra: 20, w: 50, h }), fake = reader([sideways, upright(), board([])]);
    const found = await read(fake);
    assert.deepEqual(fake.calls, [corners, turnCorners(corners, 1), turnCorners(corners, 3)], `aspect ${h / 50}`);
    assert.equal(found.turns, 1);
  }
});
test("the half-turned read is a silent, full and cancellable read that reports to the scan's diagnostics", async () => {
  // Every argument of each readOnce call, and what the call does with them:
  // the second call reports progress and a diagnostic, and calls its check
  // after a new scan has started meanwhile.
  const progress = [], diagnostics = [], calls = [];
  let checked = null;
  const fake = { epoch: 0, cancel() {}, orient: Scanner.prototype.orient, halfTurn: Scanner.prototype.halfTurn,
    async readOnce(...args) {
      calls.push(args);
      const [, , , , , onProgress, options, targetCells, check] = args;
      onProgress("Straightening the photograph…", null);
      options.onDiagnostic?.({ call: calls.length });
      if (calls.length === 1) return inverted();
      assert.equal(targetCells, null, "a full read, not a targeted one");
      fake.epoch++;
      try { check(); checked = "passed"; } catch (error) { checked = error.name; }
      fake.epoch--;
      return upright();
    } };
  const found = await read(fake, { onDiagnostic: (event) => diagnostics.push(event) }, 9, 9, (text) => progress.push(text));
  assert.equal(found.turns, 2);
  assert.deepEqual(calls.map((args) => args[1]), [corners, halfTurned]);
  assert.deepEqual(progress, ["Straightening the photograph…", "Checking which way up the photograph is…"],
    "the half-turned read's own progress stays off the status line");
  assert.deepEqual(diagnostics, [{ call: 1 }, { call: 2 }], "its diagnostics reach the scan's");
  assert.equal(checked, "AbortError", "it is cancelled with the scan");
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
test("the half-turned read is given the scan's diagnostics and nothing else of its options", async () => {
  // A preview would draw the upside-down crop, and evidence is keyed by the
  // cells of the first reading's frame, which half a turn moves.
  const given = [], onDiagnostic = () => {}, fake = reader([inverted(), upright()]), readOnce = fake.readOnce;
  fake.readOnce = function (...args) { given.push(args[6]); return readOnce.apply(this, args); };
  const options = { onDiagnostic, onPreview: () => {}, skipEvidence: { 3: "evidence" } };
  assert.equal((await read(fake, options)).turns, 2);
  assert.equal(given[0], options, "the first read is the scan's own");
  assert.deepEqual(Object.keys(given[1]), ["onDiagnostic"]);
  assert.equal(given[1].onDiagnostic, onDiagnostic);
});
test("only value regions count toward the floor: black-cell clues, cage labels and Kakuro sums do not", async () => {
  // Eight confident digits, five with a 2, 3 or 5, among 16 value regions:
  // half of them, so enough however many other regions the reading has.
  for (const kind of ["blackvalue", "label", "across"]) {
    const turned = board([2, 3, 5, 23, 35, 8, 8, 8], { extra: 8 });
    for (let i = 0; i < 12; i++) turned.entries.push({ kind, cell: 40 + i, x: 0, y: 0, w: 34, h: 50 });
    const fake = reader([board([8], { extra: 15 }), turned]);
    assert.equal((await read(fake)).turns, 2, kind);
    assert.equal(fake.calls.length, 2, kind);
  }
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
// Three upright pages, recorded the same way, whose half-turned readings show
// five or more confident numbers with a 2, 3 or 5 that are not there: the
// bar alone turned each of them upside down (Chromium; review of 2026-10-17).
test("real: upright pages that read spurious 3s and 5s half a turn round stay upright", async () => {
  const cases = [
    // rozet-render sudoku_0009 with its printed 3 pasted into the six empty
    // cells whose solution is a 3, saved as JPEG at quality 40. Upright, every
    // 3 reads flagged; upside down, seven read as confident 3s.
    ["rozet3 r3d33~q40", 6, 8, real({ 0: 9, 1: 2, 3: 3, 5: 6, 10: 2, 11: 8, 14: 1, 18: 1, 21: 2, 23: 9, 26: 2, 27: 2, 28: 2,
      33: 2, 34: 4, 40: 2, 42: 1, 44: 9, 45: 3, 52: 5, 53: 6, 54: 8, 55: 4, 56: 9, 58: 7, 61: 3, 68: 2, 74: 2 },
    [3, 5, 10, 11, 14, 18, 26, 28, 33, 40, 44, 45, 52, 53, 54, 58, 61, 68, 74, 75, 76, 21, 27, 1],
    [[0, 32, 62], [1, 31, 55], [3, 32, 58], [5, 32, 59], [10, 32, 57], [11, 31, 60], [14, 31, 62], [18, 31, 62], [21, 32, 56],
      [23, 32, 62], [26, 31, 58], [27, 32, 55], [28, 31, 59], [33, 32, 58], [34, 33, 60], [40, 31, 57], [42, 27, 57], [44, 32, 62],
      [45, 31, 58], [52, 34, 55], [53, 33, 60], [54, 31, 59], [55, 33, 60], [56, 32, 62], [58, 31, 62], [61, 32, 58], [68, 32, 57],
      [74, 31, 57], [75, 34, 55], [76, 33, 60]]),
    real({ 4: 9, 6: 3, 12: 3, 19: 3, 26: 8, 27: 9, 35: 3, 38: 2, 40: 3, 47: 3, 52: 8, 53: 4, 54: 3, 69: 8, 70: 3, 75: 9, 77: 3, 79: 4 },
      [4, 5, 6, 22, 24, 25, 26, 27, 28, 36, 46, 47, 52, 53, 57, 59, 62, 66, 69, 75, 79, 80],
      [[4, 33, 60], [5, 34, 55], [6, 31, 57], [12, 32, 57], [19, 32, 58], [22, 31, 60], [24, 32, 61], [25, 33, 56], [26, 31, 59],
        [27, 33, 60], [28, 34, 55], [35, 31, 58], [36, 32, 61], [38, 27, 56], [40, 31, 57], [46, 33, 56], [47, 32, 57], [52, 31, 59],
        [53, 32, 55], [54, 31, 57], [57, 32, 60], [59, 32, 56], [62, 31, 59], [66, 31, 59], [69, 31, 60], [70, 32, 56], [75, 32, 59],
        [77, 32, 56], [79, 31, 55], [80, 32, 59]])],
    // A Sudoku of 1s, 4s, 6s, 7s, 8s and 9s printed in Bradley Hand ITC:
    // upside down, seven of its 8s read as confident 3s.
    ["Bradley Hand, no 2, 3 or 5", 7, 9, real({ 3: 4, 5: 8, 6: 7, 12: 1, 16: 9, 19: 6, 29: 4, 31: 4, 33: 1, 38: 4, 39: 6, 51: 6,
      52: 8, 54: 4, 55: 7, 58: 9, 62: 8, 70: 6, 71: 9, 74: 1, 75: 4 },
    [2, 5, 6, 19, 27, 30, 31, 38, 39, 42, 51, 52, 55, 62, 64, 70, 75, 76, 23, 29, 3],
    [[2, 46, 57], [3, 35, 40], [5, 30, 38], [6, 46, 48], [12, 31, 35], [16, 46, 57], [19, 35, 36], [23, 46, 57], [27, 35, 36],
      [29, 35, 39], [30, 46, 57], [31, 31, 39], [33, 31, 35], [38, 30, 38], [39, 35, 36], [42, 46, 57], [51, 35, 37], [52, 30, 38],
      [54, 36, 38], [55, 46, 48], [58, 46, 57], [62, 30, 39], [64, 30, 38], [70, 35, 36], [71, 46, 56], [74, 31, 35], [75, 30, 38],
      [76, 35, 36]]),
    real({ 4: 2, 5: 3, 9: 6, 10: 2, 16: 3, 18: 3, 22: 6, 26: 4, 28: 3, 29: 9, 38: 6, 41: 9, 42: 3, 49: 3, 50: 6, 53: 2, 57: 6,
      61: 9, 75: 3, 77: 1, 78: 6 },
    [4, 6, 10, 22, 25, 26, 29, 38, 41, 47, 50, 51, 53, 57, 61, 64, 68, 74, 77],
    [[4, 35, 36], [5, 30, 38], [6, 31, 35], [9, 46, 56], [10, 35, 36], [16, 30, 38], [18, 30, 39], [22, 46, 57], [25, 46, 48],
      [26, 36, 38], [28, 30, 38], [29, 35, 37], [38, 46, 57], [41, 35, 36], [42, 30, 38], [47, 31, 35], [49, 31, 39], [50, 46, 57],
      [51, 35, 39], [53, 35, 36], [57, 46, 57], [61, 35, 36], [64, 46, 57], [68, 31, 35], [74, 46, 48], [75, 30, 38], [77, 35, 40],
      [78, 46, 57]])],
    // Nine 8s in Bradley Hand on grey: upside down, five read as confident
    // 3s. Upright it reads only two confident digits, so the half-turned
    // reading has more, but 8 in all.
    ["Bradley Hand, nine 8s, grey", 2, 8, real({ 0: 2, 5: 4, 9: 3, 13: 7, 24: 4, 25: 4, 31: 2, 38: 2, 46: 2, 50: 4, 52: 2, 61: 4,
      62: 8, 64: 8, 66: 7, 71: 9, 72: 9, 74: 1, 75: 2 },
    [0, 5, 6, 7, 9, 13, 14, 24, 27, 31, 36, 38, 46, 47, 49, 52, 55, 61, 62, 64, 66, 74, 75, 25, 50],
    [[0, 34, 26], [5, 30, 40], [6, 44, 49], [7, 34, 31], [9, 29, 40], [13, 44, 49], [14, 39, 35], [24, 30, 39], [25, 29, 39],
      [27, 30, 38], [31, 29, 40], [36, 31, 33], [38, 29, 39], [46, 34, 55], [47, 45, 47], [49, 30, 34], [50, 35, 42], [52, 29, 38],
      [55, 45, 47], [61, 30, 37], [62, 30, 39], [64, 29, 39], [66, 44, 35], [71, 46, 56], [72, 46, 58], [74, 29, 33], [75, 29, 38]]),
    real({ 5: 3, 8: 6, 9: 6, 16: 8, 18: 3, 25: 2, 28: 3, 31: 5, 34: 6, 42: 8, 49: 3, 53: 9, 56: 3, 66: 9, 67: 4, 71: 3, 73: 4,
      75: 3 },
    [6, 8, 14, 16, 18, 19, 25, 30, 31, 33, 34, 44, 55, 66, 67, 73, 74, 75, 80],
    [[5, 29, 38], [6, 29, 33], [8, 46, 58], [9, 46, 56], [14, 44, 35], [16, 29, 39], [18, 30, 39], [19, 30, 37], [25, 45, 47],
      [28, 29, 38], [30, 35, 42], [31, 30, 34], [33, 45, 47], [34, 34, 55], [42, 29, 39], [44, 31, 33], [49, 29, 40], [53, 30, 38],
      [55, 29, 39], [56, 30, 39], [66, 39, 35], [67, 44, 49], [71, 29, 40], [73, 34, 31], [74, 44, 49], [75, 30, 40], [80, 34, 26]])],
  ];
  for (const [name, confident, turnedConfident, first, turned] of cases) {
    assert.equal(confidentDigits(first), confident, name); assert.equal(wayUpDigits(first), 0, name);
    assert.equal(confidentDigits(turned), turnedConfident, name);
    assert.ok(wayUpDigits(turned) >= HALF_TURN_BAR, `${name}: the bar alone would turn it`);
    const fake = reader([first, turned]);
    assert.equal(await read(fake), first, name);
    assert.deepEqual(fake.calls, [corners, halfTurned], name);
  }
});
