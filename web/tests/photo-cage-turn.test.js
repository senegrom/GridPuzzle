import test from "node:test";
import assert from "node:assert/strict";
import { Scanner, CAGE_TURN_BUDGET } from "../scanner.js";
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
// A reading may also be a function, called as readOnce with the fake and the
// read's check, for a reading that takes its time or meets a cancellation.
// The fake's deadlines keep each timer for a test to fire, and its OCR engine
// and image-processing jobs count what a stop cancels.
function reader(readings) {
  const calls = [], timers = [];
  const fake = { calls, timers, epoch: 0, cancel() {}, orient: Scanner.prototype.orient, halfTurn: Scanner.prototype.halfTurn,
    cageTurn: Scanner.prototype.cageTurn, jobs: new Set(), ocr: { cancelled: 0, cancel() { this.cancelled++; } },
    deadlines: {
      setTimer(callback, ms) { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
      clearTimer(timer) { timer.cleared = true; },
    },
    async readOnce(_canvas, quad, ...rest) {
      calls.push(quad);
      const next = readings[calls.length - 1];
      if (typeof next === "function") return next(fake, rest.at(-1));
      if (next instanceof Error) throw next;
      return next;
    } };
  return fake;
}
// A turned reading still in progress when `during` runs (the budget running
// out, a newer read): it waits on an image-processing job, which a stop
// cancels.
const slowReading = (during) => (fake) => new Promise((_resolve, reject) => {
  fake.jobs.add({ cancel: () => reject(new DOMException("Scan cancelled", "AbortError")) });
  during(fake);
});
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
  // The same turned reading of a 6 x 6 KenKen, which can, is kept.
  for (const [n, turns] of [[4, undefined], [6, 1]]) {
    const cages = (read) => killer(6, read, { type: "kenken", n, target: 15, op: "*" });
    const once = reader([cages(0), cages(6), cages(0), cages(0)]);
    assert.equal((await read(once, { type: "kenken", rows: n, cols: n })).turns, turns, `${n} x ${n}`);
  }
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
test("a check superseded during its last turned read never returns a reading", async () => {
  // The last turned read comes back, or fails as a retired worker's does,
  // with no turn left for the loop to notice the newer read.
  for (const ending of ["comes back", "fails"]) {
    const fake = reader([killer(20, 0), killer(20, 1), killer(20, 0), async (fake) => {
      fake.epoch++;
      if (ending === "fails") throw Error("Image processing failed");
      return killer(20, 17);
    }]);
    await assert.rejects(read(fake), { name: "AbortError" }, ending);
    assert.equal(fake.calls.length, 4, ending);
  }
});
test("a cancellation from the progress message stops the check before a turned read starts", async () => {
  const fake = reader([killer(20, 0), killer(20, 17), killer(20, 0), killer(20, 0)]);
  await assert.rejects(read(fake, { progress: () => { fake.epoch++; } }), { name: "AbortError" });
  assert.equal(fake.calls.length, 1);
});
test("the check keeps to its time budget, counted from the first reading, and then keeps the first reading", async () => {
  // What the first reading took is gone from the budget; the turned reading in
  // progress when the rest runs out is stopped (its OCR and image processing
  // cancelled), no other starts, and a turn that already cleared the bar is
  // not kept: nothing has shown that no other turn reads as well.
  const first = { ...killer(20, 0), timings: { total: 20000 } };
  const fake = reader([first, killer(20, 17), slowReading((fake) => fake.timers[0].callback()), killer(20, 0)]);
  assert.equal(await read(fake), first);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.timers.map(({ ms, cleared }) => ({ ms, cleared })), [{ ms: CAGE_TURN_BUDGET - 20000, cleared: true }]);
  assert.equal(fake.ocr.cancelled, 1); assert.equal(fake.jobs.size, 0);
  // A reading between two stages stops at the next one (readOnce checks
  // between its stages), and a reading that comes back anyway is not kept.
  let stages = 0;
  const stagedFirst = killer(20, 0), staged = reader([stagedFirst, async (fake, check) => {
    fake.timers[0].callback(); await null; check(); stages++; return killer(20, 17);
  }, killer(20, 0), killer(20, 0)]);
  assert.equal(await read(staged), stagedFirst);
  assert.equal(stages, 0); assert.equal(staged.calls.length, 2);
  const lateFirst = killer(20, 0), late = reader([lateFirst, async (fake) => {
    fake.timers[0].callback(); await null; return killer(20, 17);
  }, killer(20, 0), killer(20, 0)]);
  assert.equal(await read(late), lateFirst); assert.equal(late.calls.length, 2);
  // A first reading that used the whole budget is not read again.
  const slow = { ...killer(20, 0), timings: { total: CAGE_TURN_BUDGET } }, spent = reader([slow, killer(20, 17)]);
  assert.equal(await read(spent), slow); assert.equal(spent.calls.length, 1); assert.equal(spent.timers.length, 0);
  // A check that ends by itself ends its budget too.
  const done = reader([killer(20, 1), killer(20, 17), killer(20, 0), killer(20, 0)]);
  assert.equal((await read(done)).turns, 1);
  assert.deepEqual(done.timers.map(({ ms, cleared }) => ({ ms, cleared })), [{ ms: CAGE_TURN_BUDGET, cleared: true }]);
  assert.equal(done.ocr.cancelled, 0);
});
test("once a newer read supersedes the check, its budget running out stops nothing of the newer read", async () => {
  const fake = reader([killer(20, 0), killer(20, 0), async (fake) => {
    fake.epoch++;
    fake.jobs.add({ cancel: () => assert.fail("the newer read's image processing was cancelled") });
    fake.timers[0].callback();
    return killer(20, 17);
  }]);
  await assert.rejects(read(fake), { name: "AbortError" });
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.ocr.cancelled, 0); assert.equal(fake.jobs.size, 1); assert.equal(fake.timers[0].cleared, true);
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

// Recorded readings (WebKit 27.2, base b6bf933, through the import, detector
// corners and photoDetail as the corpus benchmark reads them): the four
// readings of one photograph through its crop turned 0 to 3 times
// (f-cageturn matrix), as [clue regions, [[target, operator, ...cells]]]. A
// page lying so that it first reads as reading a is read again turned j to
// give reading (a + j) % 4.
function recorded(readings, type, n) {
  return readings.map(([regions, cages]) => ({
    puzzle: { type, rows: n, cols: n, cells: Array(n * n).fill(null),
      cages: cages.map(([target, op, ...cells]) => ({ cells, target, op })) },
    entries: Array.from({ length: regions }, (_, cell) => ({ kind: "label", cell, cageLabel: true })),
    uncertain: [], notes: ["kept"] }));
}
function asLying(readings, a) {
  return [0, 1, 2, 3].map((j) => readings[(a + j) % 4]);
}
// janko-killersudoku-004-photo (a 6 x 6 Sumdoku): upright, 12 sums read, 10 of
// them a 2- or 3-cell cage can hold (not the 23 or the 1); turned, at most one.
const SUMDOKU = recorded([[14,[[12,"+",0,1,7],[12,"+",2,8,9],[10,"+",3,4,5],[23,"+",6,12],[1,"+",10,11,17],[7,"+",13,19],[11,"+",14,15,21],[null,"+",16,22],[18,"+",18,24,25,30],[3,"+",20,26],[7,"+",23,29],[11,"+",27,33],[null,"+",28,34,35],[5,"+",31,32]]],
  [14,[[null,"+",0,6,12],[null,"+",1,2,7],[null,"+",3,4],[null,"+",5,10,11],[null,"+",8,9],[null,"+",13,18,19],[null,"+",14,15,20],[null,"+",16,17],[null,"+",21,22],[null,"+",23,29],[null,"+",24,25,30],[7,"+",26,27],[null,"+",28,33,34,35],[null,"+",31,32]]],
  [14,[[null,"+",0,1,7],[null,"+",2,8],[null,"+",3,4],[null,"+",5,10,11,17],[null,"+",6,12],[null,"+",9,15],[null,"+",13,19],[null,"+",14,20,21],[null,"+",16,22],[null,"+",18,24,25],[null,"+",23,29],[null,"+",26,27,33],[null,"+",28,34,35],[null,"+",30,31,32]]],
  [14,[[null,"+",0,1,2,7],[null,"+",3,4],[null,"+",5,10,11],[null,"+",6,12],[null,"+",8,9],[null,"+",13,14],[null,"+",15,20,21],[null,"+",16,17,22],[null,"+",18,19],[null,"+",23,29,35],[null,"+",24,25,30],[null,"+",26,27],[null,"+",28,33,34],[null,"+",31,32]]]], "kenken", 6);
// generated-render-sum-only killersudoku-006-photo (9 x 9 Killer): upright,
// only 8 of 45 sums that can stand (3 of them right); turned, none.
const KILLER = recorded([[45,[[null,"+",0,9],[null,"+",1],[null,"+",2,3,12],[7,"+",4,5],[null,"+",6,7,8],[2,"+",10,19],[null,"+",11],[null,"+",13,14],[null,"+",15],[5,"+",16],[null,"+",17,26,35],[1,"+",18,27],[null,"+",20,29,38],[3,"+",21,22],[null,"+",23,24,25,34],[null,"+",28],[7,"+",30],[null,"+",31],[4,"+",32],[null,"+",33],[null,"+",36,37],[null,"+",39],[null,"+",40],[null,"+",41],[null,"+",42,50,51],[null,"+",43,44],[3,"+",45,54,63],[null,"+",46,55],[null,"+",47,48,56],[null,"+",49,58],[null,"+",52,61],[null,"+",53,62,71],[null,"+",57],[null,"+",59],[7,"+",60],[3,"+",64,73],[null,"+",65,74],[null,"+",66],[null,"+",67,76],[null,"+",68,69,78],[null,"+",70,79],[5,"+",72],[null,"+",75],[null,"+",77],[null,"+",80]]],
  [45,[[null,"+",0,9,18],[null,"+",1,2,3],[null,"+",4,13],[null,"+",5,6,7],[null,"+",8],[null,"+",10],[null,"+",11,12,20,29],[null,"+",14,15],[null,"+",16,17],[null,"+",19],[null,"+",21],[null,"+",22,23,32],[null,"+",24],[null,"+",25,26,34],[null,"+",27,36],[null,"+",28,37],[null,"+",30],[null,"+",31],[null,"+",33],[null,"+",35],[null,"+",38,47],[null,"+",39],[null,"+",40],[null,"+",41,42],[null,"+",43,44],[null,"+",45,46,54],[null,"+",48],[null,"+",49],[null,"+",50,59,60],[null,"+",51],[null,"+",52],[null,"+",53],[null,"+",55],[null,"+",56,57,58],[null,"+",61,62],[null,"+",63],[null,"+",64,65],[null,"+",66],[null,"+",67,76],[null,"+",68,69],[null,"+",70,71],[null,"+",72,73],[null,"+",74,75],[null,"+",77,78,79],[null,"+",80]]],
  [45,[[null,"+",0],[null,"+",1,10],[null,"+",2,11,12],[null,"+",3],[null,"+",4,13],[null,"+",5],[null,"+",6,15],[null,"+",7,16],[null,"+",8],[null,"+",9,18,27],[null,"+",14],[null,"+",17,26,35],[null,"+",19,28],[null,"+",20],[null,"+",21],[null,"+",22,31],[null,"+",23],[null,"+",24,32,33],[null,"+",25,34],[null,"+",29,30,38],[null,"+",36,37],[null,"+",39],[null,"+",40],[null,"+",41],[null,"+",42,51,60],[null,"+",43,44],[null,"+",45,54,63],[null,"+",46,55,56,57],[null,"+",47],[null,"+",48],[null,"+",49],[null,"+",50],[null,"+",52],[null,"+",53,62],[null,"+",58,59],[null,"+",61,70],[null,"+",64],[null,"+",65],[null,"+",66,67],[null,"+",68,77,78],[null,"+",69],[null,"+",71,80],[null,"+",72,73,74],[null,"+",75,76],[null,"+",79]]],
  [45,[[null,"+",0],[null,"+",1,2,3],[null,"+",4,13],[null,"+",5,6],[null,"+",7,8],[null,"+",9,10],[null,"+",11,12],[null,"+",14],[null,"+",15,16],[null,"+",17],[null,"+",18,19],[null,"+",20,21,30],[null,"+",22,23,24],[null,"+",25],[null,"+",26,34,35],[null,"+",27],[null,"+",28],[null,"+",29],[null,"+",31],[null,"+",32],[null,"+",33,42],[null,"+",36,37],[null,"+",38,39],[null,"+",40],[null,"+",41],[null,"+",43,52],[null,"+",44,53],[null,"+",45],[null,"+",46,54,55],[null,"+",47],[null,"+",48,57,58],[null,"+",49],[null,"+",50],[null,"+",51,60,68,69],[null,"+",56],[null,"+",59],[null,"+",61],[null,"+",62,71,80],[null,"+",63,64],[null,"+",65,66],[null,"+",67,76],[null,"+",70],[null,"+",72],[null,"+",73,74,75],[null,"+",77,78,79]]]], "killersudoku", 9);
test("real: a Sumdoku photograph lying turned any way is read upright, and upright it is read once", async () => {
  assert.deepEqual(SUMDOKU.map((found) => cageSums(found)),
    [{ cages: 14, sums: 10 }, { cages: 14, sums: 1 }, { cages: 14, sums: 0 }, { cages: 14, sums: 0 }]);
  const upright = reader([SUMDOKU[0]]);
  assert.equal(await read(upright, { type: "kenken", rows: 6, cols: 6 }), SUMDOKU[0]);
  assert.equal(upright.calls.length, 1);
  for (const a of [1, 2, 3]) {
    const fake = reader(asLying(SUMDOKU, a)), found = await read(fake, { type: "kenken", rows: 6, cols: 6 });
    assert.equal(fake.calls.length, 4, `lying as ${a}`);
    assert.equal(found.turns, (4 - a) % 4, `lying as ${a}`);
    assert.equal(found.puzzle, SUMDOKU[0].puzzle);
  }
});
test("real: a Killer photograph read poorly is read again but never turned, nor is it turned from any side", async () => {
  assert.deepEqual(KILLER.map((found) => cageSums(found).sums), [8, 0, 0, 0]);
  // Upright, 8 of 45 is under half, so the photograph is read in all three
  // turns, and none reads a sum; lying turned, the upright reading's 8 sums
  // are not half its cages, so the check leaves it as it lies (as master).
  for (const a of [0, 1, 2, 3]) {
    const fake = reader(asLying(KILLER, a)), found = await read(fake);
    assert.equal(fake.calls.length, 4, `lying as ${a}`);
    assert.equal(found.turns, undefined, `lying as ${a}`);
    assert.equal(found.puzzle, KILLER[a].puzzle);
  }
});
