// A small local correction, not a replacement detector or inferred cage map.
// Only a thin dark line supported across most of a cell may move a boundary.
export function refineCellBounds(g, width, height, rows, cols) {
  const cw = width / cols, ch = height / rows;
  if (cw < 20 || ch < 20) return null;
  function line(expected, start, end, vertical, size) {
    const extent = vertical ? width : height, radius = Math.max(2, Math.floor(size * .14)),
      flank = Math.max(3, Math.round(size * .07)), scores = [];
    const at = (x, y) => vertical ? g[y * width + x] : g[x * width + y];
    for (let x = Math.max(flank, Math.ceil(expected - radius)); x <= Math.min(extent - flank - 1, Math.floor(expected + radius)); x++) {
      let supported = 0, count = 0, strength = 0;
      for (let y = Math.ceil(start); y < Math.floor(end); y++) {
        const v = at(x, y), side = Math.min(at(x - flank, y), at(x + flank, y));
        count++;
        if (v < 150 && side - v > 40) { supported++; strength += side - v; }
      }
      scores.push({ x, score: supported / Math.max(1, count), strength });
    }
    const groups = [];
    for (const item of scores.filter((v) => v.score >= .75)) {
      if (!groups.length || item.x !== groups.at(-1).at(-1).x + 1) groups.push([]);
      groups.at(-1).push(item);
    }
    // Ambiguous/double lines, thick block edges and missing ink retain the old
    // cell grid. Digits should not satisfy a near-continuous boundary strip.
    if (groups.length !== 1 || groups[0].length > size * .10) return expected;
    const group = groups[0], center = group.reduce((a, v) => a + v.x * v.strength, 0) /
      group.reduce((a, v) => a + v.strength, 0);
    // Leave already-aligned grids byte-identical; subpixel jitter is not a fix.
    return Math.abs(center - expected) >= Math.max(3, size * .035) ? center : expected;
  }
  const xs = Array.from({ length: rows }, (_, r) => Array.from({ length: cols + 1 }, (_, c) =>
    line(c * cw, (r + .15) * ch, (r + .85) * ch, true, cw))),
    ys = Array.from({ length: cols }, (_, c) => Array.from({ length: rows + 1 }, (_, r) =>
      line(r * ch, (c + .15) * cw, (c + .85) * cw, false, ch)));
  let changed = false;
  const cells = Array.from({ length: rows * cols }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols,
      x = xs[r][c], y = ys[c][r], w = xs[r][c + 1] - x, h = ys[c][r + 1] - y;
    if (w < cw * .75 || w > cw * 1.25 || h < ch * .75 || h > ch * 1.25) return null;
    if (x === c * cw && y === r * ch && xs[r][c + 1] === (c + 1) * cw && ys[c][r + 1] === (r + 1) * ch) return null;
    changed = true;
    return { x, y, w, h };
  });
  return changed ? cells : null;
}

export function numericCropBounds(entry, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  if (!entry.cellBounds) {
    const col = entry.cell % cols, row = Math.floor(entry.cell / cols);
    return { minX: Math.max(0, Math.round((col + .08) * cellWidth)),
      maxX: Math.min(imageWidth, Math.round((col + .92) * cellWidth)),
      minY: Math.max(0, Math.round((row + .08) * cellHeight)),
      maxY: Math.min(imageHeight, Math.round((row + .92) * cellHeight)) };
  }
  const cell = entry.cellBounds;
  return { minX: Math.max(0, Math.round(cell.x + .08 * cell.w)),
    maxX: Math.min(imageWidth, Math.round(cell.x + .92 * cell.w)),
    minY: Math.max(0, Math.round(cell.y + .08 * cell.h)),
    maxY: Math.min(imageHeight, Math.round(cell.y + .92 * cell.h)) };
}
