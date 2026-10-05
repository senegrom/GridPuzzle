// Where the EXIF parser and the browser's decoder can disagree about which way
// round a photo is, the import requests one width that fits either way, so the
// preview keeps the decoder's own aspect ratio instead of being squeezed, and
// damaged EXIF imports as stored instead of being refused. Where every engine
// agrees (a camera-style IFD0 in a JPEG, no EXIF at all, a neutralized WebP) or
// the orientation keeps the axes (a flip or half turn), both bounded dimensions
// are still requested at full size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../photo-import.js';

const W = 4000, H = 3000;
const bytes = (text) => Buffer.from(text, 'binary');
const seg = (marker, body) => { const b = Buffer.alloc(4); b[0] = 0xff; b[1] = marker; b.writeUInt16BE(body.length + 2, 2); return Buffer.concat([b, body]); };
// A camera-style TIFF block: Make, Model, an optional Orientation (a SHORT
// with count 1 unless entry.type and entry.count say otherwise), XResolution
// as a RATIONAL and an optional ExifIFD pointer in IFD0 (a LONG with count 1
// unless exif.type and exif.count say otherwise); the ExifIFD holds an
// optional Orientation, ExposureTime and PixelXDimension.
function tiff({ little = false, orientation = null, entry = {}, exif = null, ifdOffset = 8, magic = 42, order = little ? 'II' : 'MM' } = {}) {
  const b = Buffer.alloc(256), u16 = (v, p) => little ? b.writeUInt16LE(v, p) : b.writeUInt16BE(v, p),
    u32 = (v, p) => little ? b.writeUInt32LE(v >>> 0, p) : b.writeUInt32BE(v >>> 0, p);
  b.write(order, 'binary'); u16(magic, 2); u32(ifdOffset, 4);
  const orient = (value, { type = 3, count = 1 } = {}) => value === null ? [] : [[0x0112, type, count, value]];
  const ifd0 = [[0x010f, 2, 6, 'Phone\0'], [0x0110, 2, 6, 'Model\0'], ...orient(orientation, entry), [0x011a, 5, 1, 72]];
  const exifAt = 8 + 2 + (ifd0.length + (exif ? 1 : 0)) * 12 + 4;
  const sub = exif ? [...orient(exif.orientation ?? null), [0x829a, 5, 1, 1], [0xa002, 4, 1, W]] : [];
  if (exif) ifd0.push([0x8769, exif.type ?? 4, exif.count ?? 1, exif.offset ?? exifAt]);
  let data = exifAt + (exif ? 2 + sub.length * 12 + 4 : 0);
  const write = (at, entries) => {
    u16(entries.length, at);
    entries.forEach(([tag, type, count, value], k) => {
      const e = at + 2 + k * 12; u16(tag, e); u16(type, e + 2); u32(count, e + 4);
      if (type === 2) { u32(data, e + 8); b.write(value, data, 'binary'); data += value.length; }
      else if (type === 5) { u32(data, e + 8); u32(value, data); u32(1, data + 4); data += 8; }
      else if (type === 3) u16(value, e + 8); else u32(value, e + 8);
    });
  };
  write(8, ifd0); if (exif) write(exifAt, sub);
  return b.subarray(0, data);
}
// APP0 (JFIF), APP1 segments, DQT, SOF0, anything after SOF, DHT, SOS, entropy
// data with a stuffed FF00, EOI.
function jpeg({ w = W, h = H, app1 = [], afterSof = [] } = {}) {
  const sof = Buffer.from([8, 0, 0, 0, 0, 1, 1, 17, 0]); sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, bytes('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), ...app1.map((p) => seg(0xe1, p)),
    seg(0xdb, Buffer.alloc(65)), seg(0xc0, sof), ...afterSof, seg(0xc4, Buffer.alloc(29)), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0x78]), Buffer.from([0xff, 0xd9])]);
}
const exifApp1 = (block, id = 'Exif\0\0') => Buffer.concat([bytes(id), block]);
function chunk(kind, data, png = false) {
  const b = Buffer.alloc(8); b.write(kind, png ? 4 : 0);
  if (png) b.writeUInt32BE(data.length); else b.writeUInt32LE(data.length, 4);
  return Buffer.concat([b, Buffer.from(data), Buffer.alloc(png ? 4 : data.length % 2)]);
}
function png(exif = null) {
  const head = Buffer.alloc(13); head.writeUInt32BE(W); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head, true),
    ...(exif ? [chunk('eXIf', exif, true)] : []), chunk('IDAT', Buffer.alloc(16), true), chunk('IEND', [], true)]);
}
function webp(exif, frames = 0) {
  const x = Buffer.alloc(10); x[0] = 8 | (frames ? 2 : 0); x.writeUIntLE(W - 1, 4, 3); x.writeUIntLE(H - 1, 7, 3);
  const image = frames ? [chunk('ANIM', Buffer.alloc(6)), ...Array.from({ length: frames }, () => chunk('ANMF', Buffer.alloc(16)))] : [chunk('VP8 ', Buffer.alloc(1001))];
  const chunks = Buffer.concat([chunk('VP8X', x), ...image, chunk('EXIF', exif)]);
  const head = Buffer.from('RIFF\0\0\0\0WEBP'); head.writeUInt32LE(chunks.length + 4, 4);
  return Buffer.concat([head, chunks]);
}
// A decoder that turns the photo by its OWN reading of the EXIF, then resizes as
// the HTML spec says: to exactly the requested size, a missing dimension
// following the turned photo's aspect ratio, no request meaning natural size.
function engine(t, { orientation = 1, natural = [W, H] } = {}) {
  const calls = [];
  for (const key of ['document', 'createImageBitmap']) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]);
  }
  globalThis.document = { createElement() {
    return { width: 0, height: 0, getContext: () => ({ fillRect() {}, translate() {}, rotate() {}, scale() {}, drawImage() {} }) };
  } };
  globalThis.createImageBitmap = async (file, o) => {
    const [ow, oh] = orientation >= 5 ? [natural[1], natural[0]] : natural;
    const width = o.resizeWidth ?? (o.resizeHeight ? Math.ceil(ow * o.resizeHeight / oh) : ow),
      height = o.resizeHeight ?? (o.resizeWidth ? Math.ceil(oh * o.resizeWidth / ow) : oh);
    calls.push({ file, bytes: Buffer.from(await file.arrayBuffer()), request: [o.resizeWidth, o.resizeHeight], decoded: [ow, oh] });
    return { width, height, close() {} };
  };
  return calls;
}
// The preview shows the decoder's photo at one scale on both axes.
function assertUndistorted(image, call) {
  const [ow, oh] = call.decoded, sx = image.width / ow, sy = image.height / oh;
  assert.ok(Math.abs(sx / sy - 1) < 0.002, `${image.width}x${image.height} preview of a ${ow}x${oh} photo: x scale ${sx.toFixed(3)}, y scale ${sy.toFixed(3)}`);
}

