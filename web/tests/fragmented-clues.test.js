import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";
import { applyDigitVotes, puzzleFromReadings } from "../scanner.js";
import { overlayCells, previewAllowed } from "../live-overlay.js";

function image({ black = false, noise = false, trailing = false, connected = false } = {}) {
  const width = 300, height = 300, data = new Uint8ClampedArray(width * height * 4);
  const fill = (x, y, w, h, value) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const at = 4 * (yy * width + xx); data[at] = data[at + 1] = data[at + 2] = value; data[at + 3] = 255;
    }
  };
  fill(0, 0, width, height, 245);
  if (black) fill(0, 0, 100, 100, 10);
  const ink = black ? 245 : 10;
  if (noise) {
    for (let y = 24; y < 80; y += 12) for (let x = 24; x < 80; x += 12) fill(x, y, 3, 3, ink);
  } else {
    if (trailing) fill(27, 30, 5, 38, ink);
    fill(49, 30, 5, connected ? 38 : 14, ink);
    if (!connected) fill(49, 54, 5, 14, ink);
  }
  return { width, height, data };
}
for (const black of [false, true]) {
  test(`fragmented ${black ? "white-on-black" : "dark-on-paper"} clues remain printed evidence`, () => {
    const prepared = prepareScan(image({ black }), black ? "str8ts" : "latinsquare", 3, 3);
    const entry = prepared.entries.find((item) => item.cell === 0);
    assert.ok(entry, "a split clue must not disappear into a supposedly blank answer cell");
    assert.equal(entry.recoveredMark, true);
    assert.equal(entry.y, 30); assert.equal(entry.h, 38);
    const found = puzzleFromReadings(prepared, black ? "str8ts" : "latinsquare", 3, 3);
    assert.ok(found.markedCells.includes(0));
    assert.equal(overlayCells(found).find((item) => item.cell === 0).kind, "unknown");
    assert.equal(previewAllowed(found), false);
    entry.text = "1"; entry.confidence = 99;
    applyDigitVotes([entry], [{ index: 0, kind: "binary", text: "1", confidence: 99 }, { index: 0, kind: "gray", text: "1", confidence: 99 }]);
    assert.equal(entry.confidence, 0, "recovered geometry always needs review");
  });
}
test("a fragmented trailing digit is not cropped off a multidigit clue", () => {
  const entry = prepareScan(image({ trailing: true }), "numbrix", 3, 3).entries.find((item) => item.cell === 0);
  assert.equal(entry.x, 27); assert.equal(entry.w, 27); assert.equal(entry.recoveredMark, true);
});
for (const black of [false, true]) {
  test(`small ${black ? "bright" : "dark"} speckles do not become grouped clues`, () => {
    const prepared = prepareScan(image({ black, noise: true }), black ? "str8ts" : "latinsquare", 3, 3);
    assert.equal(prepared.entries.length, 0);
  });
}
test("normal connected digits keep their original bounds and confidence policy", () => {
  const entry = prepareScan(image({ connected: true }), "latinsquare", 3, 3).entries[0];
  assert.equal(entry.h, 38); assert.equal(entry.w, 5); assert.equal(entry.recoveredMark, undefined);
});
