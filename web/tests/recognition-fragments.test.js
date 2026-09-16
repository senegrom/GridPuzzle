import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";
import { applyDigitVotes, digitSamples, puzzleFromReadings } from "../scanner.js";

function specimen(pieces, { black = false, leading = false } = {}) {
  const width = 300, height = 300;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x, y, w, h, value) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const at = 4 * (yy * width + xx);
      data[at] = data[at + 1] = data[at + 2] = value;
    }
  };
  if (black) paint(0, 0, 100, 100, 10);
  if (leading) paint(27, 28, 5, 44, black ? 245 : 10);
  for (const [x, y, w, h] of pieces) paint(x, y, w, h, black ? 245 : 10);
  return prepareScan({ width, height, data }, black ? "str8ts" : "numbrix", 3, 3);
}

for (const black of [false, true]) {
  for (const [name, pieces] of [
    ["short cap above tall body", [[49, 28, 8, 9], [49, 41, 8, 31]]],
    ["short foot below tall body", [[49, 28, 8, 31], [49, 63, 8, 9]]],
    ["three ink fragments", [[49, 28, 8, 9], [49, 43, 8, 13], [49, 62, 8, 10]]],
  ]) {
    test(`${name} retains the complete ${black ? "inverted" : "normal"} crop`, () => {
      const prepared = specimen(pieces, { black });
      const entry = prepared.entries.find((e) => e.cell === 0);
      assert.ok(entry);
      assert.equal(entry.y, 28);
      assert.equal(entry.h, 44);
      assert.equal(entry.recoveredMark, true);
      entry.text = "1";
      entry.confidence = 99;
      applyDigitVotes([entry], [
        { index: 0, kind: "binary", text: "1", confidence: 99 },
        { index: 0, kind: "gray", text: "1", confidence: 99 },
      ]);
      assert.equal(entry.confidence, 0);
      const proposal = puzzleFromReadings(prepared, black ? "str8ts" : "numbrix", 3, 3);
      assert.ok(proposal.markedCells.includes(0));
      assert.ok(proposal.uncertain.includes(0));
    });
  }
}

test("a tall trailing digit retains its short cap beside a separate leading digit", () => {
  const entry = specimen([[49, 28, 8, 9], [49, 41, 8, 31]], { leading: true }).entries[0];
  assert.equal(entry.x, 27);
  assert.equal(entry.w, 30);
  assert.equal(entry.y, 28);
  assert.equal(entry.h, 44);
  assert.equal(entry.recoveredMark, true);
});

test("two narrow intact glyphs are counted separately without requiring recovery", () => {
  const entry = specimen([[46, 28, 4, 44], [56, 28, 4, 44]]).entries[0];
  assert.equal(entry.glyphCount, 2);
  assert.equal(entry.recoveredMark, undefined);
  assert.ok((entry.w + 10) / (entry.h + 10) < 0.85);
});

test("fragment pieces count as one glyph, not as extra digits", () => {
  const pieces = [[49, 28, 8, 9], [49, 43, 8, 13], [49, 62, 8, 10]];
  assert.equal(specimen(pieces).entries[0].glyphCount, undefined);
  assert.equal(specimen(pieces, { leading: true }).entries[0].glyphCount, 2);
});

for (const black of [false, true]) {
  test(`speckle beside a ${black ? "white" : "dark"} intact glyph does not trigger recovery`, () => {
    const entry = specimen([[49, 28, 8, 44], [63, 24, 2, 2], [29, 62, 3, 3]], { black }).entries[0];
    assert.equal(entry.recoveredMark, undefined);
    assert.equal(entry.glyphCount, undefined);
    assert.equal(entry.x, 49);
    assert.equal(entry.w, 8);
  });
}

test("a remote short mark does not get attached to an intact digit", () => {
  const entry = specimen([[49, 25, 8, 25], [49, 72, 8, 9]]).entries[0];
  assert.equal(entry.recoveredMark, undefined);
  assert.equal(entry.h, 25);
});


test("narrow multi-glyph crops use line mode without increasing the sample budget", (t) => {
  const original = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = { toDataURL: () => "sample" };
    canvas.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, fillRect() {}, drawImage() {},
    });
    return canvas;
  } };
  t.after(() => {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  const entries = [
    { cell: 0, x: 40, y: 28, w: 14, h: 44, glyphCount: 2 },
    { cell: 1, x: 140, y: 28, w: 14, h: 44 },
  ];
  const samples = digitSamples(entries,
    new Map([[0, { width: 24, height: 54 }], [1, { width: 24, height: 54 }]]),
    new Uint8Array(20000).fill(255), 200, 100, 100, 100, 2);
  assert.deepEqual(samples.map(({ index, kind, psm }) => [index, kind, psm]), [
    [0, "binary", "7"], [0, "gray", "7"],
    [1, "binary", "10"], [1, "gray", "10"],
  ]);
});
