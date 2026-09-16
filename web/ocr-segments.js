import { voteDigit } from "./ocr-map.js";
// Independent re-reads of whole glyphs, never artificial strokes or solver clues.
export function separatedCrops(entry, g, width, height, cellWidth, cellHeight) {
  const boxes = entry.segments;
  if (!Array.isArray(boxes) || boxes.length < 2 || boxes.length > 3 ||
      boxes.length !== entry.glyphCount || !boxes.every((b, i) =>
        b && [b.x, b.y, b.w, b.h].every(Number.isInteger) && b.w > 0 && b.h > 0 &&
        b.x >= entry.x && b.y >= entry.y && b.x + b.w <= entry.x + entry.w &&
        b.y + b.h <= entry.y + entry.h && b.x >= 0 && b.y >= 0 &&
        b.x + b.w <= width && b.y + b.h <= height &&
        (!i || b.x > boxes[i - 1].x + boxes[i - 1].w))) return [];
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05));
  return boxes.map((box, i) => {
    // Cut padding at the midpoint of the empty gap, not into its neighbour.
    const left = i ? Math.ceil((boxes[i - 1].x + boxes[i - 1].w + box.x) / 2) : entry.x - pad,
      right = i + 1 < boxes.length ? Math.ceil((box.x + box.w + boxes[i + 1].x) / 2) : entry.x + entry.w + pad,
      x = Math.max(0, left, box.x - pad),
      y = Math.max(0, box.y - pad),
      w = Math.min(width, right, box.x + box.w + pad) - x,
      h = Math.min(height, box.y + box.h + pad) - y,
      canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const source = g[(y + yy) * width + x + xx],
        value = entry.invert ? 255 - source : source,
        at = 4 * (yy * w + xx);
      pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = value;
      pixels.data[at + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  });
}

export function applySeparatedReading(entry, reads) {
  const count = entry.segments?.length;
  if (count !== entry.glyphCount || count < 2 || count > 3) return;
  if (/^\d{1,3}$/.test(entry.text) && entry.text.length >= count) return;
  // Segmentation is a lower bound: touching digits may share a component.
  // Never shorten a longer reading to force an exact component count.
  // Prefer an existing complete OCR alternative to a truncated majority.
  // Geometry selects between readings; it supplies no numeric value. Keep
  // the correction uncertain even if all full-length alternatives agree.
  const complete = voteDigit([entry, ...reads.filter((r) => r.kind !== "segments")]
    .filter((r) => /^\d{1,3}$/.test(r.text) && r.text.length >= count));
  if (complete.text) {
    entry.text = complete.text;
    entry.confidence = 0;
    entry.lengthRecovered = true;
    return;
  }
  // A segmented proposal is only a last resort. Duplicate messages never
  // acquire additional weight or overrule any complete whole-crop reading.
  const split = reads.find((r) => r.kind === "segments" && /^\d{2,3}$/.test(r.text) && r.text.length === count);
  if (!split) return;
  entry.text = split.text;
  entry.confidence = 0;
  entry.segmentedRead = true;
}
