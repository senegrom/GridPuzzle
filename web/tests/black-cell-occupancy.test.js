import test from "node:test";
import assert from "node:assert/strict";
import { detectBlackCells, normalizeScanContrast } from "../scan-analysis.js";

function shadedBoard(fade = 1) {
  const width = 300, height = 300, gray = new Uint8Array(width * height).fill(200);
  const fill = (x, y, w, h, value) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) gray[yy * width + xx] = value;
  };
  // A dark printed digit lowers this shaded cell's mean below the cutoff,
  // but most of the cell is paper, not structural black ink.
  fill(100, 100, 100, 100, 100);
  fill(140, 125, 20, 50, 0);
  // A real black cell can still contain a light printed digit.
  fill(200, 200, 100, 100, 50);
  fill(240, 225, 20, 50, 190);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(255 - (255 - gray[i]) * fade);
  return { gray, width, height };
}

for (const fade of [1, 0.65, 0.35]) {
  test(`black occupancy distinguishes a shaded numbered cell at contrast ${fade}`, () => {
    const { gray, width, height } = shadedBoard(fade);
    const normalized = normalizeScanContrast(gray);
    const black = detectBlackCells(normalized.gray, width, height, 3, 3);
    assert.equal(black[4], false, "a low mean alone is not solid black evidence");
    assert.equal(black[8], true, "retain the numbered solid black cell");
    assert.deepEqual(black.flatMap((value, i) => value ? [i] : []), [8]);
  });
}
