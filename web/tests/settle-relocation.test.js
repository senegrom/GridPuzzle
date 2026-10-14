import test from "node:test";
import assert from "node:assert/strict";
import { findGrid, relocation, confirms, warp } from "../geometry.js";
import { prepareScan } from "../scan-analysis.js";

// A 9 x 9 newspaper grid (60 px cells, 6 px border, 4 px box lines, 2 px cell
// lines) at (160, 90), with a band of halftone grey printed `gap` pixels left
// of its border, as beside the sideways page of wichtounet image1024. Its
// glyphs lie on their side, as on that page: a bar with a short foot.
const X = 160, Y = 90, CELL = 60, BORDER = X + 2.5;
function bandBoard({ gap = 8, light = 100, band = 22, blob = false, glyphs = [] } = {}) {
  const width = 760, height = 720, data = new Uint8ClampedArray(width * height * 4), size = 9 * CELL;
  const set = (x, y, v) => {
    const at = 4 * (y * width + x);
    data[at] = data[at + 1] = data[at + 2] = v; data[at + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 226);
  if (band) for (let y = Y - 40; y < Y + size + 46; y++) for (let x = X - gap - band; x < X - gap; x++)
    set(x, y, (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 60 : light);
  for (let k = 0; k <= 9; k++) {
    const w = k === 0 || k === 9 ? 6 : k % 3 ? 2 : 4, shade = k === 0 || k === 9 ? 25 : k % 3 ? 70 : 35;
    for (let t = 0; t < w; t++) for (let s = 0; s < size + 6; s++) { set(X + k * CELL + t, Y + s, shade); set(X + s, Y + k * CELL + t, shade); }
  }
  // A blot on the outside of the top-left corner pulls the outline's corner
  // out by more than a percent, so even a plain grid is settled through a
  // confirmation warp.
  if (blob) for (let y = Y - 14; y < Y; y++) for (let x = X - 14; x < X; x++) set(x, y, 30);
  for (const cell of glyphs) {
    const cx = X + (cell % 9) * CELL + 31, cy = Y + Math.floor(cell / 9) * CELL + 31;
    for (let y = cy - 3; y < cy + 4; y++) for (let x = cx - 17; x < cx + 18; x++) set(x, y, 20);
    for (let y = cy - 11; y < cy + 4; y++) for (let x = cx + 12; x < cx + 18; x++) set(x, y, 20);
  }
  return { width, height, data };
}
// The same grid on a larger page with a solid grey band `band` pixels wide
// printed `gap` pixels outside every side of the border, past the corners.
function framedBoard({ gap = 3, band = 8, shade = 40 } = {}) {
  const width = 860, height = 820, data = new Uint8ClampedArray(width * height * 4), size = 9 * CELL, reach = size + 6;
  const set = (x, y, v) => {
    const at = 4 * (y * width + x);
    data[at] = data[at + 1] = data[at + 2] = v; data[at + 3] = 255;
  };
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, shade); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, 226);
  fill(X - gap - band, Y - 40, X - gap, Y + reach + 46);
  fill(X + reach + gap, Y - 40, X + reach + gap + band, Y + reach + 46);
  fill(X - 40, Y - gap - band, X + reach + 46, Y - gap);
  fill(X - 40, Y + reach + gap, X + reach + 46, Y + reach + gap + band);
  for (let k = 0; k <= 9; k++) {
    const w = k === 0 || k === 9 ? 6 : k % 3 ? 2 : 4, shade = k === 0 || k === 9 ? 25 : k % 3 ? 70 : 35;
    for (let t = 0; t < w; t++) for (let s = 0; s < size + 6; s++) { set(X + k * CELL + t, Y + s, shade); set(X + s, Y + k * CELL + t, shade); }
  }
  return { width, height, data };
}
const left = (found) => (found.corners[0].x + found.corners[3].x) / 2;

