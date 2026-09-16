import test from "node:test";
import assert from "node:assert/strict";
import { estimateGrid, findGrid, gridLines } from "../geometry.js";

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
test("a page on a dark table: the grid inside the page's edge wins over the edge", () => {
  // Dark surface, lighter page with a 9 x 9 grid inside it: the page edge is
  // the largest component of the ink mask and must not be the outline.
  const n = 640, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, x >= 60 && x < 580 && y >= 60 && y < 580 ? 245 : 120);
  const g0 = 130, cell = 40;
  for (let k = 0; k <= 9; k++) for (let t = g0; t <= g0 + 9 * cell; t++) for (let d = 0; d < (k % 3 ? 1 : 3); d++) { px(g0 + k * cell + d, t, 0); px(t, g0 + k * cell + d, 0); }
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 9); assert.equal(found.cols, 9);
  assert.ok(Math.abs(found.corners[0].x - g0) <= 3 && Math.abs(found.corners[2].x - (g0 + 9 * cell + 2)) <= 4, JSON.stringify(found.corners));
});
test("black corner cells: the lattice is read past them and the corners settle on it", () => {
  // A Kakuro-like 8 x 8 grid whose first row and column are black cells.
  const n = 640, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 245);
  const g0 = 80, cell = 60, g1 = g0 + 8 * cell;
  for (let y = g0; y < g1; y++) for (let x = g0; x < g1; x++) if (x < g0 + cell || y < g0 + cell) px(x, y, 20);
  for (let k = 0; k <= 8; k++) for (let t = g0; t <= g1; t++) { px(g0 + k * cell, t, 20); px(t, g0 + k * cell, 20); }
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 8); assert.equal(found.cols, 8);
  const truth = [[g0, g0], [g1, g0], [g1, g1], [g0, g1]];
  // Within about 1% of the grid: the border along black cells is read from
  // the outer member of its cluster, the black cell's rim being the stronger.
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("a blob touching a corner does not keep the corner off the grid", () => {
  const n = 640, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 245);
  const g0 = 100, cell = 48, g1 = g0 + 9 * cell;
  for (let k = 0; k <= 9; k++) for (let t = g0; t <= g1; t++) for (let d = 0; d < (k % 3 ? 1 : 3); d++) { px(g0 + k * cell + d, t, 0); px(t, g0 + k * cell + d, 0); }
  for (let y = g0 - 14; y <= g0 + 2; y++) for (let x = g1 - 2; x <= g1 + 14; x++) px(x, y, 0);
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 9); assert.equal(found.cols, 9);
  assert.ok(Math.abs(found.corners[1].x - (g1 + 1)) <= 6 && Math.abs(found.corners[1].y - (g0 + 1)) <= 6, JSON.stringify(found.corners[1]));
});
test("a Kakuro-like grid with two fifths black cells and split clue cells is found", () => {
  // 10 x 12 cells, 36 px each, black first row and column, scattered black
  // clue cells (some adjacent, so their shared boundary is invisible), each
  // clue cell split by a white diagonal, thin lines elsewhere.
  const n = 640, rows = 10, cols = 12, cell = 36, g0 = 60, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 246);
  const black = (r, c) => r === 0 || c === 0 || (r * 7 + c * 3) % 5 === 0 || (r === 4 && c >= 5 && c <= 7);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (black(r, c)) {
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) px(g0 + c * cell + x, g0 + r * cell + y, 22);
    for (let d = 0; d < cell; d++) px(g0 + c * cell + d, g0 + r * cell + d, 246);
  }
  for (let k = 0; k <= cols; k++) for (let t = g0; t <= g0 + rows * cell; t++) px(g0 + k * cell, t, 22);
  for (let k = 0; k <= rows; k++) for (let t = g0; t <= g0 + cols * cell; t++) px(t, g0 + k * cell, 22);
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, rows); assert.equal(found.cols, cols);
  const truth = [[g0, g0], [g0 + cols * cell, g0], [g0 + cols * cell, g0 + rows * cell], [g0, g0 + rows * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("clue diagonals that cut the lines at their intersections still leave the whole grid", () => {
  // As the Kakuro-like grid above, but each diagonal is drawn over the lines
  // and runs corner to corner, so the border band and the corner triangles
  // become separate pieces of ink and the interior is a sub-grid of its own.
  const n = 640, rows = 10, cols = 12, cell = 36, g0 = 60, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 246);
  const black = (r, c) => r === 0 || c === 0 || (r * 7 + c * 3) % 5 === 0 || (r === 4 && c >= 5 && c <= 7);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (black(r, c))
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) px(g0 + c * cell + x, g0 + r * cell + y, 22);
  for (let k = 0; k <= cols; k++) for (let t = g0; t <= g0 + rows * cell; t++) px(g0 + k * cell, t, 22);
  for (let k = 0; k <= rows; k++) for (let t = g0; t <= g0 + cols * cell; t++) px(t, g0 + k * cell, 22);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (black(r, c))
    for (let d = 0; d <= cell; d++) { px(g0 + c * cell + d, g0 + r * cell + d, 246); px(g0 + c * cell + d + 1, g0 + r * cell + d, 246); }
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, rows); assert.equal(found.cols, cols);
  const truth = [[g0, g0], [g0 + cols * cell, g0], [g0 + cols * cell, g0 + rows * cell], [g0, g0 + rows * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("a light-on-dark screen grid is found", () => {
  // A dark-theme app: background 28, thin cell lines 150, box lines 230,
  // light digits in a third of the cells, a lighter toolbar band below.
  const n = 640, cell = 60, g0 = 50, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 28);
  for (let k = 0; k <= 9; k++) for (let t = g0; t <= g0 + 9 * cell; t++) {
    const v = k % 3 === 0 ? 230 : 150, thick = k % 3 === 0 ? 3 : 1;
    for (let d = 0; d < thick; d++) { px(g0 + k * cell + d, t, v); px(t, g0 + k * cell + d, v); }
  }
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if ((r * 4 + c * 7) % 3 === 0)
    for (let y = 18; y < 42; y++) for (let x = 24; x < 36; x++) if (x < 27 || x > 32 || y < 22 || y > 38) px(g0 + c * cell + x, g0 + r * cell + y, 220);
  for (let y = g0 + 9 * cell + 20; y < g0 + 9 * cell + 40; y++) for (let x = g0; x < g0 + 9 * cell; x++) px(x, y, 70);
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 9); assert.equal(found.cols, 9);
  const truth = [[g0, g0], [g0 + 9 * cell, g0], [g0 + 9 * cell, g0 + 9 * cell], [g0, g0 + 9 * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("a grid joined to a toolbar below it is found without the toolbar", () => {
  // 9 x 9 grid of 50 px cells; a 75 px toolbar box hangs from the bottom
  // border with irregular dividers, so the component's quad is too tall.
  const n = 640, cell = 50, g0 = 60, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 246);
  for (let k = 0; k <= 9; k++) for (let t = g0; t <= g0 + 9 * cell; t++) { px(g0 + k * cell, t, 30); px(t, g0 + k * cell, 30); if (k % 3 === 0) { px(g0 + k * cell + 1, t, 30); px(t, g0 + k * cell + 1, 30); } }
  const bottom = g0 + 9 * cell + 75;
  for (let t = g0; t <= g0 + 9 * cell; t++) px(t, bottom, 30);
  for (let t = g0 + 9 * cell; t <= bottom; t++) { px(g0, t, 30); px(g0 + 9 * cell, t, 30); for (const x of [g0 + 70, g0 + 190, g0 + 260, g0 + 410]) px(x, t, 30); }
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if ((r * 4 + c * 7) % 3 === 0)
    for (let y = 14; y < 36; y++) for (let x = 20; x < 30; x++) if (x < 23 || x > 27 || y < 18 || y > 32) px(g0 + c * cell + x, g0 + r * cell + y, 30);
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 9); assert.equal(found.cols, 9);
  const truth = [[g0, g0], [g0 + 9 * cell, g0], [g0 + 9 * cell, g0 + 9 * cell], [g0, g0 + 9 * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("a grid whose every cell is full of pencil marks is found", () => {
  // 9 x 9 grid of 54 px cells with thin lines; every cell carries a 3 x 3
  // block of small candidate digits (short dark strokes), so columns and
  // rows of marks are as dark as the lines.
  const n = 640, cell = 54, g0 = 60, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 246);
  for (let k = 0; k <= 9; k++) for (let t = g0; t <= g0 + 9 * cell; t++) { px(g0 + k * cell, t, 40); px(t, g0 + k * cell, 40); }
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((r + c + i * 2 + j) % 4 !== 0) {
    const x0 = g0 + c * cell + 8 + j * 15, y0 = g0 + r * cell + 6 + i * 15;
    for (let y = 0; y < 10; y++) { px(x0 + 1, y0 + y, 30); px(x0 + 2, y0 + y, 30); }
    for (let x = 0; x < 7; x++) { px(x0 + x, y0, 30); px(x0 + x, y0 + 9, 30); }
  }
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 9); assert.equal(found.cols, 9);
  const truth = [[g0, g0], [g0 + 9 * cell, g0], [g0 + 9 * cell, g0 + 9 * cell], [g0, g0 + 9 * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
test("a Slitherlink grid of dots with clue digits is found", () => {
  // 10 x 10 cells of 44 px marked by 5 px dots at the lattice points, digits
  // (short strokes) in a third of the cells, a caption line below.
  const n = 640, cell = 44, g0 = 70, data = new Uint8ClampedArray(n * n * 4);
  const px = (x, y, v) => { if (x < 0 || y < 0 || x >= n || y >= n) return; const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px(x, y, 246);
  for (let r = 0; r <= 10; r++) for (let c = 0; c <= 10; c++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) px(g0 + c * cell + dx, g0 + r * cell + dy, 30);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if ((r * 3 + c * 5) % 3 === 0) {
    const x0 = g0 + c * cell + 17, y0 = g0 + r * cell + 12;
    for (let y = 0; y < 20; y++) { px(x0 + 4, y0 + y, 30); px(x0 + 5, y0 + y, 30); }
    if ((r + c) % 2) for (let x = 0; x < 10; x++) { px(x0 + x, y0, 30); px(x0 + x, y0 + 19, 30); }
  }
  for (let x = g0; x < g0 + 10 * cell; x += 3) for (let y = g0 + 10 * cell + 30; y < g0 + 10 * cell + 38; y++) if ((x / 3) % 5 !== 0) px(x, y, 30);
  const found = findGrid({ width: n, height: n, data });
  assert.equal(found.rows, 10); assert.equal(found.cols, 10);
  const truth = [[g0, g0], [g0 + 10 * cell, g0], [g0 + 10 * cell, g0 + 10 * cell], [g0, g0 + 10 * cell]];
  assert.ok(found.corners.every((c, i) => Math.abs(c.x - truth[i][0]) <= 6 && Math.abs(c.y - truth[i][1]) <= 6), JSON.stringify(found.corners));
});
function blankWarp() {
  const n = 540, data = new Uint8ClampedArray(n * n * 4).fill(250);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: n, height: n, data };
}
test("the estimate crosses the worker boundary", () => {
  // The warp's metadata is posted from the geometry worker to the page, so
  // every part of it must be structured-cloneable; a function in the line
  // data broke every photo read and every live read once.
  for (const estimate of [estimateGrid(warp()), estimateGrid(warp({ thin: 210, dense: true })), estimateGrid(blankWarp())])
    assert.doesNotThrow(() => structuredClone(estimate), JSON.stringify(Object.keys(estimate)));
});
test("a blank warp has no grid", () => {
  const n = 540, data = new Uint8ClampedArray(n * n * 4).fill(250);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const grid = estimateGrid({ width: n, height: n, data });
  assert.equal(grid.rows, 0); assert.equal(grid.cols, 0);
});
