// image-dimensions.js: header sniffing for PNG, JPEG and WebP before any decode.
import assert from "node:assert/strict";
import test from "node:test";
import { sniffDimensions } from "../image-dimensions.js";

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
