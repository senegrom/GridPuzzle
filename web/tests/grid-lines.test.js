import test from "node:test";
import assert from "node:assert/strict";
import { estimateGrid, gridLines } from "../geometry.js";

// A 540 x 540 warp of a 9 x 9 grid drawn the way a photograph thresholds:
// thick box lines, thin cell lines at a chosen grey, digits as short strokes
// in cell centres. Options drop a thin line, add a stray line inside the
// edge, or fill every cell with a digit.
function warp({ thin = 60, drop = null, stray = false, dense = false } = {}) {
  const n = 540, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 250);
  const line = (k) => Math.round(k * (n - 1) / 9);
  for (let k = 0; k <= 9; k++) {
    const thick = k % 3 === 0, width = thick ? 5 : 1, shade = thick ? 0 : thin;
    for (let d = -(width >> 1); d <= width >> 1; d++) for (let t = 0; t < n; t++) {
      if (drop !== `x${k}`) px(Math.min(n - 1, Math.max(0, line(k) + d)), t, shade);
      if (drop !== `y${k}`) px(t, Math.min(n - 1, Math.max(0, line(k) + d)), shade);
    }
  }
  if (stray) for (let t = 0; t < n; t++) px(14, t, 0);
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (!dense && (r + c) % 2) continue;
    const cx = Math.round((c + .5) * n / 9), y0 = Math.round((r + .2) * n / 9), y1 = Math.round((r + .8) * n / 9);
    for (let y = y0; y < y1; y++) for (let d = -1; d <= 1; d++) px(cx + d, y, 0);
  }
  return { width: n, height: n, data };
}

test("thin and light-grey cell lines are read", () => {
  for (const thin of [60, 120, 170, 200]) {
    const grid = estimateGrid(warp({ thin }));
    assert.equal(grid.rows, 9, `rows at grey ${thin}`); assert.equal(grid.cols, 9); assert.equal(grid.boxes, true);
  }
});
test("digit columns of a half-filled grid are not lines", () => {
  const lines = gridLines(warp()), centre = 4.5 * 540 / 9;
  assert.ok(!lines.x.some((l) => Math.abs(l.at - centre) < 6), "no line at a cell centre");
  assert.equal(lines.x.length, 10);
});
test("a grid with every cell filled is not read as twice as fine", () => {
  const grid = estimateGrid(warp({ dense: true }));
  assert.equal(grid.rows, 9); assert.equal(grid.cols, 9);
});
test("one dropped thin line still yields the 9 x 9 lattice", () => {
  const grid = estimateGrid(warp({ drop: "y5" }));
  assert.equal(grid.rows, 9); assert.equal(grid.cols, 9);
});
test("two dropped lines on one axis are recovered at the other axis's cell count", () => {
  const image = warp({ drop: "y5" });
  // Drop a second horizontal line by painting paper over it.
  const n = 540, y = Math.round(2 * (n - 1) / 9);
  for (let x = 0; x < n; x++) { const i = (y * n + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = 250; }
  const grid = estimateGrid(image);
  assert.equal(grid.cols, 9); assert.equal(grid.rows, 9);
});
test("a stray line just inside the edge is ignored", () => {
  const grid = estimateGrid(warp({ stray: true }));
  assert.equal(grid.rows, 9); assert.equal(grid.cols, 9);
});
test("cage walls drawn just inside the cell edges do not split the lattice", () => {
  // A 4 x 4 KenKen-style warp: thin grid lines plus dashed walls inset 11 px
  // along whole columns and rows, the pattern that collapsed the median gap.
  const n = 540, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 250);
  const line = (k) => Math.min(n - 1, Math.round(k * (n - 1) / 4));
  for (let k = 0; k <= 4; k++) for (let t = 0; t < n; t++) { px(line(k), t, 0); px(t, line(k), 0); }
  for (let k = 0; k < 4; k++) for (let t = 0; t < n; t++) if (t % 14 < 9) {
    for (const d of [11, -11]) { const q = line(k) + d + (d < 0 ? n / 4 : 0); if (q > 0 && q < n) { px(Math.round(q), t, 40); px(t, Math.round(q), 40); } }
  }
  const grid = estimateGrid({ width: n, height: n, data });
  assert.equal(grid.rows, 4); assert.equal(grid.cols, 4);
});
test("a blank warp has no grid", () => {
  const n = 540, data = new Uint8ClampedArray(n * n * 4).fill(250);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const grid = estimateGrid({ width: n, height: n, data });
  assert.equal(grid.rows, 0); assert.equal(grid.cols, 0);
});
