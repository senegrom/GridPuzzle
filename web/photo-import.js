import { sniffDimensions } from './image-dimensions.js';
import { retainPhotoSource, withPhotoDecode, transformPhotoContext } from './photo-detail.js';

export const PHOTO_MAX_SIDE = 1600;
const HEADER_LIMIT = 512 * 1024;
const cancelled = () => new DOMException('Scan cancelled', 'AbortError');
const orientationError = () => Error('The photo orientation could not be checked safely. Save a copy from your photo app, then try again.');
// Damaged or out-of-reach EXIF, or an Orientation entry an engine may read its
// own way: the browser shows the photo as stored or as it reads it, so the
// import must fit either way round instead of refusing.
const UNKNOWN = { value: 1, unknown: true };

// Only the primary image's TIFF orientation is needed, never its thumbnail or
// other EXIF data. JPEG/PNG metadata precedes the pixel stream; WebP may put it
// after the bitstream, so skip chunk payloads rather than loading the whole file.
// `primary` marks a usable SHORT in IFD0 behind a standard identifier, which
// every engine reads in a JPEG. Only a segment or chunk that runs past the end
// of its container is still refused.
// PNG ordering: https://www.w3.org/TR/png-3/#5ChunkOrdering
// WebP layout: https://developers.google.com/speed/webp/docs/riff_container
async function orientation(file, head, check) {
  let extra = 0;
  const read = async (at, length) => {
    check();
    if (!Number.isSafeInteger(at) || at < 0 || length < 0 || at + length > file.size) throw orientationError();
    if (at + length <= head.length) return head.subarray(at, at + length);
    extra += length;
    if (extra > HEADER_LIMIT) throw orientationError();
    const bytes = new Uint8Array(await file.slice(at, at + length).arrayBuffer());
    check();
    if (bytes.length !== length) throw orientationError();
    return bytes;
  };
  const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = bytes => String.fromCharCode(...bytes);
  const jpeg = head[0] === 0xff && head[1] === 0xd8, png = head[0] === 137;
  async function tiff(start, end) {
    // WebP encoders use both bare TIFF and the JPEG "Exif\0\0" prefix. JPEG APP1
    // and PNG eXIf data must start with the TIFF header: the engines ignore a
    // repeated or prefixed identifier there, and so does this parser.
    if (!jpeg && !png && end - start >= 6 && text(await read(start, 6)) === 'Exif\0\0') start += 6;
    if (end - start < 8) return UNKNOWN;
    const header = view(await read(start, 8)), order = header.getUint16(0), little = order === 0x4949;
    if ((!little && order !== 0x4d4d) || header.getUint16(2, little) !== 42) return UNKNOWN;
    // IFD0 first. Like Chromium and Firefox, fall back to the ExifIFD (one level)
    // when IFD0 has no usable entry; WebKit does not, so that value is not primary.
    async function ifd(offset, primary) {
      const at = start + offset;
      if (offset < 8 || at + 2 > end) return UNKNOWN;
      const count = view(await read(at, 2)).getUint16(0, little);
      if (count > 4096 || at + 2 + count * 12 > end) return UNKNOWN;
      const entries = view(await read(at + 2, count * 12));
      let exifIfd = null;
      for (let i = 0; i < count * 12; i += 12) {
        const tag = entries.getUint16(i, little), type = entries.getUint16(i + 2, little), n = entries.getUint32(i + 4, little);
        if (primary && tag === 0x8769 && exifIfd === null && (type === 4 || type === 13) && n === 1)
          exifIfd = entries.getUint32(i + 8, little);
        if (tag !== 0x0112) continue;
        // Not a SHORT with count 1 (a LONG 6, two SHORTs): Safari decodes with
        // ImageIO, whose reading of such an entry is unverified, and a squeeze
        // would be visible, so fit either way round.
        if (type !== 3 || n !== 1) return UNKNOWN;
        const value = entries.getUint16(i + 8, little);
        // Chromium, Firefox and WebKit ignore a SHORT outside 1..8 (Android
        // writes 0, 9 or 65535) and show the image as stored.
        if (value < 1 || value > 8) continue;
        return { value, offset: at + 2 + i + 8, little, primary };
      }
      return exifIfd === null ? { value: 1 } : ifd(exifIfd, false);
    }
    return ifd(header.getUint32(4, little), true);
  }
  const end = jpeg || png ? file.size : view(head).getUint32(4, true) + 8;
  let at = jpeg ? 2 : png ? 8 : 12;
  for (let chunks = 0; at < end && chunks < 4096; chunks++) {
    if (jpeg) {
      const marker = await read(at, 2);
      // libjpeg skips stray bytes between segments, and an orientation could follow.
      if (marker[0] !== 0xff) return UNKNOWN;
      if (marker[1] === 0xda || marker[1] === 0xd9) return { value: 1 };
      if (marker[1] === 0xff) { at++; continue; }
      if (marker[1] === 0x01 || (marker[1] >= 0xd0 && marker[1] <= 0xd8)) { at += 2; continue; }
      const length = view(await read(at + 2, 2)).getUint16(0), next = at + 2 + length;
      if (length < 2 || next > end) throw orientationError();
      if (marker[1] === 0xe1 && length >= 8) {
        // Chromium and WebKit accept any sixth identifier byte; Firefox needs "Exif\0\0".
        const id = await read(at + 4, 6);
        if (text(id.subarray(0, 5)) === 'Exif\0') {
          const meta = await tiff(at + 10, next);
          return id[5] === 0 ? meta : { ...meta, primary: false };
        }
      }
      at = next;
    } else {
      const header = await read(at, 8), v = view(header), length = v.getUint32(png ? 0 : 4, !png),
        kind = text(header.subarray(png ? 4 : 0, png ? 8 : 4)), next = at + 8 + length + (png ? 4 : length % 2);
      if (next > end) throw orientationError();
      if (kind === (png ? 'eXIf' : 'EXIF')) return tiff(at + 8, at + 8 + length);
      if (png && (kind === 'IDAT' || kind === 'IEND')) return { value: 1 };
      at = next;
    }
  }
  // Only the 4096 segment or chunk cap stops short of the end; an orientation could follow.
  return at < end ? UNKNOWN : { value: 1 };
}

