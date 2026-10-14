import test from "node:test";
import assert from "node:assert/strict";
import { findGrid, relocation, confirms, settle, warp } from "../geometry.js";
import { prepareScan } from "../scan-analysis.js";

// A 9 x 9 newspaper grid (60 px cells, 6 px border, 4 px box lines, 2 px cell
// lines) at (160, 90), with a band of halftone grey printed `gap` pixels left
// of its border, as beside the sideways page of wichtounet image1024. Its
// glyphs lie on their side, as on that page: a bar with a short foot.
const X = 160, Y = 90, CELL = 60, BORDER = X + 2.5;
function bandBoard({ gap = 8, light = 100, band = 22, blob = false, glyphs = [], pencil = false } = {}) {
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
  // Pencil marks: a 3 x 3 block of small candidate digits in every cell, so
  // columns and rows of marks are as dark as the cell lines.
  if (pencil) for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((r + c + i * 2 + j) % 4 !== 0) {
    const x0 = X + c * CELL + 10 + j * 16, y0 = Y + r * CELL + 8 + i * 16;
    for (let y = 0; y < 11; y++) { set(x0 + 1, y0 + y, 30); set(x0 + 2, y0 + y, 30); }
    for (let x = 0; x < 8; x++) { set(x0 + x, y0, 30); set(x0 + x, y0 + 10, 30); }
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

// The pure tests' frame again, for the boundaries of relocation() and
// confirms(): a 541-pixel warp of [90, 630]^2 (warp coordinate u is image
// coordinate 90 + u) around a tightened quad of 520 / 9 = 57.8 px cells.
const FRAME = [{ x: 90, y: 90 }, { x: 630, y: 90 }, { x: 630, y: 630 }, { x: 90, y: 630 }],
  TIGHT = [{ x: 100, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 620 }, { x: 100, y: 620 }],
  seen = ({ left = 100, top = 100, right = 620, bottom = 620, rows = 9, cols = 9 } = {}) =>
    ({ rows, cols, partial: false, extent: { x: [left - 90, right - 90], y: [top - 90, bottom - 90] } }),
  box = (left, top, right, bottom) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];

test("a disagreement along the top edge is measured like one along the left edge", () => {
  assert.ok(relocation(TIGHT, FRAME, seen({ top: 112 }), 541, 760, 720), "12 px down is two tenths of a cell");
  assert.equal(confirms(seen(), seen({ top: 112 }), FRAME, 541, box(100, 112, 620, 620)), false, "a third warp back on the first warp's top line");
});

test("the tenth of a cell: just over it relocates, exactly it does not, and it is measured on the tightened quad", () => {
  assert.ok(relocation(TIGHT, FRAME, seen({ left: 107 }), 541, 760, 720), "7 px is 0.12 of a cell");
  assert.equal(confirms(seen(), seen({ left: 107 }), FRAME, 541, box(107, 100, 620, 620)), false, "and too far back to confirm");
  // 5.75 px is under a tenth of the tightened quad's 57.8 px cell (5.78), and
  // would be over a tenth of the placement's 57.1 px cell (5.71).
  assert.equal(relocation(TIGHT, FRAME, seen({ left: 105.75 }), 541, 760, 720), null);
  // A 1025-pixel warp of [0, 1024]^2 maps warp coordinates to the image's
  // exactly, and a quad of 50 px cells has a tenth of exactly 5 px.
  const exact = box(0, 0, 1024, 1024), square = box(100, 100, 550, 550),
    lattice = (left) => ({ rows: 9, cols: 9, partial: false, extent: { x: [left, 550], y: [100, 550] } });
  assert.equal(relocation(square, exact, lattice(105), 1025, 1100, 1100), null, "a tenth of a cell keeps the quad");
  assert.ok(relocation(square, exact, lattice(106), 1025, 1100, 1100), "more than a tenth relocates");
  assert.equal(confirms(lattice(105), lattice(100), exact, 1025, square), true, "a third warp a tenth of a cell off confirms");
  assert.equal(confirms(lattice(106), lattice(100), exact, 1025, square), false, "one more than a tenth off does not");
});

test("a rectangular grid measures each side of its cells by that side's own count", () => {
  // 18 columns of 28.9 px and 9 rows of 27.8 px (a 2:1 frame [90, 630] x
  // [90, 360]): a tenth of a cell is 2.78 px.
  const wide = box(90, 90, 630, 360), quad = box(100, 100, 620, 350),
    across = (left) => ({ rows: 9, cols: 18, partial: false, extent: { x: [left - 90, 530], y: [20, 520] } });
  assert.equal(relocation(quad, wide, across(102), 541, 760, 720), null, "2 px is under a tenth of a cell");
  assert.ok(relocation(quad, wide, across(104), 541, 760, 720), "4 px is over it");
  // 9 columns of 57.8 px and 18 rows of 14.4 px: a tenth is 1.44 px.
  const flat = box(100, 100, 620, 360),
    down = (left) => ({ rows: 18, cols: 9, partial: false, extent: { x: [left - 90, 530], y: [10, 270] } });
  assert.ok(relocation(flat, FRAME, down(102), 541, 760, 720), "2 px is over a tenth of a 14.4 px row");
  assert.equal(relocation(flat, FRAME, down(101), 541, 760, 720), null, "1 px is under it");
  // A square quad: the narrower cell sets the tenth, columns as well as rows.
  assert.ok(relocation(TIGHT, FRAME, seen({ left: 105, cols: 18 }), 541, 760, 720), "5 px is a sixth of an 18-column cell");
});

test("the margin check reads the image's width along x and its height along y", () => {
  // A landscape image 700 x 640; the placement's padded warp reaches past
  // x = 640, inside the image's 700 px width.
  const frame = box(150, 50, 690, 590), tight = box(160, 60, 680, 580),
    found = { rows: 9, cols: 9, partial: false, extent: { x: [22, 520], y: [10, 530] } };
  const placed = relocation(tight, frame, found, 541, 700, 640);
  assert.ok(placed, "the padded placement fits a 700 x 640 image");
  assert.ok(Math.max(...placed.map((p) => p.x)) > 645, "and reaches past x = 640");
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

test("a band printed above the top border: the still photograph's top edge lands on the border", () => {
  // The band board transposed, as image1004's line above its top border.
  const { width, height, data } = bandBoard(), turned = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    for (let c = 0; c < 4; c++) turned[4 * (x * height + y) + c] = data[4 * (y * width + x) + c];
  const image = { width: height, height: width, data: turned };
  const photo = findGrid(image), live = findGrid(image, { thorough: false }),
    top = (found) => (found.corners[0].y + found.corners[1].y) / 2;
  assert.equal(photo.rows, 9); assert.equal(photo.cols, 9);
  assert.ok(BORDER - top(live) > 0.15 * CELL, `live quad's top edge ${top(live)} on the band`);
  assert.ok(Math.abs(top(photo) - BORDER) < 1.5, `photo quad's top edge ${top(photo)} on the border at ${BORDER}`);
});

test("a relocated reading carries the third warp's lattice, which lies on the corners it returns", () => {
  // settle() from the band board's outline, the extreme points of the grid's
  // ink, as findGrid() settles it.
  const outline = [{ x: X, y: Y }, { x: X + 9 * CELL + 5, y: Y }, { x: X + 9 * CELL + 5, y: Y + 9 * CELL + 5 }, { x: X, y: Y + 9 * CELL + 5 }];
  const settled = settle(bandBoard(), outline);
  assert.ok(Math.abs(left(settled) - BORDER) < 1.5, `relocated left edge ${left(settled)} on the border`);
  // The third warp was read in the placement pushed out by 4% from its centre:
  // its lattice's outer lines, mapped back, are the corners. The second warp's
  // lattice, read around the band, would lie a fifth of a cell off them.
  const cx = settled.corners.reduce((sum, p) => sum + p.x, 0) / 4, cy = settled.corners.reduce((sum, p) => sum + p.y, 0) / 4,
    frame = settled.corners.map((p) => ({ x: p.x + (p.x - cx) * 0.04, y: p.y + (p.y - cy) * 0.04 }));
  assert.equal(confirms(settled.estimated, settled.estimated, frame, 540, settled.corners), true);
});

test("cells crowded with pencil marks: the third warp also reads the lattice from continuous runs", () => {
  // Only the continuous-run profile, which a still photograph's warps fall
  // back on, reads this lattice: the ink profile alone finds none.
  const image = bandBoard({ pencil: true, gap: 10 });
  const photo = findGrid(image), live = findGrid(image, { thorough: false });
  assert.equal(live.rows * live.cols, 0, "no lattice from the ink profile alone");
  assert.equal(photo.rows, 9); assert.equal(photo.cols, 9);
  assert.ok(Math.abs(left(photo) - BORDER) < 1.5, `photo quad's left edge ${left(photo)} on the border at ${BORDER}`);
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
