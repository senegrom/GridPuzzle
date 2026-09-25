import test from "node:test";
import assert from "node:assert/strict";
import {
  checkShape,
  makePuzzle,
  demo,
  nextReviewCell,
  changePuzzleType,
  checkSolveReady,
  fitBlackReadings,
} from "../model.js";
import { isGridStroke } from "../ocr-map.js";
import { digitCrop, puzzleFromReadings } from "../scanner.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";
import { restoreSession, saveSession } from "../session.js";

test("Only solid crop-spanning grid strokes are excluded from cage-label OCR", () => {
  const bar = {
    kind: "label",
    width: 70,
    height: 7,
    ink: 470,
    regionWidth: 70,
    cellHeight: 100,
  };
  assert.equal(isGridStroke(bar), true);
  for (const change of [
    { kind: "value" },
    { kind: "hsign" },
    { height: 20 },
    { width: 25 },
    { ink: 200 },
  ])
    assert.equal(isGridStroke({ ...bar, ...change }), false);
});
test("Imports cannot use fractional, zero or huge steps for box rendering", () => {
  for (const key of ["boxRows", "boxCols"])
    for (const value of [0, -1, 1e-12, NaN, Infinity, 26, true, "3"])
      assert.throws(() => checkShape({ ...demo(), [key]: value }));
  assert.throws(() => checkShape({ ...demo(), boxRows: 2 }));
  assert.doesNotThrow(() => checkShape(makePuzzle("sudoku", 4)));
});
test("Nested arrays and clue fields are validated before rendering", () => {
  const p = makePuzzle("kenken", 4);
  for (const cage of [
    { cells: Array(10000).fill(0), target: 4 },
    { cells: [0, 0], target: 4 },
    { cells: [0], target: "4" },
    { cells: [0], target: 4, op: "unknown" },
    { cells: [0], target: 4, extra: true },
  ])
    assert.throws(() => checkShape({ ...p, cages: [cage] }));
  assert.doesNotThrow(() =>
    checkShape({ ...p, cages: [{ cells: [0], target: null, op: "+" }] }),
  );
  assert.throws(() =>
    checkShape({ ...demo(), cages: [{ cells: [0], target: 1 }] }),
  );
  assert.throws(() =>
    checkShape({
      ...makePuzzle("futoshiki", 4),
      inequalities: [{ less: 3, greater: 4 }],
    }),
  );
  assert.throws(() =>
    checkShape({ ...demo("kakuro"), clues: [{ cell: 4, across: 7 }] }),
  );
});
test("Review visits remaining cells in board order and wraps without confirming skipped cells", () => {
  const pending = new Set([9, 0, 4]);
  assert.equal(nextReviewCell(pending), 0);
  assert.equal(nextReviewCell(pending, 0), 4);
  assert.equal(nextReviewCell(pending, 9), 0);
  assert.equal(pending.size, 3);
  assert.equal(nextReviewCell([]), null);
});

test("Faint grid corners are rejected without suppressing sparse real label text", () => {
  const corner = {
    kind: "label",
    width: 42,
    height: 20,
    ink: 100,
    edgeInk: 95,
    regionWidth: 70,
    cellHeight: 100,
  };
  assert.equal(isGridStroke(corner), true);
  for (const change of [
    { edgeInk: 60 },
    { width: 15 },
    { height: 35 },
    { kind: "value" },
  ])
    assert.equal(isGridStroke({ ...corner, ...change }), false);
});

function readings(text = "3") {
  return { entries: [
    { kind: "value", cell: 0, text: "1", confidence: 99 },
    { kind: "blackvalue", cell: 4, text, confidence: 99 },
  ], black: [false, false, false, false, true, false, false, false, false],
  meta: { boxes: false, rows: 3, cols: 3 }, mask: new Uint8Array(900), width: 30, height: 30 };
}

function scanned() { return puzzleFromReadings(readings(), "auto", 3, 3); }

function stateFor(found) {
  return { ...found, uncertain: new Set(found.cellUncertain), cageUncertain: new Set(),
    history: [], play: [], hints: new Set() };
}

test("one numbered black reading survives automatic type correction and remains flagged", () => {
  const found = scanned();
  assert.equal(found.puzzle.type, "hidato");
  assert.deepEqual(found.blackReadings, [{ cell: 4, value: 3 }]);
  assert.ok(found.cellUncertain.includes(4));
  const corrected = changePuzzleType(found.puzzle, "str8ts", found.blackReadings);
  const explicit = puzzleFromReadings(readings(), "str8ts", 3, 3).puzzle;
  assert.deepEqual(corrected, explicit);
  assert.equal(found.puzzle.cells[4], "#");
  assert.doesNotThrow(() => checkSolveReady(corrected));
});

test("raw evidence is bounded and cannot replace a manually edited cell", () => {
  const p = scanned().puzzle;
  const raw = [{ cell: 4, value: 3 }, { cell: 4, value: 1 }, { cell: 0, value: 2 },
    { cell: -1, value: 2 }, { cell: 12, value: 2 }, null, { cell: 4, value: 1e12 }];
  assert.deepEqual(fitBlackReadings(p, raw), [{ cell: 4, value: 3 }]);
  p.cells[4] = 2;
  assert.equal(changePuzzleType(p, "str8ts", raw).cells[4], 2);
  assert.deepEqual(fitBlackReadings(p, raw), []);
  assert.deepEqual(fitBlackReadings(p, {}), []);
});

test("out-of-range black readings stay flagged but cannot be installed as invalid Str8ts clues", () => {
  const found = puzzleFromReadings(readings("12"), "auto", 3, 3);
  assert.ok(found.cellUncertain.includes(4));
  assert.equal(changePuzzleType(found.puzzle, "str8ts", found.blackReadings).cells[4], "#");
  assert.doesNotThrow(() => checkSolveReady(changePuzzleType(found.puzzle, "str8ts", found.blackReadings)));
});

test("pending evidence survives autosave and undo without entering exported puzzle data", () => {
  const state = stateFor(scanned());
  let saved;
  const storage = { set(_key, value) { saved = value; }, get() { return saved; } };
  rememberEdit(state);
  saveSession(storage, state);
  assert.equal(Object.hasOwn(saved.puzzle, "blackReadings"), false);
  saved.cellUncertain = [];
  const restored = restoreSession(storage);
  assert.deepEqual(restored.blackReadings, [{ cell: 4, value: 3 }]);
  assert.ok(restored.uncertain.includes(4));
  assert.ok(restored.needsReview);
  assert.equal(changePuzzleType(restored.puzzle, "str8ts", restored.blackReadings).cells[4], 3);
  state.blackReadings[0].value = 1;
  restoreEdit(state, state.history.pop());
  assert.deepEqual(state.blackReadings, [{ cell: 4, value: 3 }]);
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

test("cage OCR retains the separate reasons a cell needs review", () => {
  const result = proposal("kenken", [
    { kind: "label", cell: 0, text: "12+" },
    { kind: "value", cell: 0, text: "1", confidence: 60 },
    { kind: "value", cell: 2, text: "" },
    { kind: "value", cell: 4, text: "2" },
  ]);
  assert.deepEqual(result.cellUncertain, [0, 2]);
  assert.equal(result.cageUncertain.length, 9);
  assert.equal(result.uncertain.length, 9);
  assert.equal(result.puzzle.cells[0], 1);
  assert.equal(result.puzzle.cells[2], null);
  assert.equal(result.puzzle.cells[4], 2);
});
