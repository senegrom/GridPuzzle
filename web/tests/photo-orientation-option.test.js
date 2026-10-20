// Engines that refuse imageOrientation "from-image": Safari before 17.2 (iOS
// 16.4 to 17.1, WebKit's safari-7615 and -7616 branches) knows the option only
// as "none" or "flipY", and WebIDL turns any other value into a TypeError. Its
// default, "none", applies the EXIF orientation (ImageBitmap.cpp on
// safari-7615-branch draws with the image's own orientation unless flipY).
// The stub below converts the options the way those bindings do and decodes
// as that engine would; `turns: false` models an engine whose default ignores
// EXIF, which the import must catch by the bitmap's axes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';
import { photoDetail, detailPlan, rotatePhotoSource } from '../photo-detail.js';

const concat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
function tiff(value) {
  const b = Buffer.alloc(26); b.write('MM'); b.writeUInt16BE(42, 2); b.writeUInt32BE(8, 4);
  b.writeUInt16BE(1, 8); b.writeUInt16BE(0x112, 10); b.writeUInt16BE(3, 12); b.writeUInt32BE(1, 14); b.writeUInt16BE(value, 18);
  return b;
}
const exifOf = new WeakMap();
function jpeg(w, h, value) {
  const frame = Buffer.from([255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0]); frame.writeUInt16BE(h, 5); frame.writeUInt16BE(w, 7);
  const exif = tiff(value), app1 = concat([255, 225, (exif.length + 8) >> 8, (exif.length + 8) & 255], 'Exif\0\0', exif);
  const file = new Blob([concat([255, 216], app1, frame, [255, 217])], { type: 'image/jpeg' });
  exifOf.set(file, { w, h, value });
  return file;
}
const quad = (w, h) => [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
const ORIENTATIONS = ['from-image', 'flipY', 'none'];
function engine(t, { knows = ['none', 'flipY'], turns = true, failWith = null } = {}) {
  const calls = [], bitmaps = [], fullDecodes = [];
  for (const key of ['document', 'Image', 'createImageBitmap']) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => (d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]));
  }
  const oriented = ({ w, h, value }, apply) => (apply && value >= 5 ? [h, w] : [w, h]);
  globalThis.createImageBitmap = async (file, options = {}) => {
    calls.push({ ...options });
    if (failWith) throw new DOMException('Cannot decode the data in the argument to createImageBitmap', failWith);
    // WebIDL enumeration conversion: a value outside the enum is a TypeError.
    if (options.imageOrientation !== undefined && !(ORIENTATIONS.includes(options.imageOrientation) && knows.includes(options.imageOrientation)))
      throw new TypeError(`The provided value '${options.imageOrientation}' is not a valid enum value of type ImageOrientation.`);
    const meta = exifOf.get(file), apply = options.imageOrientation === 'from-image' || turns;
    const [w, h] = oriented(meta, apply), { resizeWidth: rw, resizeHeight: rh } = options;
    const bitmap = { width: rw ?? (rh ? Math.ceil(w * rh / h) : w), height: rh ?? (rw ? Math.ceil(h * rw / w) : h),
      turned: apply && meta.value >= 5, close() { this.closed = true; } };
    bitmaps.push(bitmap); return bitmap;
  };
  // The browser's <img> applies the EXIF orientation.
  const urls = new Map();
  t.mock.method(URL, 'createObjectURL', (file) => { const url = `blob:${urls.size}`; urls.set(url, file); return url; });
  t.mock.method(URL, 'revokeObjectURL', (url) => urls.delete(url));
  globalThis.Image = class {
    async decode() { const meta = exifOf.get(urls.get(this.src)); fullDecodes.push(meta); [this.naturalWidth, this.naturalHeight] = oriented(meta, true); }
  };
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, draws: [] };
    canvas.getContext = () => ({ fillRect() {}, translate() {}, rotate() {}, scale() {}, drawImage: (source, ...args) => canvas.draws.push({ source, args }) });
    return canvas;
  } };
  return { calls, bitmaps, fullDecodes };
}
const SIZES = [[4032, 3024], [5712, 4284], [8064, 6048]]; // 12, 24 and 48 MP, as stored by an iPhone
const fit = (w, h) => { const s = Math.min(1, 1600 / Math.max(w, h)); return [Math.round(w * s), Math.round(h * s)]; };

for (let value = 1; value <= 8; value++)
  test(`EXIF ${value}: an engine that refuses "from-image" still gets one resized, oriented bitmap`, async (t) => {
    const h = engine(t);
    for (const [w, ht] of SIZES) {
      const before = h.calls.length, { image } = await importPhoto(jpeg(w, ht, value)), calls = h.calls.slice(before);
      const expected = value >= 5 ? fit(ht, w) : fit(w, ht);
      assert.deepEqual([image.width, image.height], expected, `${w}x${ht}: the preview is the oriented photo at 1600 px`);
      assert.equal(calls.length, 2); assert.equal(calls[0].imageOrientation, 'from-image');
      assert.equal('imageOrientation' in calls[1], false, 'the retry leaves the option to the default');
      // A quarter turn asks for one width, so the bitmap's own axes show the turn.
      assert.deepEqual([calls[1].resizeWidth, calls[1].resizeHeight], value >= 5 ? [expected[0], undefined] : expected);
      assert.equal(h.fullDecodes.length, 0, 'no full-size decode, so no 24 MP refusal');
      assert.ok(h.bitmaps.at(-1).closed);
      assert.equal(image.draws.at(-1).source, h.bitmaps.at(-1));
    }
  });

