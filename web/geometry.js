// Dependency-free image geometry. All expensive calls run in a Web Worker.
export function gray(image) {
  const out = new Uint8Array(image.width * image.height),
    d = image.data;
  for (let i = 0; i < out.length; i++)
    out[i] = (77 * d[i * 4] + 150 * d[i * 4 + 1] + 29 * d[i * 4 + 2]) >> 8;
  return out;
}
export function threshold(image, window = 25, bias = 12) {
  return thresholdGray(gray(image), image.width, image.height, window, bias);
}
export function thresholdGray(g, w, h, window = 25, bias = 12, ceiling = 215) {
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h),
    half = window >> 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - half),
        b = Math.min(w, x + half + 1),
        c = Math.max(0, y - half),
        d = Math.min(h, y + half + 1);
      const mean =
        (sum[d * (w + 1) + b] -
          sum[c * (w + 1) + b] -
          sum[d * (w + 1) + a] +
          sum[c * (w + 1) + a]) /
        ((b - a) * (d - c));
      out[y * w + x] = g[y * w + x] < Math.min(ceiling, mean - bias) ? 1 : 0;
    }
  return out;
}
export function polygonArea(p) {
  return (
    Math.abs(
      p.reduce((s, a, i) => {
        const b = p[(i + 1) % p.length];
        return s + a.x * b.y - a.y * b.x;
      }, 0),
    ) / 2
  );
}
export function validQuad(p, w, h) {
  if (
    !Array.isArray(p) ||
    p.length !== 4 ||
    p.some(
      (q) =>
        !Number.isFinite(q.x) ||
        !Number.isFinite(q.y) ||
        q.x < 0 ||
        q.y < 0 ||
        q.x > w - 1 ||
        q.y > h - 1,
    )
  )
    return false;
  const cross = p.map((a, i) => {
    const b = p[(i + 1) % 4],
      c = p[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  return cross.every((n) => n > 1) && polygonArea(p) > w * h * 0.005;
}
// Homography maps unit-square coordinates to four clockwise image corners.
export function homography(p) {
  const [a, b, c, d] = p,
    dx1 = b.x - c.x,
    dx2 = d.x - c.x,
    dx3 = a.x - b.x + c.x - d.x,
    dy1 = b.y - c.y,
    dy2 = d.y - c.y,
    dy3 = a.y - b.y + c.y - d.y;
  const det = dx1 * dy2 - dx2 * dy1;
  let g = 0,
    h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    if (Math.abs(det) < 1e-9) throw Error("The crop corners are degenerate.");
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
  ];
}
export function project(m, u, v) {
  const z = m[6] * u + m[7] * v + 1;
  if (Math.abs(z) < 1e-10) throw Error("Invalid perspective.");
  return {
    x: (m[0] * u + m[1] * v + m[2]) / z,
    y: (m[3] * u + m[4] * v + m[5]) / z,
  };
}
export function warp(image, corners, width = 900, height = 900) {
  if (!validQuad(corners, image.width, image.height))
    throw Error("Keep the four crop corners clockwise without crossing.");
  width = Math.max(32, Math.min(1600, Math.round(width)));
  height = Math.max(32, Math.min(1600, Math.round(height)));
  const m = homography(corners),
    out = new Uint8ClampedArray(width * height * 4),
    iw = image.width,
    ih = image.height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pt = project(m, x / (width - 1), y / (height - 1));
      const sx = Math.max(0, Math.min(iw - 1, pt.x)),
        sy = Math.max(0, Math.min(ih - 1, pt.y));
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        x1 = Math.min(iw - 1, x0 + 1),
        y1 = Math.min(ih - 1, y0 + 1),
        fx = sx - x0,
        fy = sy - y0;
      const k = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++)
        out[k + ch] =
          (1 - fy) *
            ((1 - fx) * image.data[(y0 * iw + x0) * 4 + ch] +
              fx * image.data[(y0 * iw + x1) * 4 + ch]) +
          fy *
            ((1 - fx) * image.data[(y1 * iw + x0) * 4 + ch] +
              fx * image.data[(y1 * iw + x1) * 4 + ch]);
      out[k + 3] = 255;
    }
  return { width, height, data: out };
}
function groups(values, cutoff) {
  const out = [];
  let start = -1,
    peak = 0;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] > cutoff) {
      if (start < 0) { start = i; peak = 0; }
      peak = Math.max(peak, values[i]);
    } else if (start >= 0) {
      out.push({ at: (start + i - 1) / 2, width: i - start, peak });
      start = -1;
    }
  }
  return out;
}
// Fraction of ink along each column and row of a mask, optionally skipping
// the rows (columns) that belong to lines of the other axis.
export function lineProfile(b, w, h, skipRows = null, skipCols = null) {
  const x = new Float64Array(w),
    y = new Float64Array(h);
  let rows = 0,
    cols = 0;
  for (let r = 0; r < h; r++) if (!skipRows?.[r]) rows++;
  for (let c = 0; c < w; c++) if (!skipCols?.[c]) cols++;
  if (!rows || !cols) return lineProfile(b, w, h);
  for (let r = 0; r < h; r++) {
    const keepRow = !skipRows?.[r];
    for (let c = 0; c < w; c++) {
      const v = b[r * w + c];
      if (keepRow) x[c] += v / rows;
      if (!skipCols?.[c]) y[r] += v / cols;
    }
  }
  return { x, y };
}
// Lines are read from a mask more sensitive than the ink mask (bias 6, no
// ceiling): measured on real photographs, thin and light-grey grid lines
// reach only 25-45% darkness in the ink mask against a 47% cutoff, so one
// line dropped out in most rejected detections and only the thick box lines
// survived in others (a 3x3 reading). In the sensitive mask the weakest true
// line sits near 50-75% while the darkest column of digits stays near 30-40%.
const LINE_CUTOFF = 0.42;
export function gridLines(image, mask) {
  const w = image.width,
    h = image.height,
    b = mask ?? thresholdGray(gray(image), w, h, 25, 6, 255),
    first = lineProfile(b, w, h);
  // Every column crosses all the horizontal lines and vice versa; that shared
  // ink alone lifts a column of digits toward the cutoff. Measure each axis
  // again over the rows (columns) that are not lines of the other axis.
  const skipRows = new Uint8Array(h),
    skipCols = new Uint8Array(w);
  for (const l of groups(first.y, LINE_CUTOFF))
    for (let r = Math.max(0, Math.floor(l.at - l.width / 2 - 1)); r <= Math.min(h - 1, Math.ceil(l.at + l.width / 2 + 1)); r++) skipRows[r] = 1;
  for (const l of groups(first.x, LINE_CUTOFF))
    for (let c = Math.max(0, Math.floor(l.at - l.width / 2 - 1)); c <= Math.min(w - 1, Math.ceil(l.at + l.width / 2 + 1)); c++) skipCols[c] = 1;
  const profile = lineProfile(b, w, h, skipRows, skipCols);
  return { x: groups(profile.x, LINE_CUTOFF), y: groups(profile.y, LINE_CUTOFF) };
}
// Lines closer than 3% of the length are one line: a cage wall drawn just
// inside a cell edge, a doubled border, an anti-aliased thick line split by
// the threshold. The strongest member gives the position.
function cluster(lines, radius) {
  const out = [];
  for (const l of lines) {
    const last = out.at(-1);
    if (last && l.at - last.at <= radius) {
      last.width += l.width;
      if (l.peak > last.peak) { last.peak = l.peak; last.at = l.at; }
    } else out.push({ at: l.at, width: l.width, peak: l.peak });
  }
  return out;
}
// Fit an evenly spaced lattice to the detected lines. The spacing is the
// median gap, which survives one dropped line; the anchor is the strongest
// line. Lines off the lattice (a doubled border, a shadow) are strays,
// tolerated up to one in five; at least four in five lattice positions must
// hold a line, and the outermost ones must sit near the warp's edges.
function lattice(found, length) {
  const lines = cluster(found, length * 0.03);
  if (lines.length < 3) return 0;
  const at = lines.map((l) => l.at),
    gaps = at.slice(1).map((v, i) => v - at[i]).sort((a, b) => a - b),
    spacing = gaps[gaps.length >> 1];
  if (!(spacing > 0)) return 0;
  const anchor = lines.reduce((best, l) => (l.peak > best.peak ? l : best), lines[0]).at,
    kept = [],
    strays = [];
  for (const l of lines) {
    const k = Math.round((l.at - anchor) / spacing);
    (Math.abs(l.at - (anchor + k * spacing)) <= spacing * 0.25 ? kept : strays).push(l);
  }
  if (kept.length < 3 || strays.length > Math.floor(lines.length / 5)) return 0;
  const first = kept[0].at,
    last = kept.at(-1).at;
  if (first > length * 0.1 || last < length * 0.9) return 0;
  const cells = Math.round((last - first) / spacing);
  if (cells < 3 || cells > 25) return 0;
  const step = (last - first) / cells,
    present = new Map();
  for (const l of kept) {
    const k = Math.round((l.at - first) / step);
    if (Math.abs(l.at - (first + k * step)) > step * 0.25) return 0;
    present.set(k, Math.max(present.get(k) ?? 0, l.peak));
  }
  if (present.size < Math.ceil((cells + 1) * 0.8)) return 0;
  // Columns of digits sit half-way between lines. When every other lattice
  // position is markedly weaker than its neighbours, those are cell centres
  // and the true lattice is half as fine.
  if (cells % 2 === 0 && cells >= 6) {
    const even = [],
      odd = [];
    for (const [k, peak] of present) (k % 2 ? odd : even).push(peak);
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    if (odd.length && even.length && median(odd) < median(even) * 0.75) return cells / 2;
  }
  return cells;
}
function regular(lines, length) {
  return lattice(lines, length);
}
// Test one axis at a cell count the other axis established: the warp maps
// the quad to a square, so a square-celled grid has the same spacing both
// ways. Four in five positions must hold a line and strays stay bounded.
function latticeAt(found, length, cells) {
  const lines = cluster(found, length * 0.03),
    step = (length - 1) / cells;
  let present = 0,
    strays = 0;
  const seen = new Set();
  for (const l of lines) {
    const k = Math.round(l.at / step);
    if (k < 0 || k > cells || Math.abs(l.at - k * step) > step * 0.25) strays++;
    else if (!seen.has(k)) { seen.add(k); present++; }
  }
  return present >= Math.ceil((cells + 1) * 0.8) && strays <= Math.floor(lines.length / 5) ? cells : 0;
}
export function estimateGrid(image, mask) {
  const lines = gridLines(image, mask);
  let cols = regular(lines.x, image.width),
    rows = regular(lines.y, image.height);
  if (cols && !rows) rows = latticeAt(lines.y, image.height, cols);
  else if (rows && !cols) cols = latticeAt(lines.x, image.width, rows);
  let boxes = false;
  if (rows === cols && [4, 6, 9, 16, 25].includes(rows)) {
    const mid = lines.x.slice(1, -1),
      thin = Math.min(...mid.map((l) => l.width));
    boxes = mid.some((l) => l.width > thin * 1.45 && l.width >= 3);
  }
  return { rows, cols, boxes, lines };
}
export function findGrid(image) {
  const w = image.width,
    h = image.height,
    b = threshold(image),
    seen = new Uint8Array(b.length),
    queue = new Int32Array(b.length);
  let best = null,
    score = 0;
  for (let i = 0; i < b.length; i++) {
    if (!b[i] || seen[i]) continue;
    let head = 0,
      tail = 1;
    queue[0] = i;
    seen[i] = 1;
    let minx = w,
      maxx = 0,
      miny = h,
      maxy = 0,
      minsum = Infinity,
      maxsum = -Infinity,
      mindiff = Infinity,
      maxdiff = -Infinity;
    let tl, tr, br, bl;
    while (head < tail) {
      const k = queue[head++],
        x = k % w,
        y = Math.floor(k / w);
      minx = Math.min(minx, x);
      maxx = Math.max(maxx, x);
      miny = Math.min(miny, y);
      maxy = Math.max(maxy, y);
      if (x + y < minsum) {
        minsum = x + y;
        tl = { x, y };
      }
      if (x + y > maxsum) {
        maxsum = x + y;
        br = { x, y };
      }
      if (x - y < mindiff) {
        mindiff = x - y;
        bl = { x, y };
      }
      if (x - y > maxdiff) {
        maxdiff = x - y;
        tr = { x, y };
      }
      for (const j of [
        x > 0 ? k - 1 : -1,
        x < w - 1 ? k + 1 : -1,
        y > 0 ? k - w : -1,
        y < h - 1 ? k + w : -1,
      ])
        if (j >= 0 && b[j] && !seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
    }
    const area = (maxx - minx) * (maxy - miny),
      corners = [tl, tr, br, bl];
    if (
      area > w * h * 0.07 &&
      tail > 150 &&
      maxx - minx > w * 0.15 &&
      maxy - miny > h * 0.15 &&
      validQuad(corners, w, h) &&
      polygonArea(corners) > area * 0.5 &&
      area > score
    ) {
      score = area;
      best = corners;
    }
  }
  if (!best)
    return {
      corners: [
        { x: w * 0.08, y: h * 0.08 },
        { x: w * 0.92, y: h * 0.08 },
        { x: w * 0.92, y: h * 0.92 },
        { x: w * 0.08, y: h * 0.92 },
      ],
      confidence: 0,
      rows: 0,
      cols: 0,
      boxes: false,
    };
  const small = warp(image, best, 540, 540),
    estimated = estimateGrid(small);
  return {
    corners: best,
    confidence: estimated.rows && estimated.cols ? 0.94 : 0.45,
    ...estimated,
    lines: undefined,
  };
}
export function sharpness(image) {
  const g = gray(image),
    w = image.width,
    h = image.height;
  let sum = 0,
    count = 0;
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x,
        v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v * v;
      count++;
    }
  return sum / Math.max(count, 1);
}
