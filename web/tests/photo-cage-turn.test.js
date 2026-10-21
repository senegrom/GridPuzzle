import test from "node:test";
import assert from "node:assert/strict";
import { Scanner } from "../scanner.js";
import { cageSum, cageSums, CAGE_TURN_FLOOR } from "../turn-cues.js";
import { turnCorners } from "../geometry.js";

// Scanner.orient's check for a cage puzzle (Scanner.cageTurn), with readOnce
// replaced by the readings a real read would return: these test the decision,
// not the OCR. A cage puzzle's digits are all under review, so its cage sums
// show which way up it is (web/OCR_QUALITY.md, "Turned cage puzzles").
const corners = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];
// A 9 x 9 Killer reading of `count` two-cell cages, the first `read` of them
// with a sum that can stand (3 to 17 for two cells), the rest unread.
function killer(count, read, { type = "killersudoku", n = 9, target = 10, op = "+" } = {}) {
  const cages = Array.from({ length: count }, (_, i) => ({ cells: [2 * i, 2 * i + 1], target: i < read ? target : null, op }));
  return { puzzle: { type, rows: n, cols: n, cells: Array(n * n).fill(null), cages },
    entries: cages.map((cage) => ({ kind: "label", cell: cage.cells[0], cageLabel: true, text: "", confidence: 0 })),
    uncertain: [], notes: ["kept"] };
}
function reader(readings) {
  const calls = [];
  return { calls, epoch: 0, cancel() {}, orient: Scanner.prototype.orient, halfTurn: Scanner.prototype.halfTurn,
    cageTurn: Scanner.prototype.cageTurn,
    async readOnce(_canvas, quad) {
      calls.push(quad);
      const next = readings[calls.length - 1];
      if (next instanceof Error) throw next;
      return next;
    } };
}
const read = (fake, { type = "killersudoku", options = {}, rows = 9, cols = 9, progress = () => {} } = {}) =>
  Scanner.prototype.read.call(fake, {}, corners, type, rows, cols, progress, options);
const allTurns = [corners, turnCorners(corners, 1), turnCorners(corners, 2), turnCorners(corners, 3)];

test("a cage sum counts only when its cage can hold it", () => {
  const cage = (cells, target, op = "+") => ({ cells: Array.from({ length: cells }, (_, i) => i), target, op });
  // Killer: distinct digits 1 to n, so k cells sum to k(k+1)/2 .. k(2n+1-k)/2.
  for (const [cells, target, holds] of [[2, 3, true], [2, 17, true], [2, 2, false], [2, 18, false], [1, 9, true], [1, 10, false],
    [9, 45, true], [10, 55, false], [3, 6, true], [3, 5, false]])
    assert.equal(cageSum(cage(cells, target), "killersudoku", 9), holds, `Killer ${cells} cells, ${target}`);
  assert.equal(cageSum(cage(2, 7), "killersudoku", 4), true); assert.equal(cageSum(cage(2, 8), "killersudoku", 4), false);
  // KenKen: digits 1 to n, repeated across rows and columns, by operator.
  for (const [cells, target, op, holds] of [[2, 12, "+", true], [2, 13, "+", false], [3, 2, "+", false], [2, 5, "-", true],
    [2, 6, "-", false], [3, 1, "-", false], [2, 3, "/", true], [2, 1, "/", false], [2, 7, "/", false], [3, 2, "/", false],
    [2, 30, "*", true], [2, 7, "*", false], [2, 37, "*", false], [3, 216, "*", true], [3, 217, "*", false], [2, 49, "*", false],
    [1, 6, "=", true], [1, 7, "+", false], [2, 4, "?", false]])
    assert.equal(cageSum(cage(cells, target, op), "kenken", 6), holds, `KenKen ${cells} cells, ${target}${op}`);
  for (const target of [null, 0, -3, 1.5, NaN]) assert.equal(cageSum(cage(2, target), "kenken", 6), false, `target ${target}`);
  assert.equal(cageSum({ cells: [], target: 3, op: "+" }, "kenken", 6), false);
});
test("a reading counts its cages by their clue regions and its sums by what can stand", () => {
  const found = killer(20, 6);
  found.puzzle.cages[7].target = 30; // two cells cannot sum to 30
  assert.deepEqual(cageSums(found), { cages: 20, sums: 6 });
  found.puzzle.cages[8].target = 17;
  assert.deepEqual(cageSums(found), { cages: 20, sums: 7 });
  // A cage whose reading was dropped as incompatible still has its region.
  found.puzzle.cages.pop();
  assert.equal(cageSums(found).cages, 20);
  assert.deepEqual(cageSums({ puzzle: { type: "kenken", rows: 4, cells: [] }, notes: [] }), { cages: 0, sums: 0 });
});
for (const [turns, wording] of [[1, /^The photograph was read turned a quarter turn anticlockwise: its cage sums read clearly better that way/],
  [2, /^The photograph was upside down: its cage sums read clearly better turned half a turn/],
  [3, /^The photograph was read turned a quarter turn clockwise: its cage sums read clearly better that way/]])
  test(`a turned cage puzzle whose sums read only turned ${turns} is read in all three turns and kept that way`, async () => {
    const readings = [killer(20, 1), killer(20, 0), killer(20, 2), killer(20, 1)];
    readings[turns] = killer(20, 17);
    const fake = reader(readings), progress = [];
    const found = await read(fake, { progress: (text) => progress.push(text) });
    assert.deepEqual(fake.calls, allTurns);
    assert.deepEqual(progress, Array(3).fill("Checking which way up the photograph is…"));
    assert.equal(found.puzzle, readings[turns].puzzle);
    assert.equal(found.turns, turns);
    assert.match(found.notes[0], wording);
    assert.match(found.notes[0], /so the crop corners were turned with it\. Check the cages against the photograph\.$/);
    assert.equal(found.notes[1], "kept");
  });
