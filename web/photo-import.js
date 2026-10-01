import { sniffDimensions } from './image-dimensions.js';
import { retainPhotoSource, withPhotoDecode } from './photo-detail.js';

export const PHOTO_MAX_SIDE = 1600;
const HEADER_LIMIT = 512 * 1024;
const cancelled = () => new DOMException('Scan cancelled', 'AbortError');
const orientationError = () => Error('The photo orientation could not be checked safely. Export it as JPEG, PNG or WebP, then try again.');

// Only the primary image's TIFF orientation is needed, never its thumbnail or
// other EXIF data. JPEG/PNG metadata precedes the pixel stream; WebP may put it
// after the bitstream, so skip chunk payloads rather than loading the whole file.
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
  async function tiff(start, end) {
    // WebP encoders use both bare TIFF and the JPEG "Exif\0\0" prefix.
    if (end - start >= 6 && text(await read(start, 6)) === 'Exif\0\0') start += 6;
    if (end - start < 8) throw orientationError();
    const header = view(await read(start, 8)), order = header.getUint16(0), little = order === 0x4949;
    if ((!little && order !== 0x4d4d) || header.getUint16(2, little) !== 42) throw orientationError();
    const offset = header.getUint32(4, little), at = start + offset;
    if (offset < 8 || at + 2 > end) throw orientationError();
    const count = view(await read(at, 2)).getUint16(0, little);
    if (count > 4096 || at + 2 + count * 12 > end) throw orientationError();
    const entries = view(await read(at + 2, count * 12));
    for (let i = 0; i < count * 12; i += 12) {
      if (entries.getUint16(i, little) !== 0x0112) continue;
      const value = entries.getUint16(i + 8, little);
      if (entries.getUint16(i + 2, little) !== 3 || entries.getUint32(i + 4, little) !== 1 || value < 1 || value > 8)
        throw orientationError();
      return value;
    }
    return 1;
  }
  const jpeg = head[0] === 0xff && head[1] === 0xd8, png = head[0] === 137;
  const end = jpeg || png ? file.size : view(head).getUint32(4, true) + 8;
  let at = jpeg ? 2 : png ? 8 : 12;
  for (let chunks = 0; at < end && chunks < 4096; chunks++) {
    if (jpeg) {
      const marker = await read(at, 2);
      if (marker[0] !== 0xff) throw orientationError();
      if (marker[1] === 0xda || marker[1] === 0xd9) return 1;
      if (marker[1] === 0xff) { at++; continue; }
      if (marker[1] === 0x01 || (marker[1] >= 0xd0 && marker[1] <= 0xd8)) { at += 2; continue; }
      const length = view(await read(at + 2, 2)).getUint16(0), next = at + 2 + length;
      if (length < 2 || next > end) throw orientationError();
      if (marker[1] === 0xe1 && length >= 8 && text(await read(at + 4, 6)) === 'Exif\0\0')
        return tiff(at + 10, next);
      at = next;
    } else {
      const header = await read(at, 8), v = view(header), length = v.getUint32(png ? 0 : 4, !png),
        kind = text(header.subarray(png ? 4 : 0, png ? 8 : 4)), next = at + 8 + length + (png ? 4 : length % 2);
      if (next > end) throw orientationError();
      if (kind === (png ? 'eXIf' : 'EXIF')) return tiff(at + 8, at + 8 + length);
      if (png && (kind === 'IDAT' || kind === 'IEND')) return 1;
      at = next;
    }
  }
  if (at !== end) throw orientationError();
  return 1;
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
  const draw = (source, width = source.width, height = source.height) => {
    if (!width || !height) throw Error('The image is empty.');
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = fit(width, height);
    try {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return { image: retainPhotoSource(canvas, file, dimensions), dimensions };
    } catch (error) { canvas.width = canvas.height = 0; throw error; }
  };
  const turned = await orientation(file, head, check) >= 5;
  check();
  return withPhotoDecode(async () => {
    if (typeof createImageBitmap === 'function') {
      // Resizing uses the EXIF-oriented axes. Request BOTH bounded dimensions:
      // using encoded width alone could enlarge a 1600x400 image to 1600x6400.
      const [resizeWidth, resizeHeight] = turned ? fit(dimensions.height, dimensions.width) : fit(dimensions.width, dimensions.height);
      let bitmap = null;
      try { bitmap = await createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high', imageOrientation: 'from-image' }); }
      catch { /* A bounded full decode remains available on older browsers. */ }
      if (bitmap) try { check(); return draw(bitmap); } finally { bitmap.close?.(); }
    }
    check();
    if (pixels > 24e6) throw Error('This browser cannot downscale this large photo safely. Crop it in your photo app first, then try again.');
    const url = URL.createObjectURL(file);
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