for (const value of [5, 6, 7, 8])
  test(`EXIF ${value}: a retried bitmap that was not turned goes to the browser's full decode`, async (t) => {
    const h = engine(t, { turns: false });
    const { image } = await importPhoto(jpeg(4032, 3024, value));
    assert.deepEqual([image.width, image.height], [1200, 1600], 'turned by <img>, never squeezed');
    assert.equal(h.bitmaps.length, 1); assert.ok(h.bitmaps[0].closed); assert.equal(h.bitmaps[0].turned, false);
    assert.equal(h.fullDecodes.length, 1); assert.equal(image.draws.at(-1).args.length, 4);
    // The full decode keeps its limit: a 24 MP photo is refused, as before.
    await assert.rejects(importPhoto(jpeg(5712, 4284, value)), /cannot downscale this large photo/);
    assert.equal(h.fullDecodes.length, 1); assert.ok(h.bitmaps.every((b) => b.closed));
  });

test('an orientation that keeps the axes keeps both requested dimensions on the retry', async (t) => {
  // Without a quarter turn the axes are the same whoever orients the photo.
  const h = engine(t, { turns: false });
  for (const value of [1, 2, 3, 4]) {
    const { image } = await importPhoto(jpeg(5712, 4284, value));
    assert.deepEqual([image.width, image.height], [1600, 1200]);
    assert.deepEqual([h.calls.at(-1).resizeWidth, h.calls.at(-1).resizeHeight], [1600, 1200]);
  }
  assert.equal(h.fullDecodes.length, 0);
});

test('only a TypeError retries: a decode failure goes straight to the full decode', async (t) => {
  const h = engine(t, { failWith: 'InvalidStateError' });
  const { image } = await importPhoto(jpeg(4032, 3024, 6));
  assert.equal(h.calls.length, 1); assert.equal(h.fullDecodes.length, 1);
  assert.deepEqual([image.width, image.height], [1200, 1600]);
});

test('an import superseded during the refused call never retries', async (t) => {
  const h = engine(t), decoder = globalThis.createImageBitmap;
  let current = true;
  globalThis.createImageBitmap = async (...args) => { try { return await decoder(...args); } finally { current = false; } };
  await assert.rejects(importPhoto(jpeg(4032, 3024, 6), { current: () => current }), { name: 'AbortError' });
  assert.equal(h.calls.length, 1); assert.equal(h.fullDecodes.length, 0);
});

for (const value of [1, 3, 6, 8])
  test(`EXIF ${value}: the original-detail decode also retries without "from-image"`, async (t) => {
    const h = engine(t), { image } = await importPhoto(jpeg(4032, 3024, value));
    let preview = image;
    for (let userTurns = 0; userTurns < 4; userTurns++) {
      const before = h.calls.length, result = await photoDetail(preview, quad(preview.width, preview.height));
      assert.equal(result.enhanced, true, `after ${userTurns} user turns`);
      assert.match(result.note, /original photo detail/);
      assert.deepEqual(h.calls.slice(before), [{ imageOrientation: 'from-image' }, {}]);
      assert.ok(h.bitmaps.at(-1).closed); result.release();
      const next = { width: preview.height, height: preview.width }; rotatePhotoSource(preview, next); preview = next;
    }
  });

test('an original decoded turned otherwise than the preview is not used for the detail', async (t) => {
  // The import fell back to <img>, which turned the photo; the default of
  // this engine does not, so its original lies across the preview.
  const h = engine(t, { turns: false }), { image } = await importPhoto(jpeg(4032, 3024, 6));
  assert.deepEqual([image.width, image.height], [1200, 1600]);
  const corners = quad(image.width, image.height), result = await photoDetail(image, corners);
  assert.equal(result.enhanced, false); assert.equal(result.image, image); assert.equal(result.corners, corners);
  assert.match(result.note, /could not be checked; recognition uses the preview/);
  assert.ok(h.bitmaps.at(-1).closed); assert.deepEqual([h.bitmaps.at(-1).width, h.bitmaps.at(-1).height], [4032, 3024]);
});

test('detailPlan refuses an original whose long side lies across the preview before its turns', () => {
  for (let turns = 0; turns < 4; turns++) {
    const preview = turns % 2 ? { width: 1600, height: 1200 } : { width: 1200, height: 1600 };
    assert.ok(detailPlan(preview, quad(preview.width, preview.height), 3024, 4032, turns), `${turns} turns, same axes`);
    assert.equal(detailPlan(preview, quad(preview.width, preview.height), 4032, 3024, turns), null, `${turns} turns, across`);
  }
  // A square preview or original cannot show a turn, and is not refused for it.
  assert.ok(detailPlan({ width: 1600, height: 1600 }, quad(1600, 1600), 4032, 3024));
  assert.ok(detailPlan({ width: 1600, height: 1200 }, quad(1600, 1200), 3000, 3000));
});
