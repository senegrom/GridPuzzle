import test from "node:test";
import assert from "node:assert/strict";
import { puzzleFromReadings } from "../scanner.js";

function readings(entries, type = "sudoku") {
  return puzzleFromReadings(
    {
      entries,
      black: Array(81).fill(false),
      meta: { boxes: true, rows: 9, cols: 9 },
      mask: new Uint8Array(900 * 900),
      width: 900,
      height: 900,
    },
    type,
    9,
    9,
  );
}
const value = (cell, text, confidence = 90) => ({
  kind: "value", cell, text, confidence, x: 10, y: 10, w: 20, h: 40,
});

test("marked cells that read no digit at all produce a diagnostic note with the build", () => {
  const r = readings([value(4, ""), value(7, ""), value(9, "", 0)]);
  assert.match(r.notes[0], /found 3 printed marks but could not read any digit/);
  assert.match(r.notes[0], /0 of 3 regions returned text; app build/);
  assert.deepEqual(r.cellUncertain, [4, 7, 9]);
  assert.deepEqual(r.puzzle.cells.filter(Number.isInteger), []);
});

test("partial or complete readings carry no diagnostic note", () => {
  assert.equal(readings([value(4, "8"), value(7, ""), value(9, "")]).notes.some((n) => /could not read any digit/.test(n)), false);
  assert.equal(readings([value(4, ""), value(7, "")]).notes.some((n) => /could not read any digit/.test(n)), false);
});