// Each case under an engine that turns the photo by orientation 6 and one that
// shows it as stored: no squeeze either way, from a single safe width.
const disagreements = [
  ['PNG eXIf Orientation 6, which WebKitGTK ignores', png(tiff({ orientation: 6 }))],
  ['PNG eXIf behind an "Exif\\0\\0" prefix, which Chromium, Firefox and libpng ignore', png(exifApp1(tiff({ orientation: 6 })))],
  ['JPEG APP1 whose "Exif\\0\\0" identifier is repeated, which Skia ignores', jpeg({ app1: [exifApp1(exifApp1(tiff({ orientation: 6 })))] })],
  ['JPEG Orientation 6 only in the ExifIFD, which WebKit ignores', jpeg({ app1: [exifApp1(tiff({ exif: { orientation: 6 } }))] })],
  ['JPEG "Exif\\0" with a non-zero sixth byte, which Firefox ignores', jpeg({ app1: [exifApp1(tiff({ orientation: 6 }), 'Exif\0\xff')] })],
  // Safari decodes with ImageIO, whose reading of an Orientation that is not
  // a SHORT with count 1 is unverified.
  ['JPEG Orientation 6 as a big-endian LONG, unverified in ImageIO', jpeg({ app1: [exifApp1(tiff({ orientation: 6, entry: { type: 4 } }))] })],
  ['JPEG Orientation 6 as a little-endian LONG, unverified in ImageIO', jpeg({ app1: [exifApp1(tiff({ orientation: 6, entry: { type: 4 }, little: true }))] })],
  ['JPEG Orientation 6 as a SHORT with count 2, unverified in ImageIO', jpeg({ app1: [exifApp1(tiff({ orientation: 6, entry: { count: 2 } }))] })],
];
for (const [label, file] of disagreements) for (const orientation of [6, 1])
  test(`${label}: undistorted when the decoder ${orientation === 6 ? 'turns it' : 'shows it as stored'}`, async (t) => {
    const calls = engine(t, { orientation });
    const { image } = await importPhoto(new Blob([file]));
    assert.deepEqual(calls.map((c) => c.request), [[1200, undefined]], 'one width that fits 1600 either way round');
    assertUndistorted(image, calls[0]);
    assert.deepEqual([image.width, image.height], orientation === 6 ? [1200, 1600] : [1200, 900]);
  });

