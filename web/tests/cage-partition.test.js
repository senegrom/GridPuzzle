import test from "node:test";
import assert from "node:assert/strict";
import { cagePartition, CAGE_LABEL_BOX, prepareScan } from "../scan-analysis.js";
import { puzzleFromReadings } from "../scanner.js";

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
