// Crafted HEIF (HEIC) headers for the import tests: ISO/IEC 23008-12 boxes
// laid out as an iPhone writes them, a 'grid' primary item over 512 x 512
// tiles with a thumbnail beside it, followed by a stand-in for the image data.
// Nothing here decodes; the tests give the decoder stubs the declared photo.
const bytes = (part) => (typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part));
export const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export function box(type, ...parts) {
  const body = Buffer.concat(parts.map(bytes)), head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length); head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}
export const full = (type, version, flags, ...parts) =>
  box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
// `rotation` is irot's angle in quarter turns (anticlockwise) and `mirror`
// imir's axis; `transforms` orders them as the photo's associations list them.
// The photo is item `primary`, which 'pitm' names unless `pitmItem` names
// another. `data` bytes of image data follow the meta box (64 by default).
export function heic({ width = 4032, height = 3024, rotation = null, mirror = null, transforms = ["irot", "imir"],
  major = "heic", compatible = ["mif1", "heic"], primary = 1, pitmItem = primary, pitmVersion = 0, ipmaVersion = 0,
  largeIndices = false, before = [], data = 64, hdlr = "pict", primarySizes = 1, extraIndex = null } = {}) {
  const ftyp = box("ftyp", major, u32(0), ...compatible);
  const properties = [box("hvcC", Buffer.alloc(23)), full("ispe", 0, 0, u32(512), u32(512)),
    full("ispe", 0, 0, u32(320), u32(240))];
  const own = [];
  for (let i = 0; i < primarySizes; i++) { properties.push(full("ispe", 0, 0, u32(width), u32(height))); own.push(properties.length); }
  for (const kind of transforms) {
    if (kind === "irot" && rotation !== null) { properties.push(box("irot", [rotation])); own.push(properties.length); }
    if (kind === "imir" && mirror !== null) { properties.push(box("imir", [mirror])); own.push(properties.length); }
  }
  if (extraIndex !== null) own.push(extraIndex);
  // Item 2 is a tile and item 3 the thumbnail; the tiles come first, as they do.
  const entries = [[2, [1, 2]], [primary, own], [3, [1, 3]]];
  const id = (n) => (ipmaVersion ? u32(n) : u16(n)), index = (n, essential) =>
    largeIndices ? u16((essential ? 0x8000 : 0) | n) : Buffer.from([(essential ? 0x80 : 0) | n]);
  const ipma = full("ipma", ipmaVersion, largeIndices ? 1 : 0, u32(entries.length),
    ...entries.map(([item, list]) => Buffer.concat([id(item), Buffer.from([list.length]), ...list.map((n, i) => index(n, i === 0))])));
  const meta = full("meta", 0, 0,
    full("hdlr", 0, 0, u32(0), hdlr, u32(0), u32(0), u32(0), [0]),
    full("pitm", pitmVersion, 0, pitmVersion ? u32(pitmItem) : u16(pitmItem)),
    full("iinf", 0, 0, u16(0)),
    box("iprp", box("ipco", ...properties), ipma));
  return new Uint8Array(Buffer.concat([ftyp, ...before, meta, box("mdat", Buffer.alloc(data))]));
}
