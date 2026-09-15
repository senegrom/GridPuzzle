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
// the rows (columns) that belong to lines of the other axis, and counting
// only the pixels marked visible. A column or row that is mostly hidden
// cannot carry a line.
// ``shearX`` slants the columns: a vertical line that drifts by shearX
// pixels from the top row to the bottom row is read as one column.
// ``shearY`` does the same for rows.
export function lineProfile(b, w, h, skipRows = null, skipCols = null, visible = null, shearX = 0, shearY = 0) {
  const x = new Float64Array(w),
    y = new Float64Array(h),
    nx = new Int32Array(w),
    ny = new Int32Array(h);
  for (let r = 0; r < h; r++) {
    const keepRow = !skipRows?.[r],
      dx = Math.round(shearX * (r / (h - 1) - 0.5));
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (visible && !visible[i]) continue;
      if (keepRow) {
        const cc = c - dx;
        if (cc >= 0 && cc < w) { x[cc] += b[i]; nx[cc]++; }
      }
      if (!skipCols?.[c]) {
        const rr = r - Math.round(shearY * (c / (w - 1) - 0.5));
        if (rr >= 0 && rr < h) { y[rr] += b[i]; ny[rr]++; }
      }
    }
  }
  for (let c = 0; c < w; c++) x[c] = nx[c] >= h * 0.2 ? x[c] / nx[c] : 0;
  for (let r = 0; r < h; r++) y[r] = ny[r] >= w * 0.2 ? y[r] / ny[r] : 0;
  return { x, y };
}
// The shear (in pixels over the full length) that makes the profile sharpest.
// A line slanted across k columns spreads its ink over k of them, so the sum
// of squared column values is largest when the shear straightens it.
function bestShear(b, w, h, visible, axis) {
  // Scored on every sixth row (column): the energy of a profile is a coarse
  // measure and the subsample keeps the search to a couple of milliseconds.
  const along = axis === "x" ? w : h,
    across = axis === "x" ? h : w,
    acc = new Float64Array(along),
    count = new Int32Array(along);
  const score = (shear) => {
    acc.fill(0); count.fill(0);
    for (let t = 0; t < across; t += 6) {
      const drift = Math.round(shear * (t / (across - 1) - 0.5));
      for (let a = 0; a < along; a++) {
        const i = axis === "x" ? t * w + a : a * w + t;
        if (visible && !visible[i]) continue;
        const aa = a - drift;
        if (aa >= 0 && aa < along) { acc[aa] += b[i]; count[aa]++; }
      }
    }
    let sum = 0;
    for (let a = 0; a < along; a++) if (count[a]) { const v = acc[a] / count[a]; sum += v * v; }
    return sum;
  };
  let best = 0,
    bestScore = -1;
  for (const shear of [-12, -6, 0, 6, 12]) {
    const value = score(shear);
    if (value > bestScore) { bestScore = value; best = shear; }
  }
  const coarse = best;
  for (const shear of [coarse - 3, coarse + 3]) {
    const value = score(shear);
    if (value > bestScore) { bestScore = value; best = shear; }
  }
  return best;
}
// Lines are read from a mask more sensitive than the ink mask (bias 6, no
// ceiling): measured on real photographs, thin and light-grey grid lines
// reach only 25-45% darkness in the ink mask against a 47% cutoff, so one
// line dropped out in most rejected detections and only the thick box lines
// survived in others (a 3x3 reading). In the sensitive mask the weakest true
// line sits near 50-75% while the darkest column of digits stays near 30-40%.
const LINE_CUTOFF = 0.42;
export function gridLines(image, mask, shear = null) {
  const w = image.width,
    h = image.height,
    g = gray(image),
    b = mask ?? thresholdGray(g, w, h, 25, 6, 255);
  // The adaptive mask never marks the inside of a black cell, only its edges,
  // so a grid line running past black cells is visible only along white
  // cells and its column reads at half strength. Measure over the pixels that
  // are ink or not absolutely dark, so the line counts where it can be seen.
  const visible = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) visible[i] = b[i] || g[i] >= 50 ? 1 : 0;
  // A quad a few percent off the grid slants every line in the warp and
  // smears its column; read each axis in the frame that straightens it.
  const shearX = shear ? shear.x : bestShear(b, w, h, visible, "x"),
    shearY = shear ? shear.y : bestShear(b, w, h, visible, "y"),
    first = lineProfile(b, w, h, null, null, visible, shearX, shearY);
  // Every column crosses all the horizontal lines and vice versa; that shared
  // ink alone lifts a column of digits toward the cutoff. Measure each axis
  // again over the rows (columns) that are not lines of the other axis. The
  // bands are widened by the shear so a slanted line is excluded entirely.
  const skipRows = new Uint8Array(h),
    skipCols = new Uint8Array(w);
  for (const l of groups(first.y, LINE_CUTOFF))
    for (let r = Math.max(0, Math.floor(l.at - l.width / 2 - 1 - Math.abs(shearY) / 2)); r <= Math.min(h - 1, Math.ceil(l.at + l.width / 2 + 1 + Math.abs(shearY) / 2)); r++) skipRows[r] = 1;
  for (const l of groups(first.x, LINE_CUTOFF))
    for (let c = Math.max(0, Math.floor(l.at - l.width / 2 - 1 - Math.abs(shearX) / 2)); c <= Math.min(w - 1, Math.ceil(l.at + l.width / 2 + 1 + Math.abs(shearX) / 2)); c++) skipCols[c] = 1;
  const profile = lineProfile(b, w, h, skipRows, skipCols, visible, shearX, shearY);
  return { x: groups(profile.x, LINE_CUTOFF), y: groups(profile.y, LINE_CUTOFF), shear: { x: shearX, y: shearY } };
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
      last.hi = l.at;
      if (l.peak > last.peak) { last.peak = l.peak; last.at = l.at; }
    } else out.push({ at: l.at, width: l.width, peak: l.peak, lo: l.at, hi: l.at });
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
  if (lines.length < 3) return null;
  const at = lines.map((l) => l.at),
    gaps = at.slice(1).map((v, i) => v - at[i]).sort((a, b) => a - b),
    spacing = gaps[gaps.length >> 1];
  if (!(spacing > 0)) return null;
  const anchor = lines.reduce((best, l) => (l.peak > best.peak ? l : best), lines[0]).at,
    kept = [],
    strays = [];
  for (const l of lines) {
    const k = Math.round((l.at - anchor) / spacing);
    (Math.abs(l.at - (anchor + k * spacing)) <= spacing * 0.25 ? kept : strays).push(l);
  }
  if (kept.length < 3 || strays.length > Math.floor(lines.length / 5)) return null;
  const first = kept[0].at,
    last = kept.at(-1).at,
    outer = [kept[0].lo, kept.at(-1).hi];
  if (first > length * 0.1 || last < length * 0.9) return null;
  const cells = Math.round((last - first) / spacing);
  if (cells < 3 || cells > 25) return null;
  const step = (last - first) / cells,
    present = new Map();
  for (const l of kept) {
    const k = Math.round((l.at - first) / step);
    if (Math.abs(l.at - (first + k * step)) > step * 0.25) return null;
    present.set(k, Math.max(present.get(k) ?? 0, l.peak));
  }
  if (present.size < Math.ceil((cells + 1) * 0.8)) return null;
  // Columns of digits sit half-way between lines. When every other lattice
  // position is markedly weaker than its neighbours, those are cell centres
  // and the true lattice is half as fine.
  if (cells % 2 === 0 && cells >= 6) {
    const even = [],
      odd = [];
    for (const [k, peak] of present) (k % 2 ? odd : even).push(peak);
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    if (odd.length && even.length && median(odd) < median(even) * 0.75) return { cells: cells / 2, first: outer[0], last: outer[1] };
  }
  return { cells, first: outer[0], last: outer[1] };
}
function regular(lines, length) {
  return lattice(lines, length) ?? { cells: 0, first: 0, last: length - 1 };
}
// Test one axis at a cell count the other axis established: the warp maps
// the quad to a square, so a square-celled grid has the same spacing both
// ways. Four in five positions must hold a line and strays stay bounded.
function latticeAt(found, length, cells) {
  const lines = cluster(found, length * 0.03),
    step = (length - 1) / cells;
  let present = 0,
    strays = 0,
    first = Infinity,
    last = -Infinity;
  const seen = new Set();
  for (const l of lines) {
    const k = Math.round(l.at / step);
    if (k < 0 || k > cells || Math.abs(l.at - k * step) > step * 0.25) strays++;
    else {
      if (!seen.has(k)) { seen.add(k); present++; }
      if (k === 0) first = Math.min(first, l.at);
      if (k === cells) last = Math.max(last, l.at);
    }
  }
  return present >= Math.ceil((cells + 1) * 0.8) && strays <= Math.floor(lines.length / 5)
    ? { cells, first: Number.isFinite(first) ? first : 0, last: Number.isFinite(last) ? last : length - 1 }
    : { cells: 0, first: 0, last: length - 1 };
}
export function estimateGrid(image, mask, shear = null) {
  const lines = gridLines(image, mask, shear);
  let across = regular(lines.x, image.width),
    down = regular(lines.y, image.height);
  if (across.cells && !down.cells) down = latticeAt(lines.y, image.height, across.cells);
  else if (down.cells && !across.cells) across = latticeAt(lines.x, image.width, down.cells);
  const cols = across.cells,
    rows = down.cells;
  let boxes = false;
  if (rows === cols && [4, 6, 9, 16, 25].includes(rows)) {
    const mid = lines.x.slice(1, -1),
      thin = Math.min(...mid.map((l) => l.width));
    boxes = mid.some((l) => l.width > thin * 1.45 && l.width >= 3);
  }
  return { rows, cols, boxes, lines,
    extent: rows && cols ? { x: [across.first, across.last], y: [down.first, down.last], shear: lines.shear } : null };
}
// A quad pushed outward from its centre by a fraction of its size, clamped
// to the image.
function padded(corners, width, height, fraction = 0.04) {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4,
    cy = corners.reduce((sum, p) => sum + p.y, 0) / 4;
  return corners.map((p) => ({
    x: Math.min(width - 1, Math.max(0, p.x + (p.x - cx) * fraction)),
    y: Math.min(height - 1, Math.max(0, p.y + (p.y - cy) * fraction)),
  }));
}
// The outline's extreme points can sit a few percent off the grid (a digit
// touching the border, a black corner cell missing from the ink mask, a
// shadow), and a warp cut exactly at the border leaves the border line
// without a lighter neighbour on its outer side, so along black cells it is
// never marked. The quad is therefore warped with a small outward margin;
// the lattice's outer lines are the grid's border, mapped back through the
// homography, and the tighter quad is confirmed with a second padded warp
// that must find the same lattice.
function settle(image, corners) {
  const size = 540,
    grown = padded(corners, image.width, image.height),
    // Clamping a quad that touches the frame can fold it; fall back to the
    // quad itself rather than let the warp refuse it.
    loose = validQuad(grown, image.width, image.height) ? grown : corners,
    estimated = estimateGrid(warp(image, loose, size, size));
  if (!estimated.rows || !estimated.cols || !estimated.extent) return { corners, estimated };
  const [x0, x1] = estimated.extent.x,
    [y0, y1] = estimated.extent.y,
    { x: shearX, y: shearY } = estimated.extent.shear,
    m = homography(loose),
    at = (u, v) => {
      const p = project(m, u / (size - 1), v / (size - 1));
      return { x: Math.min(image.width - 1, Math.max(0, p.x)), y: Math.min(image.height - 1, Math.max(0, p.y)) };
    },
    // A vertical line read at column x0 in the sheared frame sits at
    // x0 + shearX * (v / (size - 1) - 0.5) in row v of the warp, and likewise
    // for horizontal lines; a corner is where an outer line of each axis meets.
    corner = (x, y) => {
      let v = y, u = x;
      for (let pass = 0; pass < 3; pass++) {
        u = x + shearX * (v / (size - 1) - 0.5);
        v = y + shearY * (u / (size - 1) - 0.5);
      }
      return at(u, v);
    },
    tight = [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)],
    diagonal = Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
  const moved = Math.max(...tight.map((p, i) => Math.hypot(p.x - corners[i].x, p.y - corners[i].y)));
  if (!validQuad(tight, image.width, image.height) || moved > diagonal * 0.12) return { corners, estimated };
  // A refinement within one percent needs no confirmation; a larger move is
  // confirmed on a second padded warp, which after settling has no skew left
  // to search for.
  if (moved <= diagonal * 0.01) return { corners: tight, estimated };
  const grownTight = padded(tight, image.width, image.height),
    again = estimateGrid(warp(image, validQuad(grownTight, image.width, image.height) ? grownTight : tight, size, size), undefined, { x: 0, y: 0 });
  return again.rows === estimated.rows && again.cols === estimated.cols
    ? { corners: tight, estimated: again }
    : { corners, estimated };
}
export function findGrid(image) {
  const w = image.width,
    h = image.height,
    b = threshold(image),
    seen = new Uint8Array(b.length),
    queue = new Int32Array(b.length);
  const candidates = [];
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
      polygonArea(corners) > area * 0.5
    )
      candidates.push({ corners, area, minx, miny, maxx, maxy });
  }
  candidates.sort((p, q) => q.area - p.area);
  let best = candidates[0]?.corners ?? null;
  // A photograph of a page on a dark table makes the page's edge the largest
  // component, a thin ring around the grid. When a substantial candidate lies
  // inside the largest one, it is the grid if it carries a lattice.
  if (candidates.length > 1) {
    const outer = candidates[0];
    for (const inner of candidates.slice(1, 3)) {
      if (inner.area < outer.area * 0.25 || inner.minx < outer.minx || inner.miny < outer.miny ||
        inner.maxx > outer.maxx || inner.maxy > outer.maxy) continue;
      const settled = settle(image, inner.corners);
      if (settled.estimated.rows && settled.estimated.cols)
        return { corners: settled.corners, confidence: 0.94, ...settled.estimated, lines: undefined, extent: undefined };
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
  const settled = settle(image, best);
  return {
    corners: settled.corners,
    confidence: settled.estimated.rows && settled.estimated.cols ? 0.94 : 0.45,
    ...settled.estimated,
    lines: undefined,
    extent: undefined,
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
