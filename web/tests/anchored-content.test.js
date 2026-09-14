import test from "node:test";
import assert from "node:assert/strict";
import { gridContent, sameGridContent } from "../live-content.js";

// One cell, 100 x 100: a print whose region median sits exactly between its
// dark and light halves, so an independent per-frame polarity choice could
// flip under one level of noise. The comparison anchors polarity and contrast
// to the reference, so this must always read as the same print.
const corners = [{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}];
function image(paint) {
  const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = paint(x, y), i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v)); data[i + 3] = 255;
  }
  return { width, height, data };
}
const halves = (x, y, noise = 0) => (x < 50 ? 70 : 210) + noise * ((x * 7 + y * 13) % 3 - 1);

test("a print at the polarity margin does not invert under one level of noise", () => {
  const a = gridContent(image((x, y) => halves(x, y)), corners, 1, 1);
  const b = gridContent(image((x, y) => halves(x, y, 1)), corners, 1, 1);
  assert.equal(sameGridContent(a, b), true);
  assert.equal(sameGridContent(b, a), true);
});
test("a uniform brightness change is the same print; an inverted print is not", () => {
  const a = gridContent(image((x, y) => halves(x, y)), corners, 1, 1);
  assert.equal(sameGridContent(a, gridContent(image((x, y) => halves(x, y) * .94), corners, 1, 1)), true);
  assert.equal(sameGridContent(a, gridContent(image((x, y) => 280 - halves(x, y)), corners, 1, 1)), false);
});
test("signatures store raw area averages, so paper is bright and ink is dark", () => {
  const s = gridContent(image((x, y) => (x > 40 && x < 60 && y > 30 && y < 70 ? 30 : 240)), corners, 1, 1);
  const values = [...s.pixels];
  assert.ok(Math.max(...values) >= 235 && Math.min(...values) <= 40);
});
