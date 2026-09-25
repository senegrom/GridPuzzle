import test from "node:test";
import assert from "node:assert/strict";
import { prepareScan } from "../scan-analysis.js";
import { applyDigitVotes, puzzleFromReadings } from "../scanner.js";
import { overlayCells, previewBlocker } from "../live-overlay.js";

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
    assert.notEqual(previewBlocker(found), null);
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

function paper(level = 220, control = "digit") {
  const width = 300, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 255;
    if (control === "gradient") v = Math.round(180 + 70 * x / width);
    if (control === "noise") v = 250 + (x * 17 + y * 23) % 6;
    if (control === "shade" && x < 100 && y < 100) v = 205;
    if (control === "edge" && x < 51 && y < 100) v = 230;
    if (x % 100 < 2 || y % 100 < 2) v = 0;
    if (control === "digit" && x >= 38 && x < 62 && y >= 30 && y < 68 &&
      (x < 44 || y < 36 || y > 60 || (y > 46 && x > 55))) v = level;
    if (control === "fragments" && x >= 47 && x < 54 && ((y >= 32 && y < 40) || (y >= 53 && y < 61))) v = level;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { width, height, data };
}

function transcription(prep) { return puzzleFromReadings({ ...prep, width: 300, height: 300 }, "latinsquare", 3, 3); }

for (const level of [215, 220, 230, 235]) test(`a faint white-cell clue at gray ${level} remains printed evidence`, () => {
  const prep = prepareScan(paper(level), "latinsquare", 3, 3), e = prep.entries.find((entry) => entry.cell === 0);
  assert.ok(e, "the clue must reach OCR"); assert.equal(e.recoveredMark, true);
  let found = transcription(prep);
  assert.ok(found.markedCells.includes(0)); assert.ok(found.cellUncertain.includes(0));
  assert.notEqual(previewBlocker(found), null);
  const solution = { status: "unique", complete: true, solutions: [{ cells: [1,2,3,2,3,1,3,1,2] }] };
  assert.equal(overlayCells(found, solution).find((cell) => cell.cell === 0).kind, "unknown");
  e.text = "1"; e.confidence = 99; found = transcription(prep);
  assert.ok(found.cellUncertain.includes(0), "recovered geometry keeps review independently of OCR confidence");
  assert.equal(overlayCells(found, solution).find((cell) => cell.cell === 0).kind, "uncertain");
});

for (const control of ["blank", "gradient", "noise", "shade", "edge"]) test(`${control} paper is not a faint printed mark`, () => {
  const prep = prepareScan(paper(220, control), "latinsquare", 3, 3);
  assert.equal(prep.entries.length, 0); assert.deepEqual(prep.unreadCells ?? [], []);
});

test("plausible faint fragments remain unknown even without an OCR-sized glyph", () => {
  const prep = prepareScan(paper(220, "fragments"), "latinsquare", 3, 3);
  assert.deepEqual(prep.unreadCells, [0]); assert.equal(prep.entries.length, 0);
  const found = transcription(prep);
  assert.deepEqual(found.markedCells, [0]); assert.deepEqual(found.cellUncertain, [0]);
  assert.notEqual(previewBlocker(found), null);
});

test("number crops retain two and three separate glyphs while excluding speckles", () => {
  for (const glyphs of [[124, 157], [124, 145, 166]]) {
    const width = 300, height = 300,
      data = new Uint8ClampedArray(width * height * 4).fill(255);
    const ink = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          const at = 4 * (yy * width + xx);
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
    };
    glyphs.forEach((x, i) => ink(x, 125, i === 0 ? 5 : 9, 35));
    ink(116, 117, 2, 2);
    ink(180, 182, 3, 3);
    const { entries } = prepareScan({ width, height, data }, "numbrix", 3, 3),
      clue = entries.find((e) => e.cell === 4 && e.kind === "value");
    assert.ok(clue);
    assert.equal(clue.x, glyphs[0]);
    assert.equal(clue.x + clue.w, glyphs.at(-1) + 9);
    assert.equal(clue.y, 125);
    assert.equal(clue.h, 35);
  }
});
