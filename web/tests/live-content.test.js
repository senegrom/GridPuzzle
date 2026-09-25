// live-content.js: printed-content comparison for the live camera, including
// changed, erased and white-on-black clues and incompatible signatures.
import assert from "node:assert/strict";
import test from "node:test";
import { gridContent, sameGridContent } from "../live-content.js";

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

const corners = [{x:0,y:0},{x:299,y:0},{x:299,y:299},{x:0,y:299}];

test("cell content rejects changed and erased clues but tolerates small uniform illumination changes", () => {
  const a = paper(0), b = paper(0), base = gridContent(a, corners, 3, 3);
  // Change just one clue into a narrow vertical glyph; all other cells match.
  for (let y = 30; y < 68; y++) for (let x = 38; x < 62; x++) for (let c = 0; c < 3; c++)
    b.data[(y*300+x)*4+c] = x >= 48 && x < 54 ? 0 : 255;
  assert.equal(sameGridContent(base, gridContent(b, corners, 3, 3)), false);
  assert.equal(sameGridContent(base, gridContent(paper(0,"blank"), corners, 3, 3)), false);
  for (let i = 0; i < a.data.length; i += 4) for (let c=0;c<3;c++) a.data[i+c] = Math.round(a.data[i+c]*.92);
  assert.equal(sameGridContent(base, gridContent(a, corners, 3, 3)), true);
});

test("missing or incompatible cell signatures cannot certify content", () => {
  const a = gridContent(paper(), corners, 3, 3);
  for (const other of [null, {}, {...a, rows:4}, {...a, pixels:new Uint8Array(1)}]) assert.equal(sameGridContent(a, other), false);
});

for (const fade of [1, .35]) test(`changed and erased white-on-black clues remain visible at contrast ${fade}`, () => {
  const invert = (img) => {
    for (let i = 0; i < img.data.length; i += 4)
      for (let c = 0; c < 3; c++) img.data[i+c] = Math.round(255 - fade * img.data[i+c]);
    return img;
  };
  const a = invert(paper(0)), b = paper(0);
  for (let y = 30; y < 68; y++) for (let x = 38; x < 62; x++) for (let c = 0; c < 3; c++)
    b.data[(y*300+x)*4+c] = x >= 48 && x < 54 ? 0 : 255;
  const reference = gridContent(a, corners, 3, 3);
  assert.equal(sameGridContent(reference, gridContent(invert(b), corners, 3, 3)), false);
  assert.equal(sameGridContent(reference, gridContent(invert(paper(0,"blank")), corners, 3, 3)), false);
  assert.equal(sameGridContent(reference, gridContent(a, corners, 3, 3)), true);
});
