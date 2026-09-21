import { gray, warp, validQuad } from './geometry.js';
const quantile = (values, q) => values[Math.floor((values.length - 1) * q)] ?? 0;
// Paper grain and shading can have contrast without forming a printed mark.
// Require a bounded connected stroke inside the sampled cell. Either polarity
// is allowed; this supplies quality evidence, never an OCR digit or confidence.
function hasInteriorMark(samples, side, low, high, middle) {
  const bright = high - middle > middle - low,
    cutoff = bright ? high - (high - low) * .45 : low + (high - low) * .45,
    ink = Uint8Array.from(samples, (v) => bright ? v >= cutoff : v <= cutoff),
    seen = new Uint8Array(ink.length), stack = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let area = 0, minx = side, miny = side, maxx = -1, maxy = -1;
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const at = stack.pop(), x = at % side, y = Math.floor(at / side);
      area++; minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, next = yy * side + xx;
        if (xx < 0 || yy < 0 || xx >= side || yy >= side || seen[next] || !ink[next]) continue;
        seen[next] = 1; stack.push(next);
      }
    }
    if (area >= Math.max(4, ink.length * .012) && area <= ink.length * .4 &&
        maxy - miny + 1 >= side * .25 && minx > 0 && miny > 0 &&
        maxx < side - 1 && maxy < side - 1) return true;
  }
  return false;
}
// Spatially equalised measurements exclude the outer 20% of every cell, where
// the heavy lines live. Scores compare frames; they are not OCR probabilities.
export function gridQuality(image, corners, rows, cols) {
  if (![rows, cols].every((n) => Number.isInteger(n) && n >= 1 && n <= 25) ||
      !validQuad(corners, image.width, image.height)) return null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    cellPixels = Math.min(distance(corners[0], corners[1]) / cols, distance(corners[3], corners[2]) / cols,
      distance(corners[0], corners[3]) / rows, distance(corners[1], corners[2]) / rows),
    side = Math.max(8, Math.ceil(32 / Math.min(rows, cols)), Math.min(40, Math.floor(cellPixels))),
    rectified = warp(image, corners, cols * side, rows * side),
    g = gray(rectified), w = rectified.width, cells = [], contrasts = [], scores = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const values = [], pad = Math.max(2, Math.ceil(side * .2));
    let gradient = 0, laplacian = 0;
    for (let y = r * side + pad; y < (r + 1) * side - pad; y++)
      for (let x = c * side + pad; x < (c + 1) * side - pad; x++) {
        const i = y * w + x, v = g[i]; values.push(v);
        const dx = g[i + 1] - g[i - 1], dy = g[i + w] - g[i - w],
          lap = 4 * v - g[i + 1] - g[i - 1] - g[i + w] - g[i - w];
        gradient += dx * dx + dy * dy; laplacian += lap * lap;
      }
    const samples = values.slice(); values.sort((a, b) => a - b);
    const low = quantile(values, .03), high = quantile(values, .97), contrast = high - low;
    // Nearly uniform black/white cells and texture below the noise floor do
    // not contribute to focus ranking. Both ink polarities use the same test.
    if (contrast < 16 || gradient / Math.max(1, values.length) < 12 ||
        !hasInteriorMark(samples, side - 2 * pad, low, high, quantile(values, .5))) continue;
    const focus = 100 * laplacian / Math.max(1, gradient),
      score = Math.min(500, focus) * Math.min(1, contrast / 80);
    cells.push({ cell: r * cols + c, score, contrast });
    contrasts.push(contrast); scores.push(score);
  }
  scores.sort((a, b) => a - b); contrasts.sort((a, b) => a - b);
  const assessable = cells.length >= 2, score = quantile(scores, .35), contrast = quantile(contrasts, .35),
    weakCells = cells.filter((cell) => cell.contrast < 35 || cell.score < 12).map((cell) => cell.cell),
    reason = cellPixels < 12 ? 'small' : !assessable ? null : contrast < 35 ? 'contrast' : score < 12 ? 'blur' : null;
  return { score, contrast, cellPixels, assessable, markedCells: cells.length, weakCells, reason, cells };
}
export function qualityMessage(quality) {
  if (quality?.reason === 'small') return 'Move closer: the numbers occupy too few pixels.';
  if (quality?.reason === 'blur') return 'Hold still for sharper numbers; sharp grid lines alone are not enough.';
  if (quality?.reason === 'contrast') return 'The printed clues have low contrast. Try more even light or change the camera angle.';
  return '';
}
