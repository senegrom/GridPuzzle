import { gray, warp, validQuad } from './geometry.js';
const quantile = (values, q) => values[Math.floor((values.length - 1) * q)] ?? 0;
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
    values.sort((a, b) => a - b);
    const contrast = quantile(values, .97) - quantile(values, .03);
    // Nearly uniform black/white cells and texture below the noise floor do
    // not contribute to focus ranking. Both ink polarities use the same test.
    if (contrast < 16 || gradient / Math.max(1, values.length) < 12) continue;
    const focus = 100 * laplacian / Math.max(1, gradient),
      score = Math.min(500, focus) * Math.min(1, contrast / 80);
    cells.push({ cell: r * cols + c, score, contrast });
    contrasts.push(contrast); scores.push(score);
  }
  scores.sort((a, b) => a - b); contrasts.sort((a, b) => a - b);
  const assessable = cells.length >= 2, score = quantile(scores, .35), contrast = quantile(contrasts, .35),
    weakCells = cells.filter((cell) => cell.contrast < 35 || cell.score < 12).map((cell) => cell.cell),
    reason = cellPixels < 12 ? 'small' : !assessable ? null : contrast < 35 ? 'contrast' : score < 12 ? 'blur' : null;
  return { score, contrast, cellPixels, assessable, markedCells: cells.length, weakCells, reason };
}
export function qualityMessage(quality) {
  if (quality?.reason === 'small') return 'Move closer: the numbers occupy too few pixels.';
  if (quality?.reason === 'blur') return 'Hold still for sharper numbers; sharp grid lines alone are not enough.';
  if (quality?.reason === 'contrast') return 'The printed clues have low contrast. Try more even light or change the camera angle.';
  return '';
}