// Shared by photo-file, native-file and the corpus photo-flow benchmark. Bounds
// apply before either decoder, including when ImageBitmap resizing is absent.
export async function importPhoto(file, { current = () => true, maxSide = PHOTO_MAX_SIDE } = {}) {
  const check = () => { if (!current()) throw cancelled(); };
  check();
  if (!Number.isInteger(maxSide) || maxSide < 1 || maxSide > PHOTO_MAX_SIDE) throw Error('Invalid photo preview size.');
  if (file.size > 30 * 1024 * 1024) throw Error('Please choose a photo smaller than 30 MB.');
  const head = new Uint8Array(await file.slice(0, HEADER_LIMIT).arrayBuffer()), dimensions = sniffDimensions(head, file.size);
  check();
  if (!dimensions) throw Error('The photo dimensions could not be checked safely. Export it as JPEG, PNG or WebP, then try again.');
  const pixels = dimensions.width * dimensions.height;
  if (dimensions.width < 1 || dimensions.height < 1) throw Error('The image is empty.');
  if (pixels > 120e6) throw Error('This photo is too large to decode safely on a phone. Use a smaller camera resolution or crop it first.');
  const fit = (width, height) => {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  };
  const meta = await orientation(file, head, check);
  check();
  let decodeFile = file, turns = 0, mirrored = false;
  const webp = head[0] === 82 && head[1] === 73; // sniffDimensions validated RIFF/WEBP.
  if (webp && meta.value !== 1) {
    // WebP decoders differ in whether they apply EXIF. Neutralize ONLY the
    // orientation tag that was read, without decoding/re-encoding or copying pixels,
    // then apply the declared transform exactly once. Retain the same encoded
    // source and transform for original-detail reads and subsequent user turns.
    const normal = new Uint8Array(meta.little ? [1, 0] : [0, 1]);
    decodeFile = new Blob([file.slice(0, meta.offset), normal, file.slice(meta.offset + 2)], { type: 'image/webp' });
    turns = [0, 0, 0, 2, 2, 3, 1, 1, 3][meta.value];
    mirrored = [2, 4, 5, 7].includes(meta.value);
  }
  const draw = (source, width = source.width, height = source.height) => {
    if (!width || !height) throw Error('The image is empty.');
    const canvas = document.createElement('canvas');
    const [w, h] = fit(width, height);
    [canvas.width, canvas.height] = turns % 2 ? [h, w] : [w, h];
    try {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      transformPhotoContext(ctx, w, h, turns, mirrored);
      ctx.drawImage(source, 0, 0, w, h);
      return { image: retainPhotoSource(canvas, decodeFile, dimensions, { turns, mirrored }), dimensions };
    } catch (error) { canvas.width = canvas.height = 0; throw error; }
  };
  // A flip or half turn (2..4) keeps the photo's axes, whoever applies it. A
  // quarter turn (5..8) is known only where every engine agrees: a WebP decoded
  // as stored after neutralizing, or a primary IFD0 SHORT in a JPEG. Engines
  // differ on damaged EXIF, on PNG eXIf (WebKitGTK ignores it) and on an
  // ExifIFD-only orientation. There, request one width that fits maxSide
  // whichever way the engine turns the photo, so the bitmap keeps the engine's
  // own aspect ratio, and let draw() fit it.
  let size;
  if (!meta.unknown && (meta.value < 5 || webp || (head[0] === 0xff && meta.primary))) {
    // Resizing uses the EXIF-oriented axes. Request BOTH bounded dimensions:
    // using encoded width alone could enlarge a 1600x400 image to 1600x6400.
    const [resizeWidth, resizeHeight] = !webp && meta.value >= 5 ? fit(dimensions.height, dimensions.width) : fit(dimensions.width, dimensions.height);
    size = { resizeWidth, resizeHeight };
  } else {
    const long = Math.max(dimensions.width, dimensions.height);
    size = long > maxSide ? { resizeWidth: Math.max(1, Math.round(maxSide * Math.min(dimensions.width, dimensions.height) / long)) } : {};
  }
  check();
  return withPhotoDecode(async () => {
    if (typeof createImageBitmap === 'function') {
      let bitmap = null;
      try { bitmap = await createImageBitmap(decodeFile, { ...size, resizeQuality: 'high', imageOrientation: 'from-image' }); }
      catch { /* A bounded full decode remains available on older browsers. */ }
      if (bitmap) try { check(); return draw(bitmap); } finally { bitmap.close?.(); }
    }
    check();
    if (pixels > 24e6) throw Error('This browser cannot downscale this large photo safely. Crop it in your photo app first, then try again.');
    const url = URL.createObjectURL(decodeFile);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      check();
      // HTMLImageElement.width can be a CSS/layout size; always use natural pixels.
      return draw(image, image.naturalWidth, image.naturalHeight);
    } finally { URL.revokeObjectURL(url); }
  }, current);
}
