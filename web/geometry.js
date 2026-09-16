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
      out.push({ at: (start + i - 1) / 2, width: i - start, peak, lo: start, hi: i - 1 });
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
// Edge map: a pixel whose neighbours two apart differ by 30 levels or more,
// in either direction. Every boundary between a black cell and a white one
// is an edge exactly at the lattice, a grid line on paper is a pair of edges
// two or three pixels apart, and the inside of a black cell is nothing.
export function edgeMask(g, w, h) {
  const e = new Uint8Array(g.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(g[i + 1] - g[i - 1]) >= 30 || Math.abs(g[i + w] - g[i - w]) >= 30) e[i] = 1;
    }
  return e;
}
export function gridLines(image, mask, shear = null, mode = "ink") {
  const w = image.width,
    h = image.height,
    g = gray(image),
    b = mode === "edge" ? edgeMask(g, w, h) : mask ?? thresholdGray(g, w, h, 25, 6, 255);
  // The adaptive mask never marks the inside of a black cell, only its edges,
  // so a grid line running past black cells is visible only along white
  // cells and its column reads at half strength. Measure over the pixels that
  // are ink or not absolutely dark, so the line counts where it can be seen.
  // In edge mode a dark pixel counts only where it is an edge, so the
  // invisible boundary between two black cells is not held against a line.
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
  // The visible share and the mean grey of each column and row tell the
  // lattice what lies beyond an outer band: paper, or the table past the
  // page's edge.
  const visibleX = new Float64Array(w),
    visibleY = new Float64Array(h),
    grayX = new Float64Array(w),
    grayY = new Float64Array(h);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) {
      if (visible[i]) {
        visibleX[x]++;
        visibleY[y]++;
      }
      grayX[x] += g[i];
      grayY[y] += g[i];
    }
  for (let x = 0; x < w; x++) {
    visibleX[x] /= h;
    grayX[x] /= h;
  }
  for (let y = 0; y < h; y++) {
    visibleY[y] /= w;
    grayY[y] /= w;
  }
  return { x: groups(profile.x, LINE_CUTOFF), y: groups(profile.y, LINE_CUTOFF), shear: { x: shearX, y: shearY },
    beyondX: { visible: visibleX, gray: grayX }, beyondY: { visible: visibleY, gray: grayY } };
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
      last.hi = l.hi ?? l.at;
      if (l.peak > last.peak) { last.peak = l.peak; last.at = l.at; }
    } else out.push({ at: l.at, width: l.width, peak: l.peak, lo: l.lo ?? l.at, hi: l.hi ?? l.at });
  }
  return out;
}
// Fit an evenly spaced lattice to the detected lines. The spacing is the
// median gap, which survives one dropped line; the phase is the one that
// holds the most lines (the strongest line is no guide: a black border
// column reads as a band as strong as any line, centred half a cell inside
// the border). A band at least half a cell wide is a run of black cells, so
// either of its edges may sit on the lattice. Lines off the lattice (a
// doubled border, a shadow) are strays, tolerated up to one in five; at
// least four in five lattice positions must hold a line, and the outermost
// ones must sit near the warp's edges.
// The clustered lines of one axis without what lies beyond the paper: an
// outer wide group with darkness, or something darker than the grid's
// interior, between it and the warp's edge is the table along a page's edge
// or a toolbar when the line inside it is markedly thicker than the interior
// lines, since that line is then the grid's own border and the band lies
// beyond it. A screenshot's thick border with a dark toolbar beyond is the
// border itself, and a black clue band has white paper beyond it; both stay.
function trimmed(found, length, beyond) {
  const lines = cluster(found, length * 0.03);
  if (!beyond || lines.length < 4) return lines;
  const mean = (values, from, to) => {
      let sum = 0,
        n = 0;
      for (let i = Math.max(0, from); i < Math.min(length, to); i++) {
        sum += values[i];
        n++;
      }
      return n ? sum / n : null;
    },
    interior = mean(beyond.gray, lines[0].hi + 1, lines.at(-1).lo),
    outside = (from, to) => {
      const visible = mean(beyond.visible, from, to),
        gray = mean(beyond.gray, from, to);
      return visible !== null && (visible < 0.5 || (interior !== null && gray < interior * 0.8));
    },
    widths = lines.slice(2, -2).map((l) => l.width).sort((p, q) => p - q),
    typical = widths.length ? widths[widths.length >> 1] : Math.min(lines[1].width, lines.at(-2).width),
    border = (l) => l.width >= Math.max(3, typical * 1.4);
  if (lines[0].width >= length * 0.015 && border(lines[1]) && outside(0, lines[0].lo)) lines.shift();
  if (lines.at(-1).width >= length * 0.015 && border(lines.at(-2)) && outside(lines.at(-1).hi + 1, length)) lines.pop();
  return lines;
}
function lattice(found, length, beyond) {
  const lines = trimmed(found, length, beyond);
  if (lines.length < 3) return null;
  const at = lines.map((l) => l.at),
    gaps = at.slice(1).map((v, i) => v - at[i]).sort((a, b) => a - b),
    spacing = gaps[gaps.length >> 1];
  if (!(spacing > 0)) return null;
  // Where a line meets the lattice through `anchor`: its centre, or for a
  // wide band either edge; null when it is a stray.
  const meets = (l, anchor) => {
    for (const p of l.width >= spacing * 0.5 ? [l.at, l.lo, l.hi] : [l.at]) {
      const k = Math.round((p - anchor) / spacing);
      if (Math.abs(p - (anchor + k * spacing)) <= spacing * 0.25) return p;
    }
    return null;
  };
  let anchor = lines[0].at,
    most = -1;
  for (const l of lines) {
    const held = lines.reduce((n, m) => n + (meets(m, l.at) !== null ? 1 : 0), 0);
    if (held > most) { most = held; anchor = l.at; }
  }
  const kept = [],
    strays = [];
  for (const l of lines) {
    const pos = meets(l, anchor);
    if (pos === null) strays.push(l);
    else kept.push({ ...l, pos });
  }
  if (kept.length < 3 || strays.length > Math.floor(lines.length / 5)) return null;
  const first = kept[0].pos,
    last = kept.at(-1).pos,
    // The grid's border: a band's outer edge, a thin line's centre.
    outer = [kept[0].width >= spacing * 0.5 ? kept[0].lo : first, kept.at(-1).width >= spacing * 0.5 ? kept.at(-1).hi : last];
  if (first > length * 0.1 || last < length * 0.9) return null;
  const cells = Math.round((last - first) / spacing);
  if (cells < 3 || cells > 25) return null;
  const step = (last - first) / cells,
    present = new Map();
  for (const l of kept) {
    const k = Math.round((l.pos - first) / step);
    if (Math.abs(l.pos - (first + k * step)) > step * 0.25) return null;
    present.set(k, Math.max(present.get(k) ?? 0, l.peak));
  }
  if (present.size < Math.ceil((cells + 1) * 0.8)) return null;
  // How well the lines fit: the share of positions held, less the share of
  // lines that are strays. Two readings of one grid are compared by it.
  const quality = present.size / (cells + 1) - strays.length / lines.length;
  // Columns of digits sit half-way between lines. When every other lattice
  // position is markedly weaker than its neighbours, those are cell centres
  // and the true lattice is half as fine.
  if (cells % 2 === 0 && cells >= 6) {
    const even = [],
      odd = [];
    for (const [k, peak] of present) (k % 2 ? odd : even).push(peak);
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    if (odd.length && even.length && median(odd) < median(even) * 0.75) return { cells: cells / 2, first: outer[0], last: outer[1], quality };
  }
  return { cells, first: outer[0], last: outer[1], quality };
}
function regular(lines, length, beyond) {
  return lattice(lines, length, beyond) ?? { cells: 0, first: 0, last: length - 1, quality: 0 };
}
// Test one axis at a cell count the other axis established: the warp maps
// the quad to a square, so a square-celled grid has the same spacing both
// ways. Four in five positions must hold a line and strays stay bounded.
function latticeAt(found, length, cells, beyond) {
  const lines = trimmed(found, length, beyond),
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
    ? { cells, first: Number.isFinite(first) ? first : 0, last: Number.isFinite(last) ? last : length - 1,
      quality: present / (cells + 1) - strays / lines.length }
    : { cells: 0, first: 0, last: length - 1, quality: 0 };
}
export function estimateGrid(image, mask, shear = null, mode = "ink") {
  let lines = gridLines(image, mask, shear, mode),
    across = regular(lines.x, image.width, lines.beyondX),
    down = regular(lines.y, image.height, lines.beyondY);
  if (across.cells && !down.cells) down = latticeAt(lines.y, image.height, across.cells, lines.beyondY);
  else if (down.cells && !across.cells) across = latticeAt(lines.x, image.width, down.cells, lines.beyondX);
  // Black-heavy grids (Kakuro, a dense Str8ts) defeat the ink profile: a line
  // between two black cells is invisible and a black cell's marked rim sits
  // inside the cell. Their black/white boundaries are edges on the lattice.
  // The edge lattice must account for at least half of the ink profile's
  // groups, or faint cell lines would leave a coarse lattice of box lines.
  if (mode === "ink" && !(across.cells && down.cells)) {
    const edged = estimateGrid(image, undefined, shear, "edge");
    if (edged.rows && edged.cols && edged.rows + 1 >= lines.y.length * 0.5 && edged.cols + 1 >= lines.x.length * 0.5) return edged;
  }
  const cols = across.cells,
    rows = down.cells;
  let boxes = false;
  if (rows === cols && [4, 6, 9, 16, 25].includes(rows)) {
    const mid = lines.x.slice(1, -1),
      thin = Math.min(...mid.map((l) => l.width));
    boxes = mid.some((l) => l.width > thin * 1.45 && l.width >= 3);
  }
  return { rows, cols, boxes, lines,
    quality: rows && cols ? Math.min(across.quality, down.quality) : 0,
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
// A white line through a black region splits its ink component: a Kakuro
// corner cell cut by its clue diagonal leaves the corner triangle on its own,
// and a diagonal ending on a line intersection cuts the lines there too, so
// the extreme point slides a whole cell along the edge. Grow a component in
// hops: dilate the set by `gap` pixels, add the ink that meets and whatever
// ink connects to it, at most three times (so a caption a little further off
// stays out), and take the extreme points of the whole.
function widened(b, w, h, start, gap, queue) {
  const inSet = new Uint8Array(b.length),
    mark = new Uint8Array(b.length),
    step = (k, visit) => {
      const x = k % w,
        y = (k - x) / w;
      if (x > 0) visit(k - 1);
      if (x < w - 1) visit(k + 1);
      if (y > 0) visit(k - w);
      if (y < h - 1) visit(k + w);
    };
  let tail = 0;
  const grow = (from) => {
    let head = from;
    while (head < tail)
      step(queue[head++], (j) => {
        if (b[j] && !inSet[j]) {
          inSet[j] = 1;
          queue[tail++] = j;
        }
      });
  };
  inSet[start] = 1;
  queue[tail++] = start;
  grow(0);
  for (let hop = 1; hop <= 3; hop++) {
    // Layers of the dilation live past the set in the same queue; every
    // pixel enters at most once per hop, so the queue cannot overflow.
    const met = [];
    let layerStart = 0,
      layerEnd = tail,
      hi = tail;
    for (let l = 1; l <= gap && layerStart < layerEnd; l++) {
      const nextStart = hi;
      for (let q = layerStart; q < layerEnd; q++)
        step(queue[q], (j) => {
          if (!inSet[j] && mark[j] !== hop) {
            mark[j] = hop;
            queue[hi++] = j;
            if (b[j]) met.push(j);
          }
        });
      layerStart = nextStart;
      layerEnd = hi;
    }
    if (!met.length) break;
    const from = tail;
    for (const j of met)
      if (!inSet[j]) {
        inSet[j] = 1;
        queue[tail++] = j;
      }
    grow(from);
  }
  let minsum = Infinity,
    maxsum = -Infinity,
    mindiff = Infinity,
    maxdiff = -Infinity,
    tl, tr, br, bl;
  for (let q = 0; q < tail; q++) {
    const k = queue[q],
      x = k % w,
      y = (k - x) / w;
    if (x + y < minsum) { minsum = x + y; tl = { x, y }; }
    if (x + y > maxsum) { maxsum = x + y; br = { x, y }; }
    if (x - y < mindiff) { mindiff = x - y; bl = { x, y }; }
    if (x - y > maxdiff) { maxdiff = x - y; tr = { x, y }; }
  }
  return [tl, tr, br, bl];
}
export function findGrid(image) {
  const w = image.width,
    h = image.height,
    b = threshold(image),
    seen = new Uint8Array(b.length),
    queue = new Int32Array(b.length),
    // Gaps up to about half a percent of the frame are bridged: a clue
    // diagonal at any scale, not a caption a few millimetres from the grid.
    gap = Math.max(2, Math.round(Math.max(w, h) * 0.006)),
    widen = (candidate) => {
      if (!candidate.wide) {
        const wide = widened(b, w, h, candidate.start, gap, queue);
        candidate.wide = validQuad(wide, w, h) && polygonArea(wide) >= polygonArea(candidate.corners) ? wide : candidate.corners;
      }
      return candidate.wide;
    };
  const candidates = [],
    pieces = [];
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
      corners = [tl, tr, br, bl],
      piece = { corners, area, minx, miny, maxx, maxy, start: i };
    if (tail > 150) pieces.push(piece);
    if (
      area > w * h * 0.07 &&
      tail > 150 &&
      maxx - minx > w * 0.15 &&
      maxy - miny > h * 0.15 &&
      validQuad(corners, w, h) &&
      polygonArea(corners) > area * 0.5
    )
      candidates.push(piece);
  }
  // A grid whose lines are cut at many intersections by clue diagonals is a
  // heap of fragments, none a grid-sized quad on its own. When nothing
  // qualifies, the largest pieces are widened and judged by what they
  // gather.
  if (!candidates.length) {
    pieces.sort((p, q) => q.area - p.area);
    for (const piece of pieces.slice(0, 3)) {
      const wide = widen(piece),
        xs = wide.map((p) => p.x),
        ys = wide.map((p) => p.y),
        minx = Math.min(...xs),
        maxx = Math.max(...xs),
        miny = Math.min(...ys),
        maxy = Math.max(...ys),
        area = (maxx - minx) * (maxy - miny);
      if (wide !== piece.corners && area > w * h * 0.07 && maxx - minx > w * 0.15 && maxy - miny > h * 0.15 &&
        validQuad(wide, w, h) && polygonArea(wide) > area * 0.5)
        candidates.push({ ...piece, corners: wide, wide, area, minx, miny, maxx, maxy });
    }
  }
  candidates.sort((p, q) => q.area - p.area);
  if (!candidates.length)
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
  const result = (settled, confidence) => ({ corners: settled.corners, confidence, ...settled.estimated, lines: undefined, extent: undefined, quality: undefined }),
    found = (settled) => Boolean(settled.estimated.rows && settled.estimated.cols),
    pitch = (settled) => Math.hypot(settled.corners[1].x - settled.corners[0].x, settled.corners[1].y - settled.corners[0].y) / settled.estimated.cols,
    samePitch = (p, q) => Math.abs(pitch(p) / pitch(q) - 1) < 0.15,
    // A candidate is read from its own extreme points and, when they differ
    // materially, from the widened ones too (widening can also pull in a
    // toolbar or caption a few pixels from the grid). The widened reading
    // wins when it is the clearly better fit, or holds more cells of the
    // same pitch about as well: a corner slid along an edge skews the warp
    // and can leave a regular lattice with lines missing and strays, and a
    // quad short by a black clue band leaves one a column short.
    tried = (candidate) => {
      if (candidate.tried) return candidate.tried;
      const plain = settle(image, candidate.corners),
        wide = widen(candidate),
        diagonal = Math.hypot(candidate.corners[2].x - candidate.corners[0].x, candidate.corners[2].y - candidate.corners[0].y),
        moved = Math.max(...wide.map((p, i) => Math.hypot(p.x - candidate.corners[i].x, p.y - candidate.corners[i].y)));
      let outcome = plain;
      if (moved > diagonal * 0.01) {
        const wider = settle(image, wide);
        if (found(wider) && (!found(plain) ||
          wider.estimated.quality > plain.estimated.quality + 0.05 ||
          (samePitch(wider, plain) && wider.estimated.rows + wider.estimated.cols > plain.estimated.rows + plain.estimated.cols &&
            wider.estimated.quality > plain.estimated.quality - 0.1)))
          outcome = wider;
      }
      return (candidate.tried = outcome);
    },
    inside = (q, x, y) => {
      for (let i = 0; i < 4; i++) {
        const a = q[i],
          c = q[(i + 1) % 4];
        if ((c.x - a.x) * (y - a.y) - (c.y - a.y) * (x - a.x) < 0) return false;
      }
      return true;
    },
    // The share of ink in the ring between two settled quads, sampled every
    // other pixel. The outer quad is inset by three gaps first: along a
    // paper's edge the dark table is marked as a band that the settled quad
    // reaches the outside of, and it must not count as the ring's ink; the
    // inner rim of a black clue band survives the inset.
    ring = (whole, inner) => {
      const diagonal = Math.hypot(whole[2].x - whole[0].x, whole[2].y - whole[0].y),
        outer = padded(whole, w, h, -Math.min(0.2, (gap * 3) / (diagonal / 2))),
        xs = outer.map((p) => p.x),
        ys = outer.map((p) => p.y);
      let ink = 0,
        total = 0;
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y += 2)
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x += 2) {
          if (!inside(outer, x, y) || inside(inner, x, y)) continue;
          total++;
          ink += b[y * w + x];
        }
      return total ? ink / total : 0;
    };
  // A photograph of a page on a dark table makes the page's edge the largest
  // component, a thin ring around the grid. When a substantial candidate lies
  // inside the largest one, it is the grid if it carries a lattice, unless
  // the largest carries a lattice of the same pitch and the ring between
  // the two settled quads is full of ink: then the inner one is a sub-grid
  // of a grid whose black clue cells were cut off by their diagonals, and
  // the whole grid wins. Empty paper between a grid and the page's edge is
  // not that, even when the edge sits one cell out.
  if (candidates.length > 1) {
    const outer = candidates[0];
    for (const inner of candidates.slice(1, 3)) {
      if (inner.area < outer.area * 0.25 || inner.minx < outer.minx || inner.miny < outer.miny ||
        inner.maxx > outer.maxx || inner.maxy > outer.maxy) continue;
      const within = tried(inner);
      if (!found(within)) continue;
      if (ring(outer.corners, within.corners) < 0.2) return result(within, 0.94);
      const whole = tried(outer);
      if (found(whole) && samePitch(whole, within) && ring(whole.corners, within.corners) >= 0.2) return result(whole, 0.94);
      return result(within, 0.94);
    }
  }
  const settled = tried(candidates[0]);
  return result(settled, found(settled) ? 0.94 : 0.45);
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
