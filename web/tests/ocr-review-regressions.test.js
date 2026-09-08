import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";
import { digitCrop, puzzleFromReadings } from "../scanner.js";
import { checkShape, checkSolveReady } from "../model.js";

test("number crops retain two and three separate glyphs while excluding speckles", () => {
  for (const glyphs of [[124, 157], [124, 145, 166]]) {
    const width = 300, height = 300,
      data = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const at = 4 * (yy * width + xx);
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
    };
    glyphs.forEach((x, i) => ink(x, 125, i === 0 ? 5 : 9, 35));
    ink(116, 117, 2, 2);
    ink(180, 182, 3, 3);
    const { entries } = prepareScan({ width, height, data }, "numbrix", 3, 3),
      clue = entries.find((e) => e.cell === 4 && e.kind === "value");
    assert.ok(clue);
    assert.equal(clue.x, glyphs[0]);
    assert.equal(clue.x + clue.w, glyphs.at(-1) + 9);
    assert.equal(clue.y, 125);
    assert.equal(clue.h, 35);
  }
});

test("binarization retains every foreground pixel at the threshold in both polarities", () => {
  const original = globalThis.document;
  globalThis.document = {
    createElement() {
      const canvas = {};
      canvas.getContext = () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (pixels) => { canvas.pixels = pixels.data; },
      });
      return canvas;
    },
  };
  try {
    for (const [dark, light, invert] of [[0, 255, false], [25, 240, false], [0, 255, true], [25, 150, true]]) {
      const g = new Uint8Array(10000).fill(invert ? dark : light);
      for (let y = 28; y < 68; y++)
        for (let x = 40; x < 52; x++) g[y * 100 + x] = invert ? light : dark;
      const crop = digitCrop({ cell: 0, x: 40, y: 28, w: 12, h: 40, invert }, g, 100, 100, 100, 100, 1);
      assert.equal(crop.pixels.filter((v, i) => i % 4 === 0 && v === 0).length, 480);
      assert.ok(crop.pixels.every((v, i) => i % 4 !== 3 || v === 255));
    }
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

function proposal(type, entries, blackCells = []) {
  return puzzleFromReadings({
    width: 300, height: 300,
    mask: new Uint8Array(90000),
    meta: { rows: 3, cols: 3 },
    black: Array.from({ length: 9 }, (_, i) => blackCells.includes(i)),
    entries: entries.map((e) => ({ confidence: 95, ...e })),
  }, type, 3, 3);
}

test("out-of-range Str8ts black readings become editable flagged black cells", () => {
  for (const text of ["0", "4", "99", "999"]) {
    const result = proposal("str8ts", [
      { kind: "blackvalue", cell: 4, text },
      { kind: "value", cell: 0, text: "1" },
    ], [4]);
    assert.doesNotThrow(() => checkShape(result.puzzle));
    assert.deepEqual(result.puzzle.black, [4]);
    assert.equal(result.puzzle.cells[4], "#");
    assert.equal(result.puzzle.cells[0], 1);
    assert.ok(result.uncertain.includes(4));
    assert.equal(result.needsReview, true);
    assert.throws(() => checkShape({ ...result.puzzle, cells: result.puzzle.cells.map((v, i) => i === 4 ? +text : v) }));
  }
  assert.equal(proposal("str8ts", [{ kind: "blackvalue", cell: 4, text: "2" }], [4]).puzzle.cells[4], 2);
});

test("a bad Kakuro direction preserves other targets and can be corrected before solving", () => {
  const result = proposal("kakuro", [
    { kind: "across", cell: 3, text: "99" },
    { kind: "down", cell: 1, text: "4" },
    { kind: "down", cell: 2, text: "6" },
    { kind: "across", cell: 6, text: "7" },
  ], [0, 1, 2, 3, 6]);
  assert.doesNotThrow(() => checkShape(result.puzzle));
  assert.equal(result.puzzle.clues.length, 3);
  assert.ok(result.uncertain.includes(3));
  assert.equal(result.needsReview, true);
  assert.throws(() => checkSolveReady(result.puzzle), /incomplete/);
  result.puzzle.clues.push({ cell: 3, across: 3 });
  assert.doesNotThrow(() => checkSolveReady(result.puzzle));
});

test("incompatible cage OCR stays reviewable without inventing an operator or allowing Solve", () => {
  for (const text of ["2-", "2/", "2÷", "2="]) {
    const result = proposal("kenken", [{ kind: "label", cell: 0, text }]);
    assert.doesNotThrow(() => checkShape(result.puzzle));
    assert.deepEqual(result.puzzle.cages, []);
    assert.equal(result.uncertain.length, 9);
    assert.equal(result.needsReview, true);
    assert.ok(result.notes.some((note) => note.includes(text)));
    assert.throws(() => checkSolveReady(result.puzzle), /cover every cell/);
    result.puzzle.cages = [0, 1, 2].map((r) => ({ cells: [r * 3, r * 3 + 1, r * 3 + 2], target: 6, op: "+" }));
    assert.doesNotThrow(() => checkSolveReady(result.puzzle));
  }
});

test("zero and ambiguous cage targets remain incomplete until corrected", () => {
  for (const entries of [
    [{ kind: "label", cell: 0, text: "0+" }],
    [{ kind: "label", cell: 0, text: "3+" }, { kind: "label", cell: 4, text: "6+" }],
  ]) {
    const result = proposal("kenken", entries);
    assert.doesNotThrow(() => checkShape(result.puzzle));
    assert.equal(result.puzzle.cages[0].target, null);
    assert.throws(() => checkSolveReady(result.puzzle), /target/);
  }
});