const cut = (block, length) => block.subarray(0, length);
const damaged = [
  ['IFD0 offset 0', jpeg({ app1: [exifApp1(tiff({ orientation: 6, ifdOffset: 0 }))] })],
  ['IFD0 offset past the EXIF block', jpeg({ app1: [exifApp1(tiff({ orientation: 6, ifdOffset: 0xfffffff0 }))] })],
  ['IFD0 entry count past the EXIF block', jpeg({ app1: [exifApp1(cut(tiff({ orientation: 6 }), 40))] })],
  ['a TIFF header cut to 4 bytes', jpeg({ app1: [exifApp1(bytes('MM\0*'))] })],
  ['an unknown TIFF byte order', jpeg({ app1: [exifApp1(tiff({ orientation: 6, order: 'XX' }))] })],
  ['a wrong TIFF magic number', jpeg({ app1: [exifApp1(tiff({ orientation: 6, magic: 43 }))] })],
  ['an ExifIFD pointer past the EXIF block', jpeg({ app1: [exifApp1(tiff({ exif: { orientation: 6, offset: 0x7fff } }))] })],
  ['two stray bytes after the frame header', jpeg({ afterSof: [Buffer.from([0, 0])] })],
  ['5000 comment segments, past the segment cap', jpeg({ afterSof: Array.from({ length: 5000 }, () => seg(0xfe, bytes('x'))) })],
  ['PNG eXIf cut to 6 bytes', png(cut(tiff({ orientation: 6 }), 6))],
  ['WebP EXIF with an unknown byte order', webp(tiff({ orientation: 6, order: 'XX' }))],
  ['WebP EXIF behind 5000 animation frames, past the chunk cap', webp(tiff({ orientation: 6 }), 5000)],
];
for (const [label, file] of damaged)
  test(`damaged EXIF (${label}) imports as stored through one width that fits either way round`, async (t) => {
    const calls = engine(t), blob = new Blob([file]);
    const { image } = await importPhoto(blob);
    assert.deepEqual(calls.map((c) => c.request), [[1200, undefined]]);
    assert.equal(calls[0].file, blob, 'nothing was rewritten: the original file is decoded');
    assertUndistorted(image, calls[0]);
    assert.deepEqual([image.width, image.height], [1200, 900]);
  });

