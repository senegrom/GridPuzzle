import { validQuad } from './geometry.js';

// Encoded files, not decoded megapixel canvases. Weak ownership follows the
// preview through rotation and disappears when that photograph is discarded.
const sources = new WeakMap();
export const DETAIL_PIXEL_LIMIT = 16_000_000, DETAIL_SIDE = 1800;
// One original-resolution decode at a time bounds memory. A read queues behind
// an earlier decode instead of degrading to the preview: a superseded read's
// decode cannot be cancelled, but its bitmap is closed as soon as it arrives,
// and a read superseded while it waits never decodes at all. A decoder that
// never answers only costs a later read DECODE_WAIT, then the preview.
let decodeQueue = Promise.resolve();
const DECODE_WAIT = 15000;
export function retainPhotoSource(preview, file, dimensions) {
  if (preview && file && dimensions) sources.set(preview, { file, dimensions, turns: 0 });
  return preview;
}
export const hasPhotoSource = (preview) => sources.has(preview);
export function rotatePhotoSource(previous, next) {
  const source = sources.get(previous);
  if (source) sources.set(next, { ...source, turns: (source.turns + 1) % 4 });
}
export function turnPoint({ x, y }, width, height, turns) {
  for (let i = 0; i < turns; i++) {
    [x, y] = [height - 1 - y, x];
    [width, height] = [height, width];
  }
  return { x, y };
}
export function detailPlan(preview, corners, width, height, turns = 0) {
  if (!validQuad(corners, preview.width, preview.height) ||
      ![width, height].every((n) => Number.isInteger(n) && n > 1) ||
      width * height > DETAIL_PIXEL_LIMIT || !Number.isInteger(turns) || turns < 0 || turns > 3) return null;
  const original = corners.map((p) => {
    const pt = turnPoint(p, preview.width, preview.height, (4 - turns) % 4),
      pw = turns % 2 ? preview.height : preview.width,
      ph = turns % 2 ? preview.width : preview.height;
    return { x: pt.x * (width - 1) / (pw - 1), y: pt.y * (height - 1) / (ph - 1) };
  });
  const x = Math.max(0, Math.floor(Math.min(...original.map((p) => p.x))) - 2),
    y = Math.max(0, Math.floor(Math.min(...original.map((p) => p.y))) - 2),
    w = Math.min(width, Math.ceil(Math.max(...original.map((p) => p.x))) + 3) - x,
    h = Math.min(height, Math.ceil(Math.max(...original.map((p) => p.y))) + 3) - y,
    scale = Math.min(1, DETAIL_SIDE / Math.max(w, h)),
    outWidth = Math.max(2, Math.round(w * scale)), outHeight = Math.max(2, Math.round(h * scale));
  return { x, y, w, h, outWidth, outHeight,
    width: turns % 2 ? outHeight : outWidth, height: turns % 2 ? outWidth : outHeight,
    corners: original.map((p) => turnPoint({ x: (p.x - x + .5) * outWidth / w - .5,
      y: (p.y - y + .5) * outHeight / h - .5 }, outWidth, outHeight, turns)) };
}

// Decode once, after the user selects the grid. Limit the INPUT as well as the
// output: ImageBitmap resizing is not a promise of memory-bounded decoding.
// Bigger sources and browsers without ImageBitmap use the existing preview.
export async function photoDetail(preview, corners, { current = () => true } = {}) {
  const fallback = (note = '') => ({ image: preview, corners, enhanced: false, note, release() {} }),
    source = sources.get(preview);
  if (!source) return fallback();
  if (!current()) throw new DOMException('Scan cancelled', 'AbortError');
  if (source.dimensions.width * source.dimensions.height > DETAIL_PIXEL_LIMIT)
    return fallback('Large-photo memory limit: recognition uses the preview. Crop the original in your photo app for more detail.');
  if (Math.max(source.dimensions.width, source.dimensions.height) <= Math.max(preview.width, preview.height)) return fallback();
  const unavailable = 'Original-detail decoding is unavailable; recognition uses the preview.';
  if (typeof globalThis.createImageBitmap !== 'function') return fallback(unavailable);
  const previous = decodeQueue;
  let finished, timer = null, bitmap = null, canvas = null;
  decodeQueue = new Promise((resolve) => { finished = resolve; });
  try {
    const turn = await Promise.race([previous.then(() => true),
      new Promise((resolve) => { timer = setTimeout(resolve, DECODE_WAIT, false); })]);
    if (!current()) throw new DOMException('Scan cancelled', 'AbortError');
    if (!turn) return fallback(unavailable);
    bitmap = await createImageBitmap(source.file, { imageOrientation: 'from-image' });
    if (!current()) throw new DOMException('Scan cancelled', 'AbortError');
    const plan = detailPlan(preview, corners, bitmap.width, bitmap.height, source.turns);
    if (!plan) return fallback('Original photo dimensions could not be checked; recognition uses the preview.');
    canvas = document.createElement('canvas');
    canvas.width = plan.width; canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (source.turns === 1) { ctx.translate(plan.outHeight, 0); ctx.rotate(Math.PI / 2); }
    if (source.turns === 2) { ctx.translate(plan.outWidth, plan.outHeight); ctx.rotate(Math.PI); }
    if (source.turns === 3) { ctx.translate(0, plan.outWidth); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(bitmap, plan.x, plan.y, plan.w, plan.h, 0, 0, plan.outWidth, plan.outHeight);
    const result = canvas;
    canvas = null;
    return { image: result, corners: plan.corners, enhanced: true,
      note: 'Clues read from the original photo detail; the crop preview and saved photograph are unchanged.',
      release() { result.width = result.height = 0; } };
  } catch (error) {
    if (!current() || error?.name === 'AbortError') throw new DOMException('Scan cancelled', 'AbortError');
    return fallback('Original-detail decoding failed; recognition uses the preview.');
  } finally {
    clearTimeout(timer);
    bitmap?.close?.();
    if (canvas) canvas.width = canvas.height = 0;
    finished();
  }
}
