import test from "node:test";
import assert from "node:assert/strict";
import { gridContent, sameGridContent } from "../live-content.js";

function signature(level = 25, flipped = false, erased = false) {
  const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
  const s = gridContent({ width: 100, height: 100, data },
    [{x:0,y:0},{x:99,y:0},{x:99,y:99},{x:0,y:99}], 1, 1);
  if (!erased) for (let y = 6; y <= 17; y++) {
    const x = (flipped ? 17 : 6) + (flipped ? -1 : 1) * Math.abs(y - 12);
    for (let dx = 0; dx < 2; dx++) s.structure[y * 24 + x + dx] = level;
  }
  return s;
}
for (const level of [20, 30, 50, 100]) test(`weak structural strokes at contrast ${level} cannot use the old 64-level shortcut`, () => {
  const a = signature(level);
  assert.equal(sameGridContent(a, signature(level, true)), false);
  assert.equal(sameGridContent(a, signature(level, false, true)), false);
  assert.equal(sameGridContent(a, signature(level)), true);
  assert.equal(sameGridContent(a, signature(Math.round(level * .94))), true);
});
test("near-noise structural samples do not cause rereading", () => {
  const a = signature(), b = signature();
  for (let i = 0; i < b.structure.length; i++) b.structure[i] += i % 3;
  assert.equal(sameGridContent(a, b), true);
});
