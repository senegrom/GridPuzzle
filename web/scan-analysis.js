import { refineCellBounds } from './cell-boundaries.js';
import { isGridStroke } from "./ocr-map.js";
import { isCage } from "./model.js";
import { gray, thresholdGray, estimateGrid, fraction, otsuCut } from "./geometry.js";

function mean(grayImage, w, h, x, y, rw, rh) {
  let sum = 0,
    n = 0;
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) {
      sum += grayImage[yy * w + xx];
      n++;
    }
  return sum / Math.max(1, n);
}

// Solid Str8ts/Kakuro/Hidato blocks are much darker than the bright-cell
// population even under an illumination gradient. Newspaper Sudoku shading is
// halftone grey and must not become a black structural cell merely because the
// lower corner of the photograph is in shadow.
export function detectBlackCells(g, w, h, rows, cols) {
  const cw = w / cols,
    ch = h / rows,
    means = [];
  const interior = (i) => [
    (i % cols + 0.16) * cw,
    (Math.floor(i / cols) + 0.16) * ch,
    0.68 * cw,
    0.68 * ch,
  ];
  for (let i = 0; i < rows * cols; i++)
    means.push(mean(g, w, h, ...interior(i)));
  const sorted = [...means].sort((a, b) => a - b),
    brightReference = sorted[Math.floor((sorted.length - 1) * 0.8)] || 255,
    meanCutoff = Math.min(105, brightReference * 0.48),
    dark = new Uint8Array(g.length);
  // Use the same adaptive cutoff for pixel occupancy and cell brightness.
  // A digit can pull shaded paper's mean below the cutoff even though most
  // pixels are above it, especially after low-contrast normalization.
  for (let i = 0; i < g.length; i++) dark[i] = g[i] < meanCutoff ? 1 : 0;
  return means.map((value, i) =>
    value < meanCutoff && fraction(dark, w, h, ...interior(i)) > 0.65,
  );
}

