// image-dimensions.js: header sniffing for PNG, JPEG, WebP and HEIC before any decode.
import assert from "node:assert/strict";
import test from "node:test";
import { sniffDimensions, isHeic } from "../image-dimensions.js";
import { heic, box, u32 } from "./heif-fixture.js";

test("sniffing dimensions of a missing buffer returns null", () => {
  assert.equal(sniffDimensions(null), null);
  assert.equal(sniffDimensions(undefined), null);
});

function webp(kind, width, height, prefix = false) {
  const size = kind === "VP8L" ? 5 : 10, extra = prefix ? 10 : 0,
    bytes = new Uint8Array(20 + size + size % 2 + extra), view = new DataView(bytes.buffer);
  const text = (at, s) => [...s].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
  text(0, "RIFF"); text(8, "WEBP"); view.setUint32(4, bytes.length - 8, true);
  if (prefix) { text(12, "TEST"); view.setUint32(16, 1, true); }
  const at = 12 + extra, data = at + 8;
  text(at, kind); view.setUint32(at + 4, size, true);
  if (kind === "VP8L") { bytes[data] = 0x2f; view.setUint32(data + 1, (width - 1) | ((height - 1) << 14), true); }
  else if (kind === "VP8 ") { text(data + 3, "\x9d\x01\x2a"); view.setUint16(data + 6, width, true); view.setUint16(data + 8, height, true); }
  else for (const [pos, value] of [[data + 4, width - 1], [data + 7, height - 1]])
    for (let i = 0; i < 3; i++) bytes[pos + i] = (value >>> (i * 8)) & 255;
  return bytes;
}

for (const kind of ["VP8 ", "VP8L", "VP8X"])
  test(`${kind} dimensions are read, including padded preceding chunks and nonzero byte offsets`, () => {
    for (const prefix of [false, true]) {
      const bytes = webp(kind, 6000, 4000, prefix), padded = new Uint8Array(bytes.length + 7);
      padded.set(bytes, 7);
      assert.deepEqual(sniffDimensions(padded.subarray(7)), { width: 6000, height: 4000 });
      for (let end = 0; end < bytes.length - 2; end++)
        assert.doesNotThrow(() => sniffDimensions(bytes.subarray(0, end), bytes.length));
    }
  });

test("truncated, forged and unrecognized image headers are rejected", () => {
  const bytes = webp("VP8L", 6000, 6000);
  assert.equal(sniffDimensions(bytes.subarray(0, 24), bytes.length), null);
  new DataView(bytes.buffer).setUint32(16, 1000, true);
  assert.equal(sniffDimensions(bytes), null);
  assert.equal(sniffDimensions(new TextEncoder().encode('<svg width="99999"/>')), null);
  assert.equal(sniffDimensions(Uint8Array.of(137, 80, 78, 71, ...Array(20).fill(0))), null);
});

// HEIC: the primary item's ispe, never a tile's or the thumbnail's, and
// whether its irot turns it a quarter (imir, a mirror, keeps the axes).
for (let rotation = 0; rotation < 4; rotation++)
  test(`HEIC: the primary item's size, and irot ${rotation} ${rotation % 2 ? "turns" : "keeps"} its axes`, () => {
    for (const mirror of [null, 0, 1]) for (const transforms of [["irot", "imir"], ["imir", "irot"]]) {
      const bytes = heic({ rotation, mirror, transforms }), padded = new Uint8Array(bytes.length + 5);
      padded.set(bytes, 5);
      assert.deepEqual(sniffDimensions(padded.subarray(5)), { width: 4032, height: 3024, heif: { turned: rotation % 2 === 1 } });
    }
  });

test("HEIC: no irot keeps the axes; the brands and box versions iPhones and other writers use are read", () => {
  const expected = { width: 5712, height: 4284, heif: { turned: false } };
  for (const options of [{}, { major: "mif1", compatible: ["heic"] }, { major: "heix", compatible: [] },
    { pitmVersion: 1, primary: 7 }, { ipmaVersion: 1, pitmVersion: 1, primary: 70000 }, { largeIndices: true },
    // A box with a 64-bit size before 'meta'.
    { before: [Buffer.concat([u32(1), Buffer.from("free"), u32(0), u32(24), Buffer.alloc(8)])] }])
    assert.deepEqual(sniffDimensions(heic({ width: 5712, height: 4284, ...options })), expected, JSON.stringify(options));
  assert.equal(isHeic(heic()), true);
});

test("AVIF shares the layout and the mif1 brand, and is not taken for HEIC", () => {
  const avif = heic({ major: "avif", compatible: ["mif1", "miaf"] });
  assert.equal(isHeic(avif), false); assert.equal(sniffDimensions(avif), null);
});

test("a HEIC header that is truncated, damaged or ambiguous gives no dimensions", () => {
  // The image data (72 bytes with its header, at the end) may stay unread;
  // any part of the meta box may not.
  const whole = heic({ rotation: 1 }), meta = whole.length - 72;
  for (let end = 0; end < whole.length; end++) {
    const found = sniffDimensions(whole.subarray(0, end), whole.length);
    assert.deepEqual(found, end < meta ? null : { width: 4032, height: 3024, heif: { turned: true } }, `cut at ${end}`);
  }
  const far = heic({ before: [box("mdat", Buffer.alloc(600000))] });
  const cases = {
    "pitm names an item without properties": [heic({ pitmItem: 9 })],
    "no ispe for the primary item": [heic({ primarySizes: 0 })],
    "two ispe for the primary item": [heic({ primarySizes: 2 })],
    "a property index past ipco": [heic({ extraIndex: 40 })],
    "a handler other than pict": [heic({ hdlr: "vide" })],
    // 'meta' after a large 'mdat', past the 512 KB the import reads.
    "meta beyond what was read": [far.subarray(0, 512 * 1024), far.length],
  };
  for (const [name, [bytes, size = bytes.length]] of Object.entries(cases)) assert.equal(sniffDimensions(bytes, size), null, name);
  // 'meta' (after the 24-byte 'ftyp') whose size is below its own header, or
  // runs past the file; and a 'meta' of another version than 0.
  for (const size of [7, 0x7fffffff]) {
    const bytes = heic(); new DataView(bytes.buffer).setUint32(24, size);
    assert.equal(sniffDimensions(bytes), null, `meta size ${size}`);
  }
  const version = heic(); version[24 + 8] = 1;
  assert.equal(sniffDimensions(version), null);
  // 'ftyp' must come first.
  const late = new Uint8Array(Buffer.concat([box("free", Buffer.alloc(4)), Buffer.from(heic())]));
  assert.equal(isHeic(late), false); assert.equal(sniffDimensions(late), null);
});
