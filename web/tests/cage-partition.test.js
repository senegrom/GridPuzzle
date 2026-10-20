import test from "node:test";
import assert from "node:assert/strict";
import { cagePartition, CAGE_CLUE_FLOOR, CAGE_LABEL_BOX, prepareScan } from "../scan-analysis.js";
import { cageLabelCrop, puzzleFromReadings } from "../scanner.js";

// A 4 x 4 board of 100 px cells: thin grid lines, then cage borders in the chosen style.
function board({ style = "inset", thickBoxes = false, borders = [["h", 1]], stray = false } = {}) {
  const size = 400, g = new Uint8Array(size * size).fill(240);
  const ink = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) g[y * size + x] = 20;
  };
  for (let k = 0; k <= 4; k++) { ink(k * 100 - 1, 0, k * 100 + 1, size); ink(0, k * 100 - 1, size, k * 100 + 1); }
  if (thickBoxes) { ink(196, 0, 204, size); ink(0, 196, size, 204); }
  // A one-sided mark 8 px inside cell 1, beside the edge it shares with cell 0 (same cage).
  if (stray) ink(107, 20, 109, 80);
  for (const [axis, index] of borders) {
    const at = (index + 1) * 100; // the edge after row/column `index`
    if (style === "thick") { if (axis === "h") ink(0, at - 4, size, at + 4); else ink(at - 4, 0, at + 4, size); continue; }
    for (let s = 0; s < size; s += 14) for (const offset of [-8, 8]) { // dashed lines 8 px inside both cells
      if (axis === "h") ink(s, at + offset - 1, s + 7, at + offset + 1); else ink(at + offset - 1, s, at + offset + 1, s + 7);
    }
  }
  const mask = Uint8Array.from(g, (v) => (v < 128 ? 1 : 0));
  return { g, mask, size };
}
const sorted = (areas) => areas.map((a) => [...a].sort((x, y) => x - y)).sort((a, b) => a[0] - b[0]);
const halves = [[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]];

