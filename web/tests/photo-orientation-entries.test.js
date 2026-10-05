// An Orientation entry that every engine ignores (SHORT 0 or 9, LONG, count 2)
// imports the photo as stored, as Chromium, Firefox and WebKit show it.
// Camera-style IFD0s (Make and Model before Orientation) and EXIF-less JPEGs
// pin the IFD entry walk and the stop at the start of scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';
const seg = (marker, body) => { const b = Buffer.alloc(4); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(body.length + 2, 2); return Buffer.concat([b, body]); };
function cameraTiff(value, little, { type = 3, count = 1 } = {}) {
  const entries = [[0x010f, 2, 6, 'Phone\0'], [0x0110, 2, 6, 'Model\0'], [0x0112, type, count, value], [0x011a, 5, 1, null]];
  const ifdAt = 8, dataAt = ifdAt + 2 + entries.length * 12 + 4, b = Buffer.alloc(dataAt + 32);
  const u16 = (v, p) => little ? b.writeUInt16LE(v, p) : b.writeUInt16BE(v, p), u32 = (v, p) => little ? b.writeUInt32LE(v, p) : b.writeUInt32BE(v, p);
  b.write(little ? 'II' : 'MM'); u16(42, 2); u32(ifdAt, 4); u16(entries.length, ifdAt);
  let data = dataAt;
  entries.forEach(([tag, t, n, v], k) => {
    const at = ifdAt + 2 + k * 12; u16(tag, at); u16(t, at + 2); u32(n, at + 4);
    if (tag === 0x0112) { if (t === 3) u16(v, at + 8); else u32(v, at + 8); }
    else if (t === 2) { u32(data, at + 8); b.write(v, data, 'binary'); data += 6; }
    else { u32(data, at + 8); u32(72, data); u32(1, data + 4); data += 8; }
  });
  return b;
}
// APP0 (JFIF), optional APP1 (Exif), DQT, SOF0, DHT, SOS, entropy-coded data
// with a stuffed FF00, EOI.
function jpeg(w, h, exif = null) {
  const sof = Buffer.from([8, 0, 0, 0, 0, 1, 1, 17, 0]); sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3);
  const app1 = exif ? [seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'binary'), exif]))] : [];
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')), ...app1,
    seg(0xdb, Buffer.alloc(65)), seg(0xc0, sof), seg(0xc4, Buffer.alloc(29)), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a, 0xbc]), Buffer.from([0xff, 0xd9])]);
}
function chunk(kind, data, png = false) {
  const b = Buffer.alloc(8); b.write(kind, png ? 4 : 0);
  if (png) b.writeUInt32BE(data.length); else b.writeUInt32LE(data.length, 4);
  return Buffer.concat([b, Buffer.from(data), Buffer.alloc(png ? 4 : data.length % 2)]);
}
function png(w, h, exif) {
  const head = Buffer.alloc(13); head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head, true), chunk('eXIf', exif, true), chunk('IEND', [], true)]);
}
function webp(w, h, exif) {
  const x = Buffer.alloc(10); x[0] = 8; x.writeUIntLE(w - 1, 4, 3); x.writeUIntLE(h - 1, 7, 3);
  const chunks = Buffer.concat([chunk('VP8X', x), chunk('VP8 ', Buffer.alloc(1001)), chunk('EXIF', exif)]);
  const head = Buffer.from('RIFF\0\0\0\0WEBP'); head.writeUInt32LE(chunks.length + 4, 4);
  return Buffer.concat([head, chunks]);
}
function harness(t) {
  const calls = [];
  for (const key of ['document', 'createImageBitmap']) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]);
  }
  globalThis.document = { createElement() { return { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, translate() {}, rotate() {}, scale() {} }) }; } };
  // A missing height follows the 4000x3000 photo shown as stored, as the HTML spec says.
  globalThis.createImageBitmap = async (file, o) => {
    calls.push({ file, size: [o.resizeWidth, o.resizeHeight] });
    return { width: o.resizeWidth, height: o.resizeHeight ?? Math.ceil(3000 * o.resizeWidth / 4000), close() {} };
  };
  return calls;
}
const ignored = [['SHORT 0', 0, {}], ['SHORT 9', 9, {}], ['SHORT 65535', 65535, {}], ['LONG 6', 6, { type: 4 }], ['SHORT count 2', 6, { count: 2 }]];
for (const little of [false, true]) {
  for (const [label, value, opts] of ignored)
    test(`JPEG Orientation ${label} (engines ignore it), little-endian ${little}: imports as stored`, async t => {
      const calls = harness(t);
      const { image } = await importPhoto(new Blob([jpeg(4000, 3000, cameraTiff(value, little, opts))]));
      assert.deepEqual(calls.map((c) => c.size), [[1600, 1200]]);
      assert.deepEqual([image.width, image.height], [1600, 1200]);
    });
  for (const value of [1, 3, 6, 8])
    test(`camera-style IFD0 (Make, Model before Orientation ${value}), little-endian ${little}`, async t => {
      const calls = harness(t), want = value >= 5 ? [1200, 1600] : [1600, 1200];
      const { image } = await importPhoto(new Blob([jpeg(4000, 3000, cameraTiff(value, little))]));
      assert.deepEqual(calls.map((c) => c.size), [want]);
      assert.deepEqual([image.width, image.height], want);
    });
  test(`PNG eXIf and WebP EXIF Orientation 0, little-endian ${little}: import as stored`, async t => {
    const calls = harness(t);
    await importPhoto(new Blob([png(4000, 3000, cameraTiff(0, little))]));
    const file = new Blob([webp(4000, 3000, cameraTiff(0, little))]);
    await importPhoto(file);
    assert.deepEqual(calls.map((c) => c.size), [[1600, 1200], [1600, 1200]]);
    assert.equal(calls[1].file, file, 'nothing to neutralize: the WebP decodes from the original file');
  });
}
test('a 4000x3000 JPEG without EXIF imports upright through one bounded decode', async t => {
  const calls = harness(t);
  const { image } = await importPhoto(new Blob([jpeg(4000, 3000)]));
  assert.deepEqual(calls.map((c) => c.size), [[1600, 1200]]);
  assert.deepEqual([image.width, image.height], [1600, 1200]);
});
test('structural EXIF damage imports as stored through one width that fits either way round', async t => {
  const calls = harness(t), meta = cameraTiff(6, false);
  meta.writeUInt32BE(0xfffffff0, 4);
  const { image } = await importPhoto(new Blob([jpeg(4000, 3000, meta)]));
  assert.deepEqual(calls.map((c) => c.size), [[1200, undefined]]);
  assert.deepEqual([image.width, image.height], [1200, 900]);
});