function numberBounds(mask, w, h) {
  const seen = new Uint8Array(mask.length),
    stack = [],
    parts = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0,
      minx = w,
      miny = h,
      maxx = -1,
      maxy = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop(),
        y = Math.floor(at / w),
        x = at % w;
      area++;
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const next = yy * w + xx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
    }
    parts.push({ area, minx, miny, maxx, maxy });
  }
  // Recover complete printed glyphs, not just two equally short fragments.
  // At least one side of each join must be short: two intact neighbouring
  // digits must never become one glyph. The limits exclude paper speckle,
  // widely separated marks and grid edges; no pixels are filled or invented.
  const fragments = parts.filter((part) => {
    const height = part.maxy - part.miny + 1;
    return part.area >= Math.max(4, w * h * 0.008) &&
      height >= h * 0.1 && height <= h * 0.7;
  });
  const joined = new Set();
  if (fragments.length <= 24) {
    // Join closest vertical neighbours first so chains of three or more
    // pieces work too. Each iteration removes one candidate; work is bounded.
    for (;;) {
      let best = null;
      for (let i = 0; i < fragments.length; i++) {
        const a = fragments[i];
        for (let j = i + 1; j < fragments.length; j++) {
          const b = fragments[j],
            ah = a.maxy - a.miny + 1, bh = b.maxy - b.miny + 1,
            gap = Math.max(a.miny - b.maxy - 1, b.miny - a.maxy - 1),
            overlap = Math.min(a.maxx, b.maxx) - Math.max(a.minx, b.minx) + 1,
            height = Math.max(a.maxy, b.maxy) - Math.min(a.miny, b.miny) + 1;
          if (Math.min(ah, bh) >= h * 0.25 || gap < 1 || gap > h * 0.16 ||
            height > h * 0.7 ||
            overlap < Math.min(a.maxx - a.minx + 1, b.maxx - b.minx + 1) * 0.6)
            continue;
          if (!best || gap < best.gap) best = { i, j, gap };
        }
      }
      if (!best) break;
      const a = fragments[best.i], b = fragments[best.j],
        merged = { area: a.area + b.area, minx: Math.min(a.minx, b.minx),
          miny: Math.min(a.miny, b.miny), maxx: Math.max(a.maxx, b.maxx),
          maxy: Math.max(a.maxy, b.maxy), recoveredMark: true };
      joined.add(a); joined.add(b);
      parts.push(merged);
      fragments[best.i] = merged;
      fragments.splice(best.j, 1);
    }
  }
  const glyphs = parts.filter((part) => !joined.has(part));
  glyphs.sort((a, b) => b.area - a.area);
  const anchor = glyphs.find(
      (part) =>
        part.area >= Math.max(4, w * h * 0.003) &&
        part.maxy - part.miny + 1 >= h * 0.25,
    );
  if (!anchor) return null;
  const selected = [anchor];
  const bounds = { ...anchor, glyphCount: 1 },
    height = anchor.maxy - anchor.miny + 1;
  // Neighbouring digits are separate components too. Keep substantial glyphs
  // on the same line while excluding the small dots of halftone/newsprint.
  const pending = glyphs.filter((part) => {
    const partHeight = part.maxy - part.miny + 1,
      overlap = Math.min(anchor.maxy, part.maxy) - Math.max(anchor.miny, part.miny) + 1;
    return part !== anchor &&
      part.area >= Math.max(4, w * h * 0.003, anchor.area * 0.1) &&
      partHeight >= height * 0.55 && partHeight <= height * 1.6 &&
      overlap >= Math.min(height, partHeight) * 0.6;
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const part = pending[i],
        gap = Math.max(part.minx - bounds.maxx - 1, bounds.minx - part.maxx - 1);
      if (gap > height) continue;
      bounds.minx = Math.min(bounds.minx, part.minx);
      bounds.maxx = Math.max(bounds.maxx, part.maxx);
      bounds.miny = Math.min(bounds.miny, part.miny);
      bounds.maxy = Math.max(bounds.maxy, part.maxy);
      bounds.area += part.area;
      bounds.glyphCount++;
      selected.push(part);
      if (part.recoveredMark) bounds.recoveredMark = true;
      pending.splice(i, 1);
      changed = true;
    }
  }
  // Only side-by-side, non-overlapping glyphs can be independently read.
  // Retain the actual boxes, not an inferred digit or a cut through joined ink.
  selected.sort((a, b) => a.minx - b.minx);
  if (selected.length >= 2 && selected.length <= 3 &&
      selected.every((part, i) => !i || part.minx > selected[i - 1].maxx + 1))
    bounds.segments = selected.map(({ minx, miny, maxx, maxy }) =>
      ({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 }));
  return bounds;
}

function percentileOf(g, fraction) {
  const histogram = new Uint32Array(256);
  for (const value of g) histogram[value]++;
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (cumulative >= g.length * fraction) return value;
  }
  return 255;
}

// Restore faded ink before the fixed ink/solid-black thresholds. Percentiles
// ignore isolated dust/bright pixels. Keep the white endpoint fixed: stretching
// paper highlights too aggressively can misclassify gray Sudoku shading.
// Normally exposed and almost uniform images are deliberately left untouched.
export function normalizeScanContrast(g) {
  const histogram = new Uint32Array(256);
  for (const value of g) histogram[value]++;
  const lowCount = Math.max(1, Math.ceil(g.length * 0.001)),
    highCount = Math.max(1, Math.ceil(g.length * 0.995));
  let cumulative = 0, low = -1, high = 255;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (low < 0 && cumulative >= lowCount) low = value;
    if (cumulative >= highCount) { high = value; break; }
  }
  // A nearly uniform cell/page is not evidence of a faint printed digit.
  if (low < 64 || high - low < 48) return { gray: g, adjusted: false };
  const normalized = new Uint8Array(g.length), scale = 255 / (255 - low);
  for (let i = 0; i < g.length; i++)
    normalized[i] = Math.max(0, Math.min(255, Math.round((g[i] - low) * scale)));
  return { gray: normalized, adjusted: true };
}