test("dashed inset outlines split a KenKen board, in the inset style", () => {
  const { g, mask } = board({ style: "inset" });
  const { areas, style } = cagePartition(mask, g, 400, 400, 4, 4, "kenken");
  assert.equal(style, "inset"); assert.deepEqual(sorted(areas), halves);
});
test("an inset border needs outline ink on both sides: a one-sided mark splits nothing", () => {
  // The top row is one cage, so a false border between cells 0 and 1 would cut it in two.
  const { g, mask } = board({ style: "inset", stray: true, borders: [["h", 0]] });
  assert.deepEqual(sorted(cagePartition(mask, g, 400, 400, 4, 4, "kenken").areas), [[0, 1, 2, 3], [...Array(12).keys()].map((i) => i + 4)]);
});
test("thick lines between cages split a KenKen board, in the thick style", () => {
  const { g, mask } = board({ style: "thick", borders: [["h", 1], ["v", 1]] });
  const { areas, style } = cagePartition(mask, g, 400, 400, 4, 4, "kenken");
  assert.equal(style, "thick");
  assert.deepEqual(sorted(areas), [[0, 1, 4, 5], [2, 3, 6, 7], [8, 9, 12, 13], [10, 11, 14, 15]]);
});
test("a Killer board's thick box lines are not cage borders; its dashed outlines are", () => {
  const { g, mask } = board({ style: "inset", thickBoxes: true, borders: [["h", 0]] });
  const { areas, style } = cagePartition(mask, g, 400, 400, 4, 4, "killersudoku");
  assert.equal(style, "inset");
  assert.deepEqual(sorted(areas), [[0, 1, 2, 3], [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]);
});
test("thin grid lines alone make one cage", () => {
  const { g, mask } = board({ borders: [] });
  assert.deepEqual(sorted(cagePartition(mask, g, 400, 400, 4, 4, "kenken").areas), [[...Array(16).keys()]]);
});
test("prepareScan reads one clue region per cage, at its head, placed by the print style", () => {
  for (const style of ["inset", "thick"]) {
    const { g } = board({ style });
    const data = new Uint8ClampedArray(400 * 400 * 4);
    g.forEach((v, i) => { data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v; data[4 * i + 3] = 255; });
    const prepared = prepareScan({ width: 400, height: 400, data }, "kenken", 4, 4);
    assert.deepEqual(sorted(prepared.cageAreas), halves, style);
    const labels = prepared.entries.filter((e) => e.kind === "label");
    assert.deepEqual(labels.map((e) => e.cell).sort((a, b) => a - b), [0, 8]);
    assert.ok(labels.every((e) => e.cageLabel));
    const [x0, y0] = CAGE_LABEL_BOX[style], head = labels.find((e) => e.cell === 8);
    assert.deepEqual([head.x, head.y], [Math.round(x0 * 100), Math.round((2 + y0) * 100)]);
  }
});
test("cages come from the partition; each takes its head's clue and stays under structural review", () => {
  const entries = [{ kind: "label", cell: 0, text: "12+", confidence: 95, x: 11, y: 12, w: 69, h: 32 },
    { kind: "label", cell: 8, text: "", confidence: 0, x: 11, y: 212, w: 69, h: 32 }];
  const found = puzzleFromReadings({ entries, black: Array(16).fill(false), meta: { rows: 4, cols: 4, boxes: false },
    mask: new Uint8Array(400 * 400), width: 400, height: 400, cageAreas: halves }, "kenken", 4, 4);
  assert.deepEqual(found.puzzle.cages, [{ cells: halves[0], target: 12, op: "+" }, { cells: halves[1], target: null, op: "+" }]);
  assert.deepEqual([...found.cageUncertain].sort((a, b) => a - b), [...Array(16).keys()]);
  assert.ok(found.notes.some((note) => /needs its boundary\/target checked/.test(note)));
});

// Just enough 2D canvas for cageLabelCrop: white fills, nearest-neighbour
// drawImage from another fake canvas, and whole-canvas pixel access.
function fakeCanvas(width = 0, height = 0) {
  const canvas = { width, height, rgba: null };
  const rgba = () => (canvas.rgba ??= new Uint8ClampedArray(canvas.width * canvas.height * 4));
  const context = {
    fillRect(x, y, w, h) {
      for (let yy = y; yy < y + h; yy++) rgba().fill(255, 4 * (yy * canvas.width + x), 4 * (yy * canvas.width + x + w));
    },
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const from = 4 * ((sy + Math.floor((y * sh) / dh)) * source.width + sx + Math.floor((x * sw) / dw));
        rgba().set(source.rgba.subarray(from, from + 4), 4 * ((dy + y) * canvas.width + dx + x));
      }
    },
    getImageData: () => ({ data: rgba().slice() }),
    putImageData(image) { rgba().set(image.data); },
  };
  canvas.getContext = () => context;
  return canvas;
}
test("a cage clue on grey paper keeps its ink, and its paper and margin stay white", (t) => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => fakeCanvas() };
  t.after(() => { globalThis.document = previous; });
  // An 80 x 40 clue box (so no scaling) holding a stroke of ink at 60, on
  // the paper of a dim photograph (170) and of a clean print (245).
  for (const paper of [170, 245]) {
    const source = fakeCanvas(200, 100);
    source.rgba = new Uint8ClampedArray(200 * 100 * 4).fill(paper);
    for (let y = 25; y < 55; y++) for (let x = 30; x < 36; x++) source.rgba.fill(60, 4 * (y * 200 + x), 4 * (y * 200 + x) + 3);
    const { canvas: out, ink } = cageLabelCrop({ x: 20, y: 20, w: 80, h: 40 }, source), at = (x, y) => out.rgba[4 * (y * out.width + x)];
    assert.deepEqual([out.width, out.height], [112, 72]);
    assert.equal(at(16 + 12, 16 + 20), 0, `stroke on paper ${paper}`);
    assert.equal(at(16 + 60, 16 + 30), 255, `paper ${paper}`);
    assert.equal(at(4, 4), 255, `margin on paper ${paper}`);
    // The ink handed to the operator reader is the same picture, 1 for ink.
    assert.deepEqual([ink[(16 + 20) * 112 + 16 + 12], ink[(16 + 30) * 112 + 16 + 60], ink[4 * 112 + 4]], [1, 0, 0]);
  }
});

