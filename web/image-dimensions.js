// Read only a bounded header, before any browser pixel decoding. Unknown or
// incomplete headers are not permission to perform an unbounded full decode.
// WebP container/bitstream layouts: https://developers.google.com/speed/webp/docs/riff_container
const JPEG_FRAMES = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const fourcc = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
// A HEIC photo (an iPhone's own format) is HEIF, ISO/IEC 23008-12: a 'ftyp'
// box with a HEIF brand first. AVIF shares the layout and the mif1 brand, and
// stays out.
export function isHeic(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || fourcc(bytes, 4) !== "ftyp") return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0), brands = [fourcc(bytes, 8)];
  for (let at = 16; at + 4 <= Math.min(size, bytes.length); at += 4) brands.push(fourcc(bytes, at));
  return brands.some((b) => ["heic", "heix", "mif1"].includes(b)) && !brands.some((b) => ["avif", "avis"].includes(b));
}
// HEIF's boxes (ISO/IEC 14496-12) after 'ftyp': the 'meta' box names the
// primary item ('pitm', on an iPhone a 'grid' of tiles), keeps the item
// properties in 'iprp': 'ipco' holds them and 'ipma' says which belong to which
// item. The primary item's 'ispe' is the photo's size before its 'irot' (a turn
// by quarters) and 'imir' (a mirror) apply; thumbnails, tiles and gain maps
// carry their own. `turned` says that irot turns the photo a quarter, so that
// the browser shows it height by width. The meta box must lie in what was read.
function heif(bytes, fileSize) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = (at, end) => {
    if (at + 8 > end) return null;
    let size = view.getUint32(at), length = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      size = view.getUint32(at + 8) * 2 ** 32 + view.getUint32(at + 12); length = 16;
    } else if (size === 0) size = end - at;
    return size < length ? null : { type: fourcc(bytes, at + 4), at: at + length, end: at + size };
  };
  const children = (start, end) => {
    const found = [];
    for (let at = start; at < end; at = found.at(-1).end) {
      const box = header(at, end);
      if (!box || box.end > end || found.length >= 4096) return null;
      found.push(box);
    }
    return found;
  };
  let meta = null;
  for (let at = 0, count = 0; !meta; count++) {
    // A header past what was read (a 'mdat' before 'meta') is refused.
    const box = at + 16 <= bytes.length || at + 8 <= bytes.length && view.getUint32(at) !== 1 ? header(at, fileSize) : null;
    if (!box || box.end > fileSize || count >= 64 || (count === 0) !== (box.type === "ftyp")) return null;
    if (box.type === "meta") meta = box;
    at = box.end;
  }
  // 'meta' is a full box (4 bytes of version and flags), version 0.
  if (meta.end > bytes.length || meta.at + 4 > meta.end || bytes[meta.at] !== 0) return null;
  const items = children(meta.at + 4, meta.end), find = (list, type) => list?.filter((b) => b.type === type) ?? [];
  const [hdlr] = find(items, "hdlr"), [pitm] = find(items, "pitm"), [iprp] = find(items, "iprp");
  if (!hdlr || !pitm || !iprp || hdlr.at + 12 > hdlr.end || fourcc(bytes, hdlr.at + 8) !== "pict") return null;
  const wide = bytes[pitm.at] !== 0;
  if (pitm.at + (wide ? 8 : 6) > pitm.end) return null;
  const primary = wide ? view.getUint32(pitm.at + 4) : view.getUint16(pitm.at + 4);
  const parts = children(iprp.at, iprp.end), [ipco] = find(parts, "ipco");
  const properties = ipco && children(ipco.at, ipco.end);
  if (!properties) return null;
  // The primary item's properties in their association order.
  const own = [];
  for (const ipma of find(parts, "ipma")) {
    if (ipma.at + 8 > ipma.end) return null;
    const version = bytes[ipma.at], large = bytes[ipma.at + 3] & 1, count = view.getUint32(ipma.at + 4);
    let at = ipma.at + 8;
    for (let entry = 0; entry < count; entry++) {
      if (at + (version ? 5 : 3) > ipma.end) return null;
      const item = version ? view.getUint32(at) : view.getUint16(at);
      at += version ? 4 : 2;
      const associations = bytes[at++];
      if (at + associations * (large ? 2 : 1) > ipma.end) return null;
      for (let i = 0; i < associations; i++, at += large ? 2 : 1) {
        const index = large ? view.getUint16(at) & 0x7fff : bytes[at] & 0x7f;
        if (item !== primary || index === 0) continue;
        if (index > properties.length) return null;
        own.push(properties[index - 1]);
      }
    }
  }
  const sizes = own.filter((p) => p.type === "ispe");
  // ispe is a full box: version and flags, then the width and height.
  if (sizes.length !== 1 || sizes[0].at + 12 > sizes[0].end) return null;
  let quarters = 0;
  for (const p of own) {
    if (p.at + 1 > p.end) { if (p.type === "irot" || p.type === "imir") return null; continue; }
    if (p.type === "irot") quarters += bytes[p.at] & 3;
  }
  return { width: view.getUint32(sizes[0].at + 4), height: view.getUint32(sizes[0].at + 8), heif: { turned: quarters % 2 === 1 } };
}
export function sniffDimensions(bytes, fileSize = bytes?.length) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (isHeic(bytes)) return heif(bytes, fileSize);
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
