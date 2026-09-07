import test from "node:test";
import assert from "node:assert/strict";
import { detectBlackCells } from "../scan-analysis.js";

function grayscale(cells, n = 3, size = 30) {
  const width = n * size,
    height = n * size,
    g = new Uint8Array(width * height);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      for (let y = r * size; y < (r + 1) * size; y++)
        for (let x = c * size; x < (c + 1) * size; x++)
          g[y * width + x] = cells[r * n + c];
  return { g, width, height };
}

test("solid black cells survive while halftone/shadow-level grey does not", () => {
  const { g, width, height } = grayscale([
    220, 215, 205,
    190, 115, 185,
    175, 40, 180,
  ]);
  assert.deepEqual(
    detectBlackCells(g, width, height, 3, 3),
    [false, false, false, false, false, false, false, true, false],
  );
});