// A cage's clue sits at the top of its head cell (CAGE_LABEL_BOX). Its first
// digit used to reach into the head's value region (from 0.16 of the cell
// down), where all three readers agreed on it as a given digit with
// confidence 90-99, flagged only "check cage". Unless substantial ink reaches
// below the cell's middle, as a printed given's does, the head's value region
// now drops the ink lying wholly above it (CAGE_CLUE_FLOOR), so a given printed
// in a head is still read whole; other cells are unchanged.
function boardImage(style, marks, borders = undefined) {
  const { g } = board({ style, borders });
  for (const [cell, x0, y0, x1, y1] of marks) {
    const left = (cell % 4) * 100, top = Math.floor(cell / 4) * 100;
    for (let y = top + y0; y < top + y1; y++) for (let x = left + x0; x < left + x1; x++) g[y * 400 + x] = 20;
  }
  const data = new Uint8ClampedArray(400 * 400 * 4);
  g.forEach((v, i) => { data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v; data[4 * i + 3] = 255; });
  return { width: 400, height: 400, data };
}
test("a cage head's clue is not read as a digit in its value region", () => {
  for (const style of ["inset", "thick"]) {
    const [, y0, , y1] = CAGE_LABEL_BOX[style];
    // A clue glyph in each head (cells 0 and 8), 22 px tall, reaching 0.34
    // of the cell as the corpus's clues do, and a given in cell 5. Cell 0's
    // clue lies wholly inside the value region, which only the faint-mark
    // recovery would otherwise pick up.
    const clue = (cell, top = 12) => [cell, 20, top, 27, top + 22], given = [5, 45, 25, 53, 75];
    const prepared = prepareScan(boardImage(style, [clue(0, 18), clue(8), given]), "kenken", 4, 4);
    const values = prepared.entries.filter((e) => e.kind === "value");
    assert.deepEqual(values.map((e) => e.cell), [5], style);
    assert.deepEqual(prepared.unreadCells, [], style);
    assert.ok(y0 <= 0.12 && y1 >= 0.4 && y1 <= CAGE_CLUE_FLOOR, `${style}: the clues lie in the clue box, above the floor`);
    // A digit printed below the clue box of a head is still read.
    const below = prepareScan(boardImage(style, [clue(8), [8, 45, 50, 53, 85]]), "kenken", 4, 4);
    const read = below.entries.filter((e) => e.kind === "value");
    assert.deepEqual(read.map((e) => e.cell), [8], style);
    assert.equal(read[0].y, 250, `${style}: the mark at y 250, not the clue`);
  }
});
test("a given printed in a cage head is read whole, though its top reaches beside its clue", () => {
  for (const style of ["inset", "thick"]) {
    // Centred, as a printed given is: from 0.24 to 0.72 of the cell, beside a
    // clue reaching 0.34 (in cell 9, under a wide clue it nearly touches; in
    // cell 1, printed in two pieces, the upper one wholly above the cell's
    // middle). Cells 1, 8 and 9 are heads.
    const marks = [[1, 20, 12, 27, 34], [1, 46, 24, 54, 38], [1, 46, 41, 54, 72],
      [8, 20, 12, 27, 34], [8, 46, 24, 54, 72], [9, 14, 12, 70, 22], [9, 46, 24, 54, 72]];
    const prepared = prepareScan(boardImage(style, marks, [["h", 1], ["v", 0]]), "kenken", 4, 4);
    assert.deepEqual(sorted(prepared.cageAreas).map((cells) => cells[0]), [0, 1, 8, 9], style);
    const read = prepared.entries.filter((e) => e.kind === "value").map(({ cell, y, h }) => [cell, y, h]);
    assert.deepEqual(read, [[1, 24, 48], [8, 224, 48], [9, 224, 48]], style);
  }
});
test("cell value regions are unchanged outside cage boards", () => {
  // The same marks read as KenKen and as a Latin square: only the heads differ.
  const image = boardImage("inset", [[0, 20, 12, 27, 34], [5, 45, 25, 53, 75]]);
  const latin = prepareScan(image, "latinsquare", 4, 4).entries.filter((e) => e.kind === "value");
  assert.deepEqual(latin.map((e) => e.cell), [0, 5]);
  assert.equal(latin[0].y, 16, "a Latin square's value region starts at 0.16 of the cell");
});
test("every digit read on a cage board goes to digit review, with a note; elsewhere a confident digit does not", () => {
  const value = (cell, text) => ({ kind: "value", cell, text, confidence: 99, x: 0, y: 0, w: 8, h: 20 });
  const read = (type, entries, extra = {}) => puzzleFromReadings({ entries, black: Array(16).fill(false),
    meta: { rows: 4, cols: 4, boxes: false }, mask: new Uint8Array(400 * 400), width: 400, height: 400, ...extra }, type, 4, 4);
  // One cage per row, each summing to 10: Latin and Killer rules both hold.
  const rowsAsCages = [0, 4, 8, 12].map((head) => [head, head + 1, head + 2, head + 3]),
    labels = [0, 4, 8, 12].map((cell) => ({ kind: "label", cell, text: cell ? "10" : "10+", confidence: 95, cageLabel: true }));
  for (const type of ["kenken", "killersudoku"]) {
    const one = read(type, [value(0, "1"), ...labels], { cageAreas: rowsAsCages });
    assert.equal(one.puzzle.cells[0], 1, type);
    assert.deepEqual(one.cellUncertain, [0], type);
    assert.ok(one.notes.includes("1 highlighted digit was read in a cell of this cage puzzle. Cage puzzles rarely print digits in their cells, and part of a cage's clue can read as one. Check it against the photo, and clear it if it is not printed in the cell."), type);
    const two = read(type, [value(0, "1"), value(9, "3"), ...labels], { cageAreas: rowsAsCages });
    assert.deepEqual([...two.cellUncertain].sort((a, b) => a - b), [0, 9], type);
    assert.ok(two.notes.includes("2 highlighted digits were read in cells of this cage puzzle. Cage puzzles rarely print digits in their cells, and part of a cage's clue can read as one. Check each against the photo, and clear any that is not printed in its cell."), type);
    // The digit's flag is digit review's own: the cage review covers the cell too.
    assert.ok(two.cageUncertain.includes(0) && two.uncertain.includes(0), type);
    const none = read(type, labels, { cageAreas: rowsAsCages });
    assert.deepEqual(none.cellUncertain, [], type);
    assert.ok(!none.notes.some((note) => /cage puzzle\. Cage puzzles rarely/.test(note)), type);
  }
  const latin = read("latinsquare", [value(0, "1"), value(9, "3")]);
  assert.deepEqual(latin.cellUncertain, []);
});