// Only missed white-cell marks take this path. Work in the cell interior so
// dark grid lines elsewhere cannot hide a light digit. Preserve original gray
// pixels for OCR; local thresholding supplies geometry, never a guessed value.
// `paperFloor` is the lightest a cell's paper may be too dark to be paper:
// 150 on a bright page, lower on a dim photograph (see prepareScan).
function lightCellMark(g, width, x, y, w, h, paperFloor = 150) {
  const pixels = new Uint8Array(w * h), histogram = new Uint32Array(256);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const value = g[(y + yy) * width + x + xx];
    pixels[yy * w + xx] = value; histogram[value]++;
  }
  let cumulative = 0, dark = -1, paper = 255;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (dark < 0 && cumulative >= pixels.length * .02) dark = value;
    if (cumulative >= pixels.length * .8) { paper = value; break; }
  }
  const contrast = paper - dark;
  if (paper < paperFloor || contrast < 16) return null; // Shaded panel, flat paper or shallow noise.
  const local = thresholdGray(pixels, w, h, Math.max(9, Math.round(h * .55)),
    Math.max(4, contrast * .15), 256);
  let minx = w, miny = h, maxx = -1, maxy = -1, area = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++)
    if (local[yy * w + xx]) {
      area++; minx = Math.min(minx, xx); maxx = Math.max(maxx, xx);
      miny = Math.min(miny, yy); maxy = Math.max(maxy, yy);
    }
  // Gradients, panel shading, crop/grid edges and isolated dust are not glyphs.
  // A substantial central mark can still require review without a tall enough
  // connected component to justify sending a numeric crop to OCR.
  if (minx < 2 || miny < 2 || maxx >= w - 2 || maxy >= h - 2 ||
    maxy - miny < h * .18 || area < Math.max(8, w * h * .012) ||
    area > w * h * .4 || area / ((maxx - minx + 1) * (maxy - miny + 1)) < .12)
    return null;
  return { part: numberBounds(local, w, h) };
}

// Printed in colour: the darkest twentieth of the pixels (by their darkest
// channel) is strongly coloured, as red or blue print is and black ink is not.
// Every empty cell asks, so the twentieth comes from a histogram rather than a
// sort; pixels tied at the cut are taken in scan order, as a stable sort would.
function colourfulInk(data, width, x, y, w, h) {
  const histogram = new Uint32Array(256), count = Math.max(1, Math.floor(w * h / 20));
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const at = 4 * ((y + yy) * width + x + xx);
    histogram[Math.min(data[at], data[at + 1], data[at + 2])]++;
  }
  let cut = 0, below = 0;
  while (cut < 255 && below + histogram[cut] < count) below += histogram[cut++];
  let atCut = count - below, taken = 0, chroma = 0;
  for (let yy = 0; yy < h && taken < count; yy++) for (let xx = 0; xx < w; xx++) {
    const at = 4 * ((y + yy) * width + x + xx), r = data[at], gr = data[at + 1], b = data[at + 2],
      low = Math.min(r, gr, b);
    if (low > cut) continue;
    if (low === cut) {
      if (!atCut) continue;
      atCut--;
    }
    chroma += Math.max(r, gr, b) - low;
    taken++;
  }
  return taken > 0 && chroma / taken >= 30;
}