test('a small photo with damaged EXIF decodes at its own size, never enlarged', async (t) => {
  const calls = engine(t, { natural: [1200, 900] });
  const { image } = await importPhoto(new Blob([jpeg({ w: 1200, h: 900, app1: [exifApp1(bytes('MM\0*'))] })]));
  assert.deepEqual(calls.map((c) => c.request), [[undefined, undefined]]);
  assert.deepEqual([image.width, image.height], [1200, 900]);
});

// The fixtures every engine reads the same way keep both bounded dimensions.
const agreements = [
  ['camera-style IFD0 JPEG, Orientation 1', jpeg({ app1: [exifApp1(tiff({ orientation: 1 }))] }), 1],
  ['camera-style IFD0 JPEG, Orientation 6, big-endian', jpeg({ app1: [exifApp1(tiff({ orientation: 6 }))] }), 6],
  ['camera-style IFD0 JPEG, Orientation 8, little-endian', jpeg({ app1: [exifApp1(tiff({ orientation: 8, little: true }))] }), 8],
  ['camera-style IFD0 JPEG, Orientation 6 in IFD0 and 1 in the ExifIFD', jpeg({ app1: [exifApp1(tiff({ orientation: 6, exif: { orientation: 1 } }))] }), 6],
  ['camera-style JPEG with an ExifIFD and no Orientation anywhere', jpeg({ app1: [exifApp1(tiff({ exif: {} }))] }), 1],
  // A SHORT outside 1..8, as Android writes 0, is shown as stored.
  ['camera-style IFD0 JPEG, Orientation SHORT 0', jpeg({ app1: [exifApp1(tiff({ orientation: 0 }))] }), 1],
  ['JFIF JPEG without EXIF', jpeg(), 1],
  ['PNG without eXIf', png(), 1],
  ['PNG eXIf Orientation 1', png(tiff({ orientation: 1 })), 1],
  // A flip or half turn keeps the axes whether or not the decoder applies it.
  ['PNG eXIf Orientation 3, a half turn', png(tiff({ orientation: 3 })), 3],
  ['JPEG Orientation 2 only in the ExifIFD, a flip', jpeg({ app1: [exifApp1(tiff({ exif: { orientation: 2 } }))] }), 2],
  // So do 1..4 behind a repeated or added identifier, which some engines read
  // and others ignore.
  ...[1, 2, 3, 4].flatMap((value) => [
    [`PNG eXIf Orientation ${value} behind an "Exif\\0\\0" prefix`, png(exifApp1(tiff({ orientation: value }))), value],
    [`JPEG APP1 whose "Exif\\0\\0" identifier is repeated, Orientation ${value}`, jpeg({ app1: [exifApp1(exifApp1(tiff({ orientation: value })))] }), value],
  ]),
];
for (const [label, file, orientation] of agreements)
  test(`${label}: both bounded dimensions at full size`, async (t) => {
    const calls = engine(t, { orientation }), want = orientation >= 5 ? [1200, 1600] : [1600, 1200];
    const { image } = await importPhoto(new Blob([file]));
    assert.deepEqual(calls.map((c) => c.request), [want]);
    assert.deepEqual([image.width, image.height], want);
  });

// The ExifIFD pointer is followed one level only, so a pointer back to IFD0
// ends the walk there and the photo imports as stored. A parser that followed
// it again would loop through promise callbacks, where no test timeout can
// fire, until memory ran out; the import calls `current` before every read,
// so a budget of 1000 calls ends such a loop as a cancelled import.
test('an ExifIFD pointer back to IFD0 is followed once, and the photo imports as stored', async (t) => {
  const calls = engine(t), file = jpeg({ app1: [exifApp1(tiff({ exif: { offset: 8 } }))] });
  let checks = 0;
  const { image } = await importPhoto(new Blob([file]), { current: () => ++checks <= 1000 });
  assert.deepEqual(calls.map((c) => c.request), [[1600, 1200]]);
  assert.deepEqual([image.width, image.height], [1600, 1200]);
});