test("a KenKen reads its turns the same way, operators and all", async () => {
  const kenken = (read) => {
    const found = killer(12, read, { type: "kenken", n: 6, target: 15, op: "*" });
    return found;
  };
  const fake = reader([kenken(0), kenken(0), kenken(9), kenken(1)]);
  const found = await read(fake, { type: "kenken", rows: 6, cols: 6 });
  assert.equal(found.turns, 2); assert.equal(fake.calls.length, 4);
  // 15 is 3 x 5, which a 4 x 4 KenKen cannot hold: no sum stands, no turn.
  const small = (read) => killer(6, read, { type: "kenken", n: 4, target: 15, op: "*" });
  const none = reader([small(0), small(6), small(6), small(6)]);
  assert.equal((await read(none, { type: "kenken", rows: 4, cols: 4 })).turns, undefined);
});
test("a cage reading with sums in at least half its cages is never read again", async () => {
  for (const first of [killer(20, 10), killer(20, 20), killer(1, 1)]) {
    const fake = reader([first, killer(20, 20)]);
    assert.equal(await read(fake), first); assert.equal(fake.calls.length, 1);
  }
  // A board with no cage regions at all has nothing to compare.
  const bare = killer(0, 0), fake = reader([bare]);
  assert.equal(await read(fake), bare); assert.equal(fake.calls.length, 1);
});
test("a turn that does not read clearly better keeps the first reading", async () => {
  for (const [why, first, readings] of [
    ["not more than twice the first, plus one", killer(20, 3), [killer(20, 6), killer(20, 0), killer(20, 1)]],
    ["sums in fewer than half its cages", killer(20, 0), [killer(20, 9), killer(20, 0), killer(20, 1)]],
    [`fewer than ${CAGE_TURN_FLOOR} sums`, killer(4, 0), [killer(4, CAGE_TURN_FLOOR - 1), killer(4, 0), killer(4, 0)]],
    ["two turns tie", killer(20, 1), [killer(20, 15), killer(20, 3), killer(20, 15)]],
    ["no turn reads more", killer(20, 2), [killer(20, 2), killer(20, 1), killer(20, 0)]],
  ]) {
    const fake = reader([first, ...readings]);
    const found = await read(fake);
    assert.equal(found, first, why); assert.equal(fake.calls.length, 4, why);
  }
  // The bar itself: more than twice the first, sums in half the cages, and
  // at least CAGE_TURN_FLOOR (which a board of few cages needs).
  assert.equal(CAGE_TURN_FLOOR, 3);
  for (const [cages, first, best, turns] of [[14, 3, 7, 1], [14, 3, 6, undefined], [14, 0, 7, 1], [14, 0, 6, undefined],
    [4, 0, 3, 1], [4, 0, 2, undefined], [4, 1, 3, 1], [5, 1, 3, 1], [6, 1, 3, 1], [6, 2, 4, undefined]]) {
    const fake = reader([killer(cages, first), killer(cages, best), killer(cages, 0), killer(cages, 0)]);
    assert.equal((await read(fake)).turns, turns, `${first} -> ${best} of ${cages}`);
  }
});
test("a turned reading that fails is skipped, and a cancellation is never swallowed", async () => {
  const fake = reader([killer(20, 0), Error("No printed clues found."), killer(20, 1), killer(20, 16)]);
  const found = await read(fake);
  assert.equal(found.turns, 3); assert.equal(fake.calls.length, 4);
  const cancelled = reader([killer(20, 0), killer(20, 16), new DOMException("Scan cancelled", "AbortError")]);
  await assert.rejects(read(cancelled), { name: "AbortError" });
  assert.equal(cancelled.calls.length, 3);
});
test("a superseded check never returns its reading", async () => {
  const fake = reader([killer(20, 0), killer(20, 16), killer(20, 0), killer(20, 0)]);
  const original = fake.readOnce;
  fake.readOnce = async function (...args) {
    const value = await original.apply(this, args);
    if (fake.calls.length === 2) fake.epoch++;
    return value;
  };
  await assert.rejects(read(fake), { name: "AbortError" });
  assert.equal(fake.calls.length, 2);
});
test("only a cage type chosen for the scan takes the cage check", async () => {
  // Read as Sudoku, or with the type left to the reader, a reading with cage
  // regions takes the digit checks (photo-orientation.test.js), which a
  // reading without value regions never pays for.
  for (const type of ["sudoku", "auto"]) {
    const first = killer(20, 0);
    const fake = reader([first, killer(20, 16), killer(20, 16), killer(20, 16)]);
    assert.equal(await read(fake, { type }), first, type); assert.equal(fake.calls.length, 1, type);
  }
});
test("live previews, targeted re-reads and non-square grids keep their orientation", async () => {
  for (const [options, rows, cols] of [[{ orient: false }, 9, 9], [{}, 6, 9]]) {
    const first = killer(20, 0), fake = reader([first, killer(20, 16), killer(20, 16), killer(20, 16)]);
    const found = await read(fake, { options, rows, cols });
    assert.equal(found, first); assert.equal(fake.calls.length, 1);
  }
  // A targeted re-read of a cage puzzle is refused before any reading.
  const fake = reader([killer(20, 0)]);
  await assert.rejects(read(fake, { options: { cells: [0] } }), /Structural clues need a full scan and review/);
  assert.equal(fake.calls.length, 0);
});
