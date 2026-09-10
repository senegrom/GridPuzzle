// Read only a bounded header, before any browser pixel decoding. Unknown or
// incomplete headers are not permission to perform an unbounded full decode.
// WebP container/bitstream layouts: https://developers.google.com/speed/webp/docs/riff_container
const JPEG_FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
export function sniffDimensions(bytes, fileSize = bytes.length) {
  if (!(bytes instanceof Uint8Array)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, value) => at + value.length <= bytes.length &&
    [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  const u24 = (at) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  if (bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) &&
      view.getUint32(8) === 13 && text(12, "IHDR"))
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 20 && text(0, "RIFF") && text(8, "WEBP")) {
    const end = view.getUint32(4, true) + 8;
    if (end > fileSize || end < 20 || end % 2) return null;
    for (let at = 12; at + 8 <= Math.min(end, bytes.length); ) {
      const size = view.getUint32(at + 4, true), data = at + 8,
        next = data + size + (size % 2);
      if (next > end) return null;
      if (text(at, "VP8X")) {
        if (size !== 10 || data + 10 > bytes.length) return null;
        return { width: 1 + u24(data + 4), height: 1 + u24(data + 7) };
      }
      if (text(at, "VP8L")) {
        if (size < 5 || data + 5 > bytes.length || bytes[data] !== 0x2f) return null;
        const bits = view.getUint32(data + 1, true);
        if (bits >>> 29) return null;
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
      }
      if (text(at, "VP8 ")) {
        if (size < 10 || data + 10 > bytes.length || (bytes[data] & 1) ||
            !text(data + 3, "\x9d\x01\x2a")) return null;
        return {
          width: view.getUint16(data + 6, true) & 0x3fff,
          height: view.getUint16(data + 8, true) & 0x3fff,
        };
      }
      at = next;
    }
    return null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 3 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = view.getUint16(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) return null;
    if (JPEG_FRAMES.has(marker)) {
      if (length < 8) return null;
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}