// The apex side of a chevron-shaped sign, from its ink alone: along the sign's
// axis the ink's cross-extent grows from the apex to the open end. Otsu's
// threshold inside the ink box, a least-squares slope of cross-extent against
// position, and the mean extent of the first and last quarter. Clear shapes
// only: ink at 8 or more positions, the open end at least 1.6 times the apex
// end, and a slope of at least 0.15. The apex points at the smaller cell, so
// "<"/"^" mean the first (left/upper) cell is smaller. Null otherwise.
export function readChevron(g, width, kind, x, y, w, h) {
  const horizontal = kind === "hsign", histogram = new Uint32Array(256);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) histogram[g[yy * width + xx]]++;
  const cut = otsuCut(histogram), points = [], length = horizontal ? w : h, breadth = horizontal ? h : w;
  for (let a = 0; a < length; a++) {
    let low = Infinity, high = -Infinity;
    for (let b = 0; b < breadth; b++) {
      const value = horizontal ? g[(y + b) * width + x + a] : g[(y + a) * width + x + b];
      if (value <= cut) { low = Math.min(low, b); high = Math.max(high, b); }
    }
    if (high >= low) points.push([a, high - low + 1]);
  }
  if (points.length < 8) return null;
  const n = points.length, meanA = points.reduce((s, p) => s + p[0], 0) / n,
    meanE = points.reduce((s, p) => s + p[1], 0) / n,
    sxx = points.reduce((s, p) => s + (p[0] - meanA) ** 2, 0),
    slope = sxx ? points.reduce((s, p) => s + (p[0] - meanA) * (p[1] - meanE), 0) / sxx : 0,
    quarter = Math.max(1, Math.floor(n / 4)),
    mean = (list) => list.reduce((s, p) => s + p[1], 0) / list.length,
    start = mean(points.slice(0, quarter)), end = mean(points.slice(n - quarter));
  if (Math.max(start, end) < 1.6 * Math.max(1, Math.min(start, end)) || Math.abs(slope) < 0.15) return null;
  const apexFirst = end > start;
  return horizontal ? (apexFirst ? "<" : ">") : (apexFirst ? "^" : "v");
}

