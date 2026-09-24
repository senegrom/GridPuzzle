import test from 'node:test';
import assert from 'node:assert/strict';
import { gridQuality, qualityMessage } from '../scan-quality.js';
import { refineCellBounds, numericCropBounds } from '../cell-boundaries.js';
import { prepareScan } from '../scan-analysis.js';
import { applyDigitVotes, puzzleFromReadings } from '../scanner.js';
import { detailPlan, turnPoint, retainPhotoSource, rotatePhotoSource, photoDetail, DETAIL_PIXEL_LIMIT } from '../photo-detail.js';
const quad = (w, h) => [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
function raster(w = 400, h = 400) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const paint = (x, y, rw, rh, value = 0) => {
    for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++)
        for (let k = 0; k < 3; k++) data[4 * (yy * w + xx) + k] = value;
  };
  return { data, width: w, height: h, paint };
}
function grayscale(image) { return Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4]); }
function blur(image, radius = 3) {
  const copy = image.data.slice(), { width: w, height: h } = image;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += copy[4 * (yy * w + xx)]; n++; }
    }
    for (let k = 0; k < 3; k++) image.data[4 * (y * w + x) + k] = sum / n;
  }
}
function printed(ink = 0) {
  const image = raster();
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    image.paint(c * 100 + 41, r * 100 + 32, 8, 38, ink);
    image.paint(c * 100 + 34, r * 100 + 65, 25, 6, ink);
  }
  return image;
}
test('quality measures cell interiors, not crisp lines or background text', () => {
  const bare = printed(), sharp = gridQuality(bare, quad(400, 400), 4, 4);
  for (let i = 0; i <= 400; i += 100) { bare.paint(i, 0, 8, 400); bare.paint(0, i, 400, 8); }
  const lines = gridQuality(bare, quad(400, 400), 4, 4);
  assert.deepEqual(lines, sharp);
  const board = raster(600, 600); board.paint(0, 0, 600, 100); board.paint(0, 500, 600, 100);
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++)
    board.data.set(bare.data.subarray(4 * (y * 400 + x), 4 * (y * 400 + x) + 4), 4 * ((y + 100) * 600 + x + 100));
  assert.deepEqual(gridQuality(board, quad(400, 400).map((p) => ({ x: p.x + 100, y: p.y + 100 })), 4, 4), sharp);
});
test('blurred digits rank below sharp digits even with crisp grid lines', () => {
  const sharp = printed(), blurred = printed(); blur(blurred, 5);
  for (let i = 0; i <= 400; i += 100) { blurred.paint(i, 0, 8, 400); blurred.paint(0, i, 400, 8); }
  const a = gridQuality(sharp, quad(400, 400), 4, 4), b = gridQuality(blurred, quad(400, 400), 4, 4);
  assert.ok(a.assessable && b.assessable); assert.ok(a.score > b.score * 2, JSON.stringify({ a, b }));
});
test('flat cells and grid-only images do not masquerade as readable digits', () => {
  const image = raster();
  for (let i = 0; i <= 400; i += 100) { image.paint(i, 0, 7, 400); image.paint(0, i, 400, 7); }
  image.paint(102, 102, 94, 94);
  assert.equal(gridQuality(image, quad(400, 400), 4, 4).assessable, false);
});
test('quality handles faint ink, too-small grids and malformed dimensions', () => {
  const faint = gridQuality(printed(231), quad(400, 400), 4, 4);
  assert.equal(faint.reason, 'contrast'); assert.match(qualityMessage(faint), /contrast/);
  assert.equal(gridQuality(raster(), quad(100, 100), 12, 12).reason, 'small');
  for (const rows of [0, 26, NaN, 1.5]) assert.equal(gridQuality(raster(), quad(400, 400), rows, 4), null);
  assert.equal(gridQuality(raster(), null, 4, 4), null);
});
for (const value of [0, 255]) test(`uniform ${value} never creates local boundaries`, () => {
  assert.equal(refineCellBounds(new Uint8Array(400 * 400).fill(value), 400, 400, 4, 4), null);
});
test('already aligned ruled grids are unchanged', () => {
  const image = raster();
  for (let i = 0; i <= 400; i += 100) { image.paint(i, 0, 2, 400); image.paint(0, i, 400, 2); }
  assert.equal(refineCellBounds(grayscale(image), 400, 400, 4, 4), null);
});
test('local shifted lines move adjoining cell boundaries together', () => {
  const image = raster(); image.paint(109, 0, 2, 400); image.paint(0, 191, 400, 2);
  const bounds = refineCellBounds(grayscale(image), 400, 400, 4, 4);
  assert.ok(bounds); assert.equal(bounds[0].x + bounds[0].w, bounds[1].x);
  assert.ok(Math.abs(bounds[1].x - 109.5) < .1); assert.ok(Math.abs(bounds[4].y + bounds[4].h - 191.5) < .1);
});
test('speckle, digits, thick bands and ambiguous double lines do not move cells', () => {
  for (const kind of ['digits', 'thick', 'double']) {
    const image = kind === 'digits' ? printed() : raster();
    if (kind === 'thick') image.paint(105, 0, 18, 400);
    if (kind === 'double') { image.paint(106, 0, 2, 400); image.paint(113, 0, 2, 400); }
    assert.equal(refineCellBounds(grayscale(image), 400, 400, 4, 4), null, kind);
  }
});
test('numeric padding follows the refined cell instead of re-clipping to a uniform cell', () => {
  const entry = { cell: 1, cellBounds: { x: 110, y: 0, w: 90, h: 100 } };
  assert.equal(numericCropBounds(entry, 400, 400, 100, 100, 4).minX, 117);
  assert.equal(numericCropBounds({ cell: 1 }, 400, 400, 100, 100, 4).minX, 108);
});
test('local geometry changes keep unanimous OCR reviewable and preserve black structure', () => {
  const image = raster(); image.paint(109, 0, 2, 400); image.paint(80, 30, 12, 42); image.paint(300, 300, 100, 100);
  const prepared = prepareScan(image, 'str8ts', 4, 4), entry = prepared.entries.find((e) => e.cell === 0);
  assert.ok(entry?.refinedCell); assert.deepEqual(prepared.black.flatMap((b, i) => b ? [i] : []), [15]);
  entry.text = '1'; entry.confidence = 99;
  applyDigitVotes([entry], [{ index: 0, text: '1', kind: 'gray', confidence: 99 }, { index: 0, text: '1', kind: 'binary', confidence: 99 }]);
  assert.equal(entry.confidence, 0);
  assert.ok(puzzleFromReadings(prepared, 'str8ts', 4, 4).uncertain.includes(0));
});
for (const turns of [0, 1, 2, 3]) test(`original detail coordinates survive ${turns} quarter-turns`, () => {
  const w = 1600, h = 1200, original = [{ x: 400, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 700 }, { x: 400, y: 700 }];
  const rotated = original.map((p) => turnPoint(p, w, h, turns));
  // Restore the corner ordering expected by validQuad, retaining UI orientation.
  const corners = rotated.slice(4 - turns).concat(rotated.slice(0, 4 - turns));
  const plan = detailPlan({ width: turns % 2 ? h : w, height: turns % 2 ? w : h }, corners, 4000, 3000, turns);
  assert.ok(plan); assert.ok(plan.width > 995 && plan.width < 1010); assert.ok(plan.height > 995 && plan.height < 1010);
  assert.ok(plan.corners[0].x < 5 && plan.corners[0].y < 5);
  assert.ok(plan.corners[2].x > plan.width - 6 && plan.corners[2].y > plan.height - 6);
});
test('detail working canvas and original decode are independently bounded', () => {
  const plan = detailPlan({ width: 1600, height: 1200 }, quad(1600, 1200), 4000, 3000);
  assert.equal(plan.width, 1800); assert.equal(plan.height, 1350);
  assert.equal(detailPlan({ width: 1600, height: 1200 }, quad(1600, 1200), 8000, 6000), null);
  assert.equal(detailPlan({ width: 1600, height: 1200 }, [null], 4000, 3000), null);
});
function mock(t) {
  const old = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  const calls = [], bitmaps = [], canvases = [];
  globalThis.createImageBitmap = async () => {
    const bitmap = { width: 4000, height: 3000, closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap); return bitmap;
  };
  globalThis.document = { createElement() { const c = { getContext: () => ({ fillRect() {}, translate() {}, rotate() {}, drawImage(...args) { calls.push(args); } }) }; canvases.push(c); return c; } };
  t.after(() => { for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  return { calls, bitmaps, canvases };
}
test('enhanced crop is transient, opaque-backed, and does not resize the preview', async (t) => {
  const h = mock(t), preview = { width: 1600, height: 1200 };
  retainPhotoSource(preview, {}, { width: 4000, height: 3000 });
  const result = await photoDetail(preview, quad(1600, 1200));
  assert.ok(result.enhanced); assert.ok(h.bitmaps[0].closed); assert.equal(preview.width, 1600);
  result.release(); assert.equal(result.image.width, 0);
});
test('oversized originals never invoke an unbounded decoder', async (t) => {
  const h = mock(t), preview = { width: 1600, height: 1200 };
  retainPhotoSource(preview, {}, { width: DETAIL_PIXEL_LIMIT, height: 2 });
  const result = await photoDetail(preview, quad(1600, 1200));
  assert.equal(result.enhanced, false); assert.equal(h.bitmaps.length, 0); assert.match(result.note, /memory limit/);
});
test('decode failure falls back without losing the selected photo or corners', async (t) => {
  mock(t); globalThis.createImageBitmap = async () => { throw Error('decoder'); };
  const preview = retainPhotoSource({ width: 1600, height: 1200 }, {}, { width: 4000, height: 3000 }), corners = quad(1600, 1200);
  const result = await photoDetail(preview, corners);
  assert.equal(result.image, preview); assert.equal(result.corners, corners); assert.equal(result.enhanced, false);
});
test('cancellation after decode closes the source and produces no enhanced canvas', async (t) => {
  const h = mock(t), decode = globalThis.createImageBitmap; let current = true;
  globalThis.createImageBitmap = async () => { const b = await decode(); current = false; return b; };
  const preview = retainPhotoSource({ width: 1600, height: 1200 }, {}, { width: 4000, height: 3000 });
  await assert.rejects(photoDetail(preview, quad(1600, 1200), { current: () => current }), { name: 'AbortError' });
  assert.ok(h.bitmaps[0].closed); assert.equal(h.canvases.length, 0);
});
function controlledDecodes(t) {
  const h = mock(t), decode = globalThis.createImageBitmap, pending = [];
  let inflight = 0; h.most = 0; h.pending = pending;
  globalThis.createImageBitmap = () => {
    h.most = Math.max(h.most, ++inflight);
    return new Promise((resolve) => pending.push(async () => { inflight--; resolve(await decode()); }));
  };
  return h;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('a superseded read still decoding does not degrade the next read to the preview', async (t) => {
  const h = controlledDecodes(t), corners = quad(1600, 1200);
  const preview = retainPhotoSource({ width: 1600, height: 1200 }, {}, { width: 4000, height: 3000 });
  let firstCurrent = true;
  const first = photoDetail(preview, corners, { current: () => firstCurrent });
  await settle(); assert.equal(h.pending.length, 1);
  firstCurrent = false; // A nudged corner starts a new read.
  const second = photoDetail(preview, corners);
  await settle(); assert.equal(h.pending.length, 1, 'one original decode at a time');
  h.pending[0](); await assert.rejects(first, { name: 'AbortError' }); assert.ok(h.bitmaps[0].closed);
  await settle(); assert.equal(h.pending.length, 2);
  h.pending[1](); const result = await second;
  assert.equal(result.enhanced, true); assert.match(result.note, /original photo detail/);
  assert.equal(h.most, 1); assert.ok(h.bitmaps[1].closed); result.release();
});
test('a read superseded while queued never decodes', async (t) => {
  const h = controlledDecodes(t), corners = quad(1600, 1200);
  const preview = retainPhotoSource({ width: 1600, height: 1200 }, {}, { width: 4000, height: 3000 });
  let firstCurrent = true, secondCurrent = true;
  const first = photoDetail(preview, corners, { current: () => firstCurrent });
  await settle(); firstCurrent = false;
  const second = photoDetail(preview, corners, { current: () => secondCurrent });
  await settle(); secondCurrent = false;
  const third = photoDetail(preview, corners);
  h.pending[0](); await assert.rejects(first, { name: 'AbortError' });
  await assert.rejects(second, { name: 'AbortError' });
  await settle(); assert.equal(h.pending.length, 2, 'the queued, superseded read skipped its decode');
  h.pending[1](); assert.equal((await third).enhanced, true);
});
test('rotating a retained preview keeps original-source ownership', async (t) => {
  mock(t); const preview = retainPhotoSource({ width: 1600, height: 1200 }, {}, { width: 4000, height: 3000 });
  const rotated = { width: 1200, height: 1600 }; rotatePhotoSource(preview, rotated);
  const result = await photoDetail(rotated, quad(1200, 1600));
  assert.ok(result.enhanced); assert.equal(result.image.width, 1350); assert.equal(result.image.height, 1800); result.release();
});

test('local lines do not change complete printed crops or create unnecessary review', () => {
  const image = raster(); image.paint(109, 0, 2, 400); image.paint(139, 30, 8, 42);
  const entry = prepareScan(image, 'str8ts', 4, 4).entries.find((e) => e.cell === 1);
  assert.equal(entry.refinedCell, undefined); assert.equal(entry.cellBounds, undefined);
  assert.deepEqual([entry.x, entry.y, entry.w, entry.h], [139, 30, 8, 42]);
  entry.text = '1'; entry.confidence = 99;
  applyDigitVotes([entry], [{ index: 0, text: '1', kind: 'gray', confidence: 99 },
    { index: 0, text: '1', kind: 'binary', confidence: 99 }]);
  assert.equal(entry.confidence, 99);
});

test('a proposed smaller cell never clips an existing glyph', () => {
  const image = raster(); image.paint(90, 0, 2, 400); image.paint(78, 30, 8, 42);
  const entry = prepareScan(image, 'latinsquare', 4, 4).entries.find((e) => e.cell === 0);
  assert.equal(entry.refinedCell, undefined);
  assert.deepEqual([entry.x, entry.y, entry.w, entry.h], [78, 30, 8, 42]);
});

test('textured blank cells cannot dominate the quality of clear printed clues', () => {
  const image = printed();
  for (let cell = 3; cell < 16; cell++) {
    const ox = (cell % 4) * 100, oy = Math.floor(cell / 4) * 100;
    image.paint(ox, oy, 100, 100, 210);
    for (let y = oy; y < oy + 100; y++) image.paint(ox, y, 100, 1, 210 + Math.round((y - oy) * .3));
  }
  const quality = gridQuality(image, quad(400, 400), 4, 4);
  assert.equal(quality.assessable, true); assert.equal(quality.reason, null);
  assert.equal(quality.markedCells, 3);
});

test('clue-quality ranking is symmetric for white-on-black print', () => {
  const normal = printed(), inverse = printed();
  for (let i = 0; i < inverse.data.length; i += 4) for (let k = 0; k < 3; k++) inverse.data[i + k] = 255 - inverse.data[i + k];
  const a = gridQuality(normal, quad(400, 400), 4, 4), b = gridQuality(inverse, quad(400, 400), 4, 4);
  assert.equal(a.markedCells, b.markedCells); assert.equal(a.reason, b.reason);
  assert.ok(Math.abs(a.score - b.score) < 1);
});
