import test from "node:test";
import assert from "node:assert/strict";
import {
  makePuzzle,
  checkShape,
  conflicts,
  demo,
  TYPES,
  classify,
} from "../model.js";
import {
  homography,
  project,
  warp,
  validQuad,
  threshold,
  findGrid,
  estimateGrid,
} from "../geometry.js";

test("All family demos have bounded, valid row-major shapes", () => {
  for (const type of Object.keys(TYPES)) {
    const p = demo(type);
    assert.equal(checkShape(p), p);
    assert.equal(p.cells.length, p.rows * p.cols);
  }
});
test("Zero is preserved only for Slitherlink", () => {
  const p = makePuzzle("slitherlink", 1);
  p.cells = [0];
  assert.equal(checkShape(p).cells[0], 0);
  p.type = "sudoku";
  assert.throws(() => checkShape(p));
});
test("Bad input is rejected before rendering", () => {
  for (const p of [
    null,
    {},
    { ...makePuzzle(), type: "bad" },
    { ...demo(), rows: 26 },
    { ...demo(), cells: [true] },
    { ...demo(), extra: "ignored" },
  ])
    assert.throws(() => checkShape(p));
});
test("Duplicate clues mark BOTH cells", () => {
  const p = makePuzzle("sudoku", 4);
  p.cells[0] = p.cells[1] = 2;
  assert.deepEqual([...conflicts(p)].sort(), [0, 1]);
});
test("Ambiguous path rules require confirmation", () => {
  const a = classify({ rows: 5, cols: 5, values: [1, 25] });
  assert.equal(a.type, "numbrix");
  assert.equal(a.review, true);
});
test("Visible inequalities are not treated as Sudoku", () => {
  assert.equal(classify({ rows: 5, cols: 5, signs: 3 }).type, "futoshiki");
});
test("Projective corner correspondence and affine identity", () => {
  const q = [
      { x: 2, y: 3 },
      { x: 97, y: 8 },
      { x: 89, y: 94 },
      { x: 9, y: 82 },
    ],
    m = homography(q);
  for (const [i, [u, v]] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].entries()) {
    const p = project(m, u, v);
    assert.ok(Math.abs(p.x - q[i].x) < 1e-7);
    assert.ok(Math.abs(p.y - q[i].y) < 1e-7);
  }
  assert.equal(validQuad(q, 100, 100), true);
  assert.equal(validQuad([q[0], q[2], q[1], q[3]], 100, 100), false);
});
function image(w, h, value = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}
test("Uniform white has no false ink or confident grid", () => {
  const a = image(120, 120);
  assert.equal(
    threshold(a).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(findGrid(a).confidence, 0);
});
test("Warp preserves orientation", () => {
  const a = image(40, 40);
  for (let i = 0; i < 40 * 40; i++) {
    a.data[4 * i] = i % 40;
    a.data[4 * i + 1] = Math.floor(i / 40);
  }
  const out = warp(
    a,
    [
      { x: 0, y: 0 },
      { x: 39, y: 0 },
      { x: 39, y: 39 },
      { x: 0, y: 39 },
    ],
    40,
    40,
  );
  assert.deepEqual(out.data, a.data);
});
test("Synthetic connected 9x9 grid is detected", () => {
  const a = image(420, 420);
  for (let y = 20; y <= 398; y++)
    for (let x = 20; x <= 398; x++) {
      const vx = (x - 20) % 42,
        vy = (y - 20) % 42;
      if (vx < 2 || vy < 2) {
        const i = (y * 420 + x) * 4;
        a.data[i] = a.data[i + 1] = a.data[i + 2] = 0;
      }
    }
  const found = findGrid(a);
  assert.ok(found.confidence > 0.8);
  assert.equal(found.rows, 9);
  assert.equal(found.cols, 9);
});

test("Construction validates type before allocating", () =>
  assert.throws(() => makePuzzle("bad")));


test("Str8ts black cells can be blank or numbered", () => {
  const p = makePuzzle("str8ts", 3);
  p.black = [4]; p.cells[4] = 3; assert.equal(checkShape(p), p);
  p.cells[4] = "#"; assert.equal(checkShape(p), p);
  assert.equal(classify({rows:9,cols:9,values:[9,1,4],black:12,blackNumbers:2,triangles:0,boxes:false}).type, "str8ts");
});