// Cage borders on the rectified grid. Every interior cell edge is measured by
// thin strips (2% of a cell, over the edge's middle 60%) parallel to it:
// - inset style (Killer's dashed outlines, drawn 6-12% inside each cell): a
//   border when both neighbours show ink in that band (at least 0.2);
// - thick style (the usual KenKen print): a border when the edge's central 4%
//   is at most 0.35 of the paper's gray, which a thin grid line never is.
// Killer boards always use the inset style, since their thick 3 x 3 box lines
// are not cage borders; a KenKen board is thick style when at least two edges
// pass the thick test. Measured on the corpus's cage renders (2026-09-28):
// exact partitions on 359/360 dashed boards and 103/107 thick-bordered ones.
// Cells joined across non-border edges form the cages.
export function cagePartition(mask, g, w, h, rows, cols, type) {
  const cw = w / cols, ch = h / rows, band = Math.max(1, 0.02 * Math.min(cw, ch)), edges = [];
  const strip = (vertical, r, c, d) => {
    const x = vertical ? (c + 1) * cw + d * cw - band / 2 : c * cw + 0.2 * cw,
      y = vertical ? r * ch + 0.2 * ch : (r + 1) * ch + d * ch - band / 2,
      rw = vertical ? band : 0.6 * cw, rh = vertical ? 0.6 * ch : band;
    let ink = 0, sum = 0, n = 0;
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) { ink += mask[yy * w + xx]; sum += g[yy * w + xx]; n++; }
    return n ? [ink / n, sum / n] : [0, 255];
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c < cols - 1) edges.push({ a: r * cols + c, b: r * cols + c + 1, vertical: true, r, c });
    if (r < rows - 1) edges.push({ a: r * cols + c, b: (r + 1) * cols + c, vertical: false, r, c });
  }
  const inset = (e) => {
    const side = (sign) => Math.max(...[0.06, 0.08, 0.1, 0.12].map((d) => strip(e.vertical, e.r, e.c, sign * d)[0]));
    return Math.min(side(-1), side(1)) >= 0.2;
  };
  const thick = (e) => {
    const centre = [-0.02, 0, 0.02].reduce((s, d) => s + strip(e.vertical, e.r, e.c, d)[1], 0) / 3,
      paper = Math.max(...[-0.2, -0.15, 0.15, 0.2].map((d) => strip(e.vertical, e.r, e.c, d)[1]));
    return centre <= 0.35 * paper;
  };
  let style = "inset", borders = null;
  if (type !== "killersudoku") {
    const heavy = edges.map(thick);
    if (heavy.filter(Boolean).length >= 2) { style = "thick"; borders = heavy; }
  }
  borders ??= edges.map(inset);
  const parent = Array.from({ length: rows * cols }, (_, i) => i),
    root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  edges.forEach((e, k) => { if (!borders[k]) parent[root(e.a)] = root(e.b); });
  const groups = new Map();
  for (let i = 0; i < parent.length; i++) {
    const k = root(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  return { areas: [...groups.values()], style };
}
// Where a cage's clue is printed, as fractions of its head (top-left) cell:
// inside the dashed outline for inset style, in the corner for thick style.
export const CAGE_LABEL_BOX = { inset: [0.11, 0.12, 0.8, 0.44], thick: [0.05, 0.04, 0.75, 0.4] };

export function prepareScan(image, type, rows, cols) {
  const w = image.width,
    h = image.height,
    cw = w / cols,
    ch = h / rows,
    contrast = normalizeScanContrast(gray(image)),
    g = contrast.gray,
    mask = thresholdGray(g, w, h),
    cellBounds = refineCellBounds(g, w, h, rows, cols),
    black = detectBlackCells(g, w, h, rows, cols),
    anyBlack = black.some(Boolean),
    entries = [], unreadCells = [],
    // A dim photograph's paper sits well under the 150 that bright paper
    // clears, and its faint or coloured digits then fell through every path.
    // The recovery's paper gate follows the page (three quarters of its 80th
    // percentile), never rising above 150, so bright pages keep their gate.
    paperFloor = Math.min(150, 0.75 * percentileOf(g, 0.8));
  // Coloured print is pale in luminance; its darkest channel is not.
  let darkest = null;
  const darkestChannel = () => {
    if (!darkest) {
      darkest = new Uint8Array(w * h);
      for (let i = 0; i < darkest.length; i++)
        darkest[i] = Math.min(image.data[4 * i], image.data[4 * i + 1], image.data[4 * i + 2]);
    }
    return darkest;
  };

  function extractRegion(kind, cell, x, y, rw, rh, invert = false, other = null, bounds = null) {
    if (bounds) {
      const ox = (cell % cols) * cw, oy = Math.floor(cell / cols) * ch;
      x = bounds.x + (x - ox) / cw * bounds.w;
      y = bounds.y + (y - oy) / ch * bounds.h;
      rw = rw / cw * bounds.w; rh = rh / ch * bounds.h;
    }
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    rw = Math.max(1, Math.min(w - x, Math.round(rw)));
    rh = Math.max(1, Math.min(h - y, Math.round(rh)));
    const local = new Uint8Array(rw * rh);
    let recoveredMark = false, glyphCount = 1, segments;
    let minx = rw,
      miny = rh,
      maxx = -1,
      maxy = -1,
      ink = 0;
    for (let yy = 0; yy < rh; yy++)
      for (let xx = 0; xx < rw; xx++) {
        const val = invert
          ? g[(y + yy) * w + x + xx] > 135
          : mask[(y + yy) * w + x + xx];
        local[yy * rw + xx] = val ? 1 : 0;
        if (val) {
          minx = Math.min(minx, xx);
          miny = Math.min(miny, yy);
          maxx = Math.max(maxx, xx);
          maxy = Math.max(maxy, yy);
          ink++;
        }
      }
    // Filter speckle without cutting a multi-digit clue into a single glyph.
    if (["value", "blackvalue"].includes(kind)) {
      let part = numberBounds(local, rw, rh);
      recoveredMark = Boolean(part?.recoveredMark);
      if (!part && kind === "blackvalue") {
        // Downsampling makes white printed digits dimmer than the fixed white
        // cutoff. Retry only a missed central black-cell mark, using its own
        // contrast. A flat black block, dust or shallow texture is not a digit.
        const levels = [];
        for (let yy = 0; yy < rh; yy++)
          for (let xx = 0; xx < rw; xx++) levels.push(g[(y + yy) * w + x + xx]);
        levels.sort((a, b) => a - b);
        const background = levels[Math.floor(levels.length * 0.5)],
          highlight = levels[Math.floor((levels.length - 1) * 0.98)];
        if (highlight - background >= 40) {
          const cutoff = Math.min(135, background + (highlight - background) * 0.5);
          for (let yy = 0; yy < rh; yy++)
            for (let xx = 0; xx < rw; xx++)
              local[yy * rw + xx] = g[(y + yy) * w + x + xx] > cutoff ? 1 : 0;
          part = numberBounds(local, rw, rh);
          recoveredMark = Boolean(part);
        }
      }
      if (!part && kind === "value") {
        const recovered = lightCellMark(g, w, x, y, rw, rh, paperFloor) ??
          (colourfulInk(image.data, w, x, y, rw, rh) ? lightCellMark(darkestChannel(), w, x, y, rw, rh, paperFloor) : null);
        if (recovered) {
          part = recovered.part;
          recoveredMark = true;
          if (!part) return { unread: true };
        }
      }
      if (!part) return;
      ({ minx, miny, maxx, maxy } = part);
      ink = part.area;
      glyphCount = part.glyphCount;
      segments = part.segments?.map((box) => ({ ...box, x: x + box.x, y: y + box.y }));
    }
    if (
      ink < Math.max(4, rw * rh * 0.008) ||
      maxy - miny < Math.max(2, rh * 0.1)
    )
      return;
    if (kind === "label" && (maxy >= rh - 2 || maxy - miny < 3)) return;
    let edgeInk = 0;
    if (kind === "label") {
      const band = Math.max(1, Math.round(ch * 0.03));
      for (let yy = miny; yy <= maxy; yy++)
        for (let xx = minx; xx <= maxx; xx++)
          if (yy < miny + band || xx < minx + band)
            edgeInk += mask[(y + yy) * w + x + xx];
    }
    if (
      isGridStroke({
        kind,
        width: maxx - minx + 1,
        height: maxy - miny + 1,
        ink,
        edgeInk,
        regionWidth: rw,
        cellHeight: ch,
      })
    )
      return;
    if (kind === "hsign" && maxx - minx < (maxy - miny) * 0.3) return;
    if (kind === "vsign" && maxy - miny < (maxx - minx) * 0.3) return;
    const chevron = ["hsign", "vsign"].includes(kind)
      ? readChevron(g, w, kind, x + minx, y + miny, maxx - minx + 1, maxy - miny + 1) : null;
    return { entry: {
      kind,
      cell,
      other,
      x: x + minx,
      y: y + miny,
      w: maxx - minx + 1,
      h: maxy - miny + 1,
      invert,
      text: "",
      confidence: 0,
      ...(chevron ? { chevron } : {}),
      ...(bounds ? { cellBounds: bounds, refinedCell: true } : {}),
      ...(recoveredMark ? { recoveredMark: true } : {}),
      ...(glyphCount > 1 ? { glyphCount } : {}),
      ...(segments ? { segments } : {}),
    } };
  }
  function region(kind, cell, x, y, rw, rh, invert = false, other = null) {
    const args = [kind, cell, x, y, rw, rh, invert, other],
      original = extractRegion(...args),
      bounds = ["value", "blackvalue"].includes(kind) ? cellBounds?.[cell] : null,
      refined = bounds ? extractRegion(...args, bounds) : null,
      a = original?.entry, b = refined?.entry;
    // A better boundary is not a reason to disturb an already complete crop.
    // Only adopt newly found ink, or a strict superset of the original glyph's
    // bounding box. Never trade away an existing piece for a shifted/shrunken
    // crop, and do not add review flags when the printed evidence is identical.
    const expands = b && (!a || (b.x <= a.x && b.y <= a.y &&
      b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h &&
      (b.x < a.x || b.y < a.y || b.w > a.w || b.h > a.h))),
      chosen = expands ? refined : original;
    if (chosen?.entry) entries.push(chosen.entry);
    else if (original?.unread || refined?.unread) unreadCells.push(cell);
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (black[i] && ["auto", "kakuro", "hidato", "str8ts"].includes(type)) {
        if (type === "auto" || type === "str8ts")
          region(
            "blackvalue",
            i,
            (c + 0.16) * cw,
            (r + 0.16) * ch,
            0.68 * cw,
            0.68 * ch,
            true,
          );
        if (type === "auto" || type === "kakuro") {
          region(
            "across",
            i,
            (c + 0.48) * cw,
            (r + 0.04) * ch,
            0.46 * cw,
            0.4 * ch,
            true,
          );
          region(
            "down",
            i,
            (c + 0.05) * cw,
            (r + 0.55) * ch,
            0.4 * cw,
            0.4 * ch,
            true,
          );
        }
      } else
        region(
          "value",
          i,
          (c + 0.14) * cw,
          (r + 0.16) * ch,
          0.72 * cw,
          0.72 * ch,
        );
      // Structural probes are expensive and can turn a shadow into false
      // cage/sign evidence. Once a true solid block is present, the black-cell
      // families provide the useful structural signal instead.
      // An explicit cage type reads one clue per cage, after the partition.
      if (type === "auto" && !anyBlack)
        region(
          "label",
          i,
          (c + 0.04) * cw,
          (r + 0.015) * ch,
          0.7 * cw,
          0.255 * ch,
        );
      if ((type === "auto" && !anyBlack) || type === "futoshiki") {
        if (c < cols - 1)
          region(
            "hsign",
            i,
            (c + 0.82) * cw,
            (r + 0.25) * ch,
            0.36 * cw,
            0.5 * ch,
            false,
            i + 1,
          );
        if (r < rows - 1)
          region(
            "vsign",
            i,
            (c + 0.25) * cw,
            (r + 0.82) * ch,
            0.5 * cw,
            0.36 * ch,
            false,
            i + cols,
          );
      }
    }

  // A pencil candidate note is not a printed clue: its cell stays under review
  // with no digit rather than proposing the note as a given.
  const notes = candidateNotes(entries);
  for (let i = entries.length - 1; i >= 0; i--)
    if (notes.has(entries[i])) {
      unreadCells.push(entries[i].cell);
      entries.splice(i, 1);
    }
  // Cages: the partition, then one clue region per cage in its head cell,
  // placed by the print style. Its text is read from a binarized crop.
  let cageAreas = null;
  if (isCage(type)) {
    const { areas, style } = cagePartition(mask, g, w, h, rows, cols, type), [x0, y0, x1, y1] = CAGE_LABEL_BOX[style];
    cageAreas = areas;
    for (const cells of areas) {
      const head = Math.min(...cells), r = Math.floor(head / cols), c = head % cols;
      entries.push({ kind: "label", cell: head, other: null, x: Math.round((c + x0) * cw), y: Math.round((r + y0) * ch),
        w: Math.round((x1 - x0) * cw), h: Math.round((y1 - y0) * ch), invert: false, text: "", confidence: 0, cageLabel: true });
    }
  }
  return { image, meta: estimateGrid(image, mask), mask, g, black, entries, unreadCells, cageAreas, contrastAdjusted: contrast.adjusted };
}

// Value glyphs that look like pencil candidate notes rather than printed
// clues: under 0.4 of the height of the grid's own clues (the 75th percentile
// of its value glyphs). Relative heights keep small newspaper fonts, and a
// grid with fewer than four glyphs has no norm. Measured on the corpus, 0.5
// or an extra small-and-off-centre test also took handwritten answers and
// clues in misaligned cells; 0.4 loses at most 44 correct clues in any set.
export function candidateNotes(entries) {
  const values = entries.filter((entry) => entry.kind === "value");
  if (values.length < 4) return new Set();
  const heights = values.map((entry) => entry.h).sort((a, b) => a - b),
    at = 0.75 * (heights.length - 1),
    low = Math.floor(at),
    reference = heights[low] + (heights[Math.min(heights.length - 1, low + 1)] - heights[low]) * (at - low);
  return new Set(values.filter((entry) => entry.h < 0.4 * reference));
}