for (const little of [false, true])
  test(`WebP Orientation 6 only in the ExifIFD is neutralized and turned once, little-endian ${little}`, async (t) => {
    const calls = engine(t), meta = tiff({ little, exif: { orientation: 6 } }), file = webp(meta);
    const { image } = await importPhoto(new Blob([file]));
    assert.deepEqual(calls.map((c) => c.request), [[1600, 1200]], 'decoded as stored');
    // IFD0 holds Make, Model, XResolution and the pointer; the ExifIFD that
    // follows it starts with the Orientation entry.
    const tag = file.indexOf(meta) + (8 + 2 + 4 * 12 + 4) + 2 + 8, normalized = Buffer.from(file);
    assert.equal(little ? file.readUInt16LE(tag) : file.readUInt16BE(tag), 6);
    if (little) normalized.writeUInt16LE(1, tag); else normalized.writeUInt16BE(1, tag);
    assert.deepEqual(calls[0].bytes, normalized, 'only the ExifIFD orientation value changes');
    assert.deepEqual([image.width, image.height], [1200, 1600]);
  });

// An ExifIFD pointer is a LONG or an IFD (type 13) with count 1; with any
// other count the entry is not followed. Followed, the ExifIFD's Orientation 6
// turns a WebP (neutralized, then turned once) and gives a JPEG the single
// width (WebKit reads IFD0 only); not followed, both import as stored.
for (const [label, type, count, followed] of [['an IFD (type 13) with count 1', 13, 1, true], ['a LONG with count 2', 4, 2, false]]) {
  test(`WebP: an ExifIFD pointer that is ${label} is ${followed ? '' : 'not '}followed`, async (t) => {
    const calls = engine(t);
    const { image } = await importPhoto(new Blob([webp(tiff({ exif: { orientation: 6, type, count } }))]));
    assert.deepEqual(calls.map((c) => c.request), [[1600, 1200]], 'decoded as stored');
    assert.deepEqual([image.width, image.height], followed ? [1200, 1600] : [1600, 1200]);
  });
  test(`JPEG: an ExifIFD pointer that is ${label} is ${followed ? '' : 'not '}followed`, async (t) => {
    const calls = engine(t);
    await importPhoto(new Blob([jpeg({ app1: [exifApp1(tiff({ exif: { orientation: 6, type, count } }))] })]));
    assert.deepEqual(calls.map((c) => c.request), [followed ? [1200, undefined] : [1600, 1200]]);
  });
}

// The refusal advises re-saving the photo, not exporting it as JPEG: the
// file is already a JPEG, PNG or WebP.
const refusal = { message: 'The photo orientation could not be checked safely. Save a copy from your photo app, then try again.' };
test('a JPEG segment that runs past the end of the file is still refused before any decoder', async (t) => {
  const calls = engine(t), file = jpeg({ afterSof: [Buffer.from([0xff, 0xfe, 0x40, 0x00])] });
  await assert.rejects(importPhoto(new Blob([file])), refusal);
  assert.equal(calls.length, 0);
});
// A PNG eXIf or WebP EXIF chunk whose length field claims 64 KB more than the
// file holds; the WebP's RIFF container ends with the file.
function stretch(file, kind, png) {
  const b = Buffer.from(file), at = b.indexOf(kind) + (png ? -4 : 4);
  if (png) b.writeUInt32BE(b.readUInt32BE(at) + 0x10000, at); else b.writeUInt32LE(b.readUInt32LE(at) + 0x10000, at);
  return b;
}
for (const [label, file] of [['PNG eXIf', stretch(png(tiff({ orientation: 6 })), 'eXIf', true)],
  ['WebP EXIF', stretch(webp(tiff({ orientation: 6 })), 'EXIF', false)]])
  test(`a ${label} chunk that runs past the end of the file is refused before any decoder`, async (t) => {
    const calls = engine(t);
    await assert.rejects(importPhoto(new Blob([file])), refusal);
    assert.equal(calls.length, 0);
  });
