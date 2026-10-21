// HEIC imports through stub decoders. iOS hands a HEIC over unconverted when
// the photo is picked through Choose File (the Files app), and Mac Safari
// takes one as it is; Safari 17 and later decode it (WebKit's HAVE(HEIC) from
// safari-7616-branch), other browsers do not. The stub decoder plays a browser
// that decodes HEIC and turns it by its irot, or one that cannot decode it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';
import { photoDetail } from '../photo-detail.js';
import { sniffDimensions } from '../image-dimensions.js';
import { heic } from './heif-fixture.js';

function engine(t, { decodes = true, knows = ['from-image', 'flipY', 'none'], turns = true } = {}) {
  const calls = [], bitmaps = [], images = [];
  for (const key of ['document', 'Image', 'createImageBitmap']) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => (d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]));
  }
  globalThis.createImageBitmap = async (file, options = {}) => {
    calls.push({ ...options });
    if (options.imageOrientation !== undefined && !knows.includes(options.imageOrientation))
      throw new TypeError(`The provided value '${options.imageOrientation}' is not a valid enum value of type ImageOrientation.`);
    if (!decodes) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    const found = sniffDimensions(new Uint8Array(await file.arrayBuffer()), file.size);
    const [w, h] = found.heif.turned === turns ? [found.height, found.width] : [found.width, found.height];
    const { resizeWidth: rw, resizeHeight: rh } = options;
    const bitmap = { width: rw ?? w, height: rh ?? (rw ? Math.ceil(h * rw / w) : h), close() { this.closed = true; } };
    bitmaps.push(bitmap); return bitmap;
  };
  globalThis.Image = class { async decode() { images.push(this.src); throw new DOMException('The source image cannot be decoded.', 'EncodingError'); } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:heic');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, draws: [] };
    canvas.getContext = () => ({ fillRect() {}, translate() {}, rotate() {}, scale() {}, drawImage: (source, ...args) => canvas.draws.push({ source, args }) });
    return canvas;
  } };
  return { calls, bitmaps, images };
}
const file = (bytes, type = 'image/heic') => new Blob([bytes], { type });
const quad = (w, h) => [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];

for (const [rotation, expected] of [[null, [1600, 1200]], [0, [1600, 1200]], [1, [1200, 1600]], [2, [1600, 1200]], [3, [1200, 1600]]])
  test(`a HEIC with irot ${rotation} imports where the browser decodes it, from one width planned on its axes`, async (t) => {
    const h = engine(t);
    for (const [width, height] of [[4032, 3024], [5712, 4284], [8064, 6048]]) {
      const { image, dimensions } = await importPhoto(file(heic({ width, height, rotation, mirror: rotation === 2 ? 1 : null })));
      assert.deepEqual([image.width, image.height], expected, `${width}x${height}`);
      assert.deepEqual(h.calls.at(-1), { resizeWidth: expected[0], resizeQuality: 'high', imageOrientation: 'from-image' });
      assert.deepEqual([dimensions.width, dimensions.height], [width, height]);
      assert.ok(h.bitmaps.at(-1).closed); assert.equal(h.images.length, 0);
    }
  });

test('a HEIC the browser turns otherwise than its irot is shown as the browser turns it, never squeezed', async (t) => {
  const h = engine(t, { turns: false });
  const { image } = await importPhoto(file(heic({ rotation: 1 })));
  assert.deepEqual([image.width, image.height], [1200, 900]);
  // A 4:1 panorama: its width is held so that the other way round stays within twice 1600 pixels.
  const wide = await importPhoto(file(heic({ width: 8000, height: 2000 })));
  assert.equal(h.calls.at(-1).resizeWidth, 800);
  assert.deepEqual([h.bitmaps.at(-1).width, h.bitmaps.at(-1).height], [800, 3200]);
  assert.deepEqual([wide.image.width, wide.image.height], [400, 1600]);
});

test('Safari 17.0 and 17.1 decode HEIC but refuse "from-image": the import asks again without it', async (t) => {
  const h = engine(t, { knows: ['flipY', 'none'] });
  const { image } = await importPhoto(file(heic({ width: 5712, height: 4284, rotation: 3 })));
  assert.deepEqual([image.width, image.height], [1200, 1600]);
  assert.deepEqual(h.calls, [{ resizeWidth: 1200, resizeQuality: 'high', imageOrientation: 'from-image' }, { resizeWidth: 1200, resizeQuality: 'high' }]);
});

for (const kind of ['cannot decode HEIC', 'has no createImageBitmap'])
  test(`a browser that ${kind} refuses a HEIC by name, pointing to the Photo Library`, async (t) => {
    const h = engine(t, { decodes: false, knows: ['flipY', 'none'] });
    if (kind === 'has no createImageBitmap') globalThis.createImageBitmap = undefined;
    for (const [width, height] of [[4032, 3024], [8064, 6048]])
      await assert.rejects(importPhoto(file(heic({ width, height, rotation: 1 }), '')),
        { message: 'This browser cannot open HEIC photos. Choose the photo from the Photo Library, which converts it to JPEG, or export it as JPEG, PNG or WebP, then try again.' });
    assert.equal(h.images.length, 0, 'no full decode is tried');
    if (kind === 'cannot decode HEIC') assert.equal(h.calls.length, 4, 'one call and one retry each');
  });

test('a HEIC whose header cannot be checked is refused by name before any decoder runs', async (t) => {
  const h = engine(t);
  await assert.rejects(importPhoto(file(heic({ primarySizes: 0 }))),
    { message: "The HEIC photo's dimensions could not be checked safely. Choose the photo from the Photo Library, which converts it to JPEG, or export it as JPEG, PNG or WebP, then try again." });
  assert.equal(h.calls.length, 0);
});

test('the limits of every other format bound a HEIC before any decoder runs', async (t) => {
  const h = engine(t);
  await assert.rejects(importPhoto(file(heic({ width: 12000, height: 10001 }))), /too large to decode safely/);
  await assert.rejects(importPhoto(file(heic({ width: 0, height: 3024 }))), /The image is empty/);
  await assert.rejects(importPhoto(file(heic({ data: 30 * 1024 * 1024 }))), /smaller than 30 MB/);
  assert.equal(h.calls.length, 0);
});

test('a HEIC original gives its detail to a Read like any other photo', async (t) => {
  const h = engine(t), { image } = await importPhoto(file(heic({ rotation: 1 })));
  const result = await photoDetail(image, quad(image.width, image.height));
  assert.equal(result.enhanced, true); assert.deepEqual(h.calls.at(-1), { imageOrientation: 'from-image' });
  assert.deepEqual([h.bitmaps.at(-1).width, h.bitmaps.at(-1).height], [3024, 4032]); assert.ok(h.bitmaps.at(-1).closed);
  result.release();
});
