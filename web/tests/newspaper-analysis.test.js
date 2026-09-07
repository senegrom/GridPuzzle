import test from "node:test";
import assert from "node:assert/strict";
import { detectBlackCells, prepareScan } from "../scan-analysis.js";

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

test("dim white-on-black newspaper digits still produce a Str8ts OCR region", () => {
  const width = 90, height = 90,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 30; y < 60; y++)
    for (let x = 30; x < 60; x++) {
      const at = 4 * (y * width + x);
      data[at] = data[at + 1] = data[at + 2] = 25;
    }
  for (let y = 37; y < 54; y++)
    for (let x = 42; x < 48; x++) {
      const at = 4 * (y * width + x);
      data[at] = data[at + 1] = data[at + 2] = 150;
    }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const result = prepareScan({ width, height, data }, "str8ts", 3, 3);
  assert.equal(result.black[4], true);
  assert.ok(result.entries.some((e) => e.kind === "blackvalue" && e.cell === 4));
});
