// The operator of a KenKen cage clue, read from the shape of its last glyph.
// Tesseract reads a division sign as "+" and often drops a hyphen, and a clue
// without an operator counts as a sum. The ink says which sign is printed:
// "+" is two strokes crossing at their middles, "×" or "x" two diagonals,
// "−" or "-" one short bar, "÷" a dot, a bar and a dot, "/" one long diagonal.
//
// The input is a clue crop laid out as cageLabelCrop makes it: 1 for ink, the
// clue box at (16, 16) and 40 px high inside a 16 px margin. `core`, when
// given, is the darker half of the same ink, where blur no longer joins a
// division sign's dots to its bar. The answer is "+", "-", "*" or "/", or null
// when no operator is clear: nothing follows the digits, a digit comes last,
// or the last glyph has no clear shape.
const MARGIN = 16;

// 8-connected pieces of ink, with their boxes; `label` maps pixels to pieces.
function pieces(ink, width, height) {
  const label = new Int32Array(width * height).fill(-1), queue = new Int32Array(width * height), list = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || label[start] >= 0) continue;
    const id = list.length;
    let head = 0, tail = 0, minx = width, maxx = -1, miny = height, maxy = -1, n = 0, sumY = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const k = queue[head++], x = k % width, y = (k - x) / width;
      n++;
      sumY += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < width && yy < height) {
            const j = yy * width + xx;
            if (ink[j] && label[j] < 0) { label[j] = id; queue[tail++] = j; }
          }
        }
    }
    list.push({ id, minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1, n, cy: sumY / n });
  }
  return { list, label };
}

// Cage lines reaching into the clue box are long runs of ink: a third of the
// box's width across, or most of its height down. No glyph is that long.
function withoutRules(ink, width, height) {
  const out = Uint8Array.from(ink), across = 0.35 * (width - 2 * MARGIN), down = 0.8 * (height - 2 * MARGIN);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; ) {
      let end = x;
      while (end < width && ink[y * width + end]) end++;
      if (end - x >= across) out.fill(0, y * width + x, y * width + end);
      x = end + 1;
    }
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; ) {
      let end = y;
      while (end < height && ink[end * width + x]) end++;
      if (end - y >= down) for (let k = y; k < end; k++) out[k * width + x] = 0;
      y = end + 1;
    }
  return out;
}

// Where a piece's ink lies in its own box, scaled to [-1, 1] both ways: the
// share near the middle row or column (a cross), near either diagonal (an
// x), near each diagonal alone, and the fullest row's share of the width.
function layout(piece, label, width) {
  let n = 0, cross = 0, diagonals = 0, rising = 0, falling = 0, fullest = 0;
  const cx = (piece.minx + piece.maxx) / 2, cy = (piece.miny + piece.maxy) / 2,
    hw = Math.max(1, piece.w / 2), hh = Math.max(1, piece.h / 2);
  for (let y = piece.miny; y <= piece.maxy; y++) {
    let row = 0;
    for (let x = piece.minx; x <= piece.maxx; x++) {
      if (label[y * width + x] !== piece.id) continue;
      row++;
      n++;
      const u = (x - cx) / hw, v = (y - cy) / hh;
      if (Math.min(Math.abs(u), Math.abs(v)) < 0.3) cross++;
      if (Math.abs(Math.abs(u) - Math.abs(v)) < 0.3) diagonals++;
      if (Math.abs(u + v) < 0.35) rising++;
      if (Math.abs(u - v) < 0.35) falling++;
    }
    fullest = Math.max(fullest, row / piece.w);
  }
  return { cross: cross / n, diagonals: diagonals / n, rising: rising / n, falling: falling / n, fullest };
}

function readShape(rawInk, width, height) {
  const ink = withoutRules(rawInk, width, height), { list, label } = pieces(ink, width, height),
    edge = MARGIN + 2,
    // Short pieces of a cage outline along the box's top or left edge.
    outline = (p) => (p.miny <= edge && p.h <= 5 && p.w >= 2 * p.h) || (p.minx <= edge && p.w <= 4 && p.h >= 3 * p.w),
    kept = list.filter((p) => p.n >= 3 && !outline(p));
  if (!kept.length) return null;
  // Digits set the scale: the tallest glyphs, and the band they span.
  const H = Math.max(...kept.map((p) => p.h)), digits = kept.filter((p) => p.h >= 0.6 * H),
    top = Math.min(...digits.map((p) => p.miny)), bottom = Math.max(...digits.map((p) => p.maxy)),
    glyphs = [];
  // Pieces over one another form one glyph (a division sign's dots and bar).
  for (const p of kept.filter((q) => q.maxy >= top && q.miny <= bottom).sort((a, b) => a.minx - b.minx)) {
    const glyph = glyphs.find((g) => Math.min(g.maxx, p.maxx) - Math.max(g.minx, p.minx) + 1 >= 0.5 * Math.min(p.w, g.maxx - g.minx + 1));
    if (glyph) {
      glyph.parts.push(p);
      glyph.minx = Math.min(glyph.minx, p.minx);
      glyph.maxx = Math.max(glyph.maxx, p.maxx);
      glyph.miny = Math.min(glyph.miny, p.miny);
      glyph.maxy = Math.max(glyph.maxy, p.maxy);
    } else glyphs.push({ parts: [p], minx: p.minx, maxx: p.maxx, miny: p.miny, maxy: p.maxy });
  }
  glyphs.sort((a, b) => a.minx - b.minx);
  // An operator comes last, close behind a digit.
  if (glyphs.length < 2) return null;
  const last = glyphs[glyphs.length - 1], before = glyphs[glyphs.length - 2];
  if (before.maxy - before.miny + 1 < 0.6 * H || last.minx - before.maxx > 0.8 * H) return null;
  if (last.parts.length === 3) {
    const [a, bar, c] = [...last.parts].sort((p, q) => p.cy - q.cy),
      dot = (d) => d.w <= 0.6 * bar.w && d.h <= 0.6 * bar.w && d.w <= 2 * d.h && d.h <= 2 * d.w;
    return bar.w >= 1.8 * bar.h && bar.w >= 0.35 * H && a.maxy < bar.miny && bar.maxy < c.miny && dot(a) && dot(c)
      ? { op: "/", divisionSign: true } : null;
  }
  if (last.parts.length !== 1) return null;
  const p = last.parts[0], f = layout(p, label, width), aspect = p.w / p.h, middle = (p.cy - top) / (bottom - top + 1);
  if (p.h <= 0.3 * H && aspect >= 1.5 && p.w >= 0.25 * H && middle >= 0.25 && middle <= 0.8) return { op: "-" };
  if (f.rising >= 0.7 && f.falling <= 0.35 && f.fullest <= 0.7 && p.h >= 0.6 * H && aspect <= 0.8) return { op: "/" };
  if (aspect >= 0.6 && aspect <= 1.6 && p.h >= 0.3 * H && p.h <= 1.05 * H && p.w >= 0.3 * H && middle >= 0.3 && middle <= 0.75) {
    if (f.cross >= 0.85 && f.diagonals <= 0.6) return { op: "+" };
    if (f.diagonals >= 0.65 && f.cross <= 0.55 && f.rising >= 0.3 && f.falling >= 0.3 && p.h <= H) return { op: "*" };
  }
  return null;
}

export function readOperator(ink, width, height, core = null) {
  const shape = readShape(ink, width, height);
  // A division sign blurred into a cross: at the ink's core its dots part.
  if (shape?.op === "+" && core && readShape(core, width, height)?.divisionSign) return "/";
  return shape?.op ?? null;
}