test("a confirmation that puts the border a fifth of a cell inside the quad proposes its own placement", () => {
  // A 540 x 540 warp of the frame [90, 630]^2: warp coordinate u is image x 90 + u.
  const size = 541, frame = [{ x: 90, y: 90 }, { x: 630, y: 90 }, { x: 630, y: 630 }, { x: 90, y: 630 }],
    tight = [{ x: 100, y: 100 }, { x: 640 - 20, y: 100 }, { x: 620, y: 620 }, { x: 100, y: 620 }],
    again = (left) => ({ rows: 9, cols: 9, partial: false, extent: { x: [left - 90, 530], y: [10, 530] } });
  // Cells of 520 / 9, about 58 px: a tenth is 5.8 px.
  const placed = relocation(tight, frame, again(112), size, 760, 720);
  assert.deepEqual(placed.map((p) => [Math.round(p.x), Math.round(p.y)]), [[112, 100], [620, 100], [620, 620], [112, 620]]);
  assert.equal(relocation(tight, frame, again(105), size, 760, 720), null, "within a tenth of a cell the quad stays");
  // A rectangular grid measures the smaller cell side: 520 / 18 is under 30 px.
  assert.ok(relocation(tight, frame, { ...again(105), rows: 18 }, size, 760, 720), "5 px is a sixth of an 18-row cell");
  // The check warp needs its margin inside the image.
  assert.equal(relocation(tight, frame, again(112), size, 630, 720), null, "a padded quad past the image's edge is not checked");
});

test("a placement is confirmed only by the same whole lattice within a tenth of a cell", () => {
  const size = 541, frame = [{ x: 90, y: 90 }, { x: 630, y: 90 }, { x: 630, y: 630 }, { x: 90, y: 630 }],
    quad = [{ x: 112, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 620 }, { x: 112, y: 620 }],
    expected = { rows: 9, cols: 9, partial: false },
    found = (left, extra = {}) => ({ ...expected, extent: { x: [left - 90, 530], y: [10, 530] }, ...extra });
  assert.equal(confirms(found(114), expected, frame, size, quad), true);
  assert.equal(confirms(found(100), expected, frame, size, quad), false, "back on the first warp's line");
  assert.equal(confirms(found(114, { rows: 8 }), expected, frame, size, quad), false, "another lattice");
  assert.equal(confirms(found(114, { cols: 10 }), expected, frame, size, quad), false, "another lattice");
  assert.equal(confirms(found(114, { partial: true }), expected, frame, size, quad), false, "a partial lattice");
});

test("a placement may move the quad's edges inward only, give or take half a tenth of a cell", () => {
  // The pure tests' frame and quad: a tenth of a cell is 5.8 px, half of it 2.9.
  const size = 541, frame = [{ x: 90, y: 90 }, { x: 630, y: 90 }, { x: 630, y: 630 }, { x: 90, y: 630 }],
    tight = [{ x: 100, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 620 }, { x: 100, y: 620 }],
    lattice = ({ left = 100, top = 100, right = 620, bottom = 620 }) =>
      ({ rows: 9, cols: 9, partial: false, extent: { x: [left - 90, right - 90], y: [top - 90, bottom - 90] } }),
    placed = (edges, quad = tight) => relocation(quad, frame, lattice(edges), size, 760, 720);
  assert.ok(placed({ left: 112 }), "the left edge 12 px inward");
  assert.ok(placed({ bottom: 608 }), "the bottom edge 12 px inward");
  assert.ok(placed({ left: 112, right: 622 }), "and the right edge 2 px outward");
  for (const [edges, why] of [
    [{ left: 112, right: 624 }, "the right edge 4 px outward"],
    [{ left: 112, bottom: 624 }, "the bottom edge 4 px outward"],
    [{ left: 112, top: 96 }, "the top edge 4 px outward"],
    [{ top: 112, left: 96 }, "the left edge 4 px outward"],
    [{ right: 632 }, "the right edge 12 px outward, nothing inward"],
  ]) assert.equal(placed(edges), null, why);
  // One corner alone: the tightened quad's bottom-right corner sits 10 px
  // left of the placement's, which is outside its right edge.
  const slanted = [{ x: 100, y: 100 }, { x: 620, y: 100 }, { x: 610, y: 620 }, { x: 100, y: 620 }];
  assert.equal(placed({ left: 112 }, slanted), null, "a corner 10 px outside the quad's right edge");
});

test("a band printed beside the border: the still photograph's quad lands on the border, the live camera's is unchanged", () => {
  const image = bandBoard();
  const photo = findGrid(image), live = findGrid(image, { thorough: false });
  assert.equal(photo.confidence, 0.94); assert.equal(photo.rows, 9); assert.equal(photo.cols, 9);
  assert.ok(Math.abs(left(photo) - BORDER) < 1.5, `photo quad's left edge ${left(photo)} on the border at ${BORDER}`);
  // The live camera keeps the quad the first warp tightened: along the band.
  assert.ok(BORDER - left(live) > 0.15 * CELL, `live quad's left edge ${left(live)} on the band`);
  for (const i of [1, 2]) assert.ok(Math.abs(photo.corners[i].x - live.corners[i].x) < 1, "the right edge stays");
});

test("a placement that the third warp does not confirm is not taken", () => {
  // With the band 6 px from the border and lighter dots, the third warp, centred
  // on the border, sees the band at its edge again and puts the line there.
  const image = bandBoard({ gap: 6, light: 135 });
  const photo = findGrid(image), live = findGrid(image, { thorough: false });
  assert.ok(BORDER - left(live) > 0.15 * CELL, "the first warp took the band");
  assert.deepEqual(photo.corners, live.corners);
});

test("bands beside every side of the border: the confirmation's edges moved outward are not taken", () => {
  // The first warp merges the left and top bands into the border, so the
  // quad runs along them; the confirmation, centred on that quad, sees the
  // right and bottom bands at its own edge and merges those instead. Its
  // placement would move the right and bottom edges outward onto the bands.
  const image = framedBoard();
  const photo = findGrid(image), live = findGrid(image, { thorough: false });
  assert.equal(photo.rows, 9); assert.equal(photo.cols, 9);
  const right = (photo.corners[1].x + photo.corners[2].x) / 2, bottom = (photo.corners[2].y + photo.corners[3].y) / 2;
  assert.ok(Math.abs(right - (X + 9 * CELL + 2.5)) < 1.5, `photo quad's right edge ${right} on the border`);
  assert.ok(Math.abs(bottom - (Y + 9 * CELL + 2.5)) < 1.5, `photo quad's bottom edge ${bottom} on the border`);
  assert.deepEqual(photo.corners, live.corners);
});

test("an ordinary grid settled through a confirmation keeps exactly the quad it had", () => {
  const image = bandBoard({ band: 0, blob: true });
  const photo = findGrid(image), live = findGrid(image, { thorough: false });
  assert.ok(Math.abs(left(photo) - BORDER) < 1.5);
  assert.deepEqual(photo.corners, live.corners);
});

test("read along the band, a sideways page's lines cross its first columns and the pencil guard drops every clue", () => {
  const glyphs = [4, 13, 22, 40, 44, 58, 76], image = bandBoard({ glyphs });
  const read = (corners) => prepareScan(warp(image, corners, 900, 900), "sudoku", 9, 9),
    values = (prepared) => prepared.entries.filter((e) => e.kind === "value"),
    slivers = (prepared) => values(prepared).filter((e) => e.h >= 5 * e.w);
  const along = read(findGrid(image, { thorough: false }).corners), through = read(findGrid(image).corners);
  // Along the band, the border and the next three lines run the full height
  // of every cell window in columns 0-3. As the tallest value regions they set
  // the clue height, and the sideways glyphs, under 0.4 of it, go as notes.
  assert.equal(slivers(along).length, 36);
  assert.deepEqual([...new Set(slivers(along).map((e) => e.cell % 9))].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...along.unreadCells].sort((a, b) => a - b), glyphs);
  // On the border: the glyphs, on their side, and nothing else.
  assert.deepEqual(slivers(through), []);
  assert.deepEqual(values(through).map((e) => e.cell).sort((a, b) => a - b), glyphs);
  assert.deepEqual(through.unreadCells, []);
  assert.ok(values(through).every((e) => e.w > e.h), "the glyphs lie on their side");
});
