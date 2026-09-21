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
// Whether a grey image is a screen with a light-on-dark theme: mostly dark,
// and what stands out from the median is bright (lines, digits) rather than
// dark (ink on a dimly lit page). Sampled, so a warp costs nothing.
function lightOnDark(g) {
  const bins = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < g.length; i += 5) {
    bins[g[i]]++;
    n++;
  }
  let median = 0,
    seen = 0;
  while (median < 255 && seen + bins[median] < n / 2) seen += bins[median++];
  if (median >= 128) return false;
  let bright = 0,
    dark = 0;
  for (let v = 0; v < 256; v++) {
    if (v > median + 40) bright += bins[v];
    else if (v < median - 40) dark += bins[v];
  }
  return bright > n * 0.02 && bright > dark * 1.5;
}
export function inverted(g) {
  const out = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = 255 - g[i];
  return out;
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
function polygonArea(p) {
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
function lineProfile(b, w, h, skipRows = null, skipCols = null, visible = null, shearX = 0, shearY = 0) {
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
// The longest continuous run of ink along each column and row as a share of
// the length, read in the sheared frame and tolerating one pixel sideways.
// A grid line runs the height of the warp; pencil marks, candidates and
// handwriting break at every cell and never reach the cutoff.
function runProfile(b, w, h, shearX = 0, shearY = 0) {
  const x = new Float64Array(w),
    y = new Float64Array(h);
  for (let c = 0; c < w; c++) {
    let run = 0,
      best = 0;
    for (let r = 0; r < h; r++) {
      const cc = Math.round(c + shearX * (r / (h - 1) - 0.5)),
        i = r * w + cc,
        ink = cc >= 0 && cc < w && (b[i] || (cc > 0 && b[i - 1]) || (cc < w - 1 && b[i + 1]));
      run = ink ? run + 1 : 0;
      if (run > best) best = run;
    }
    x[c] = best / h;
  }
  for (let r = 0; r < h; r++) {
    let run = 0,
      best = 0;
    for (let c = 0; c < w; c++) {
      const rr = Math.round(r + shearY * (c / (w - 1) - 0.5)),
        i = rr * w + c,
        ink = rr >= 0 && rr < h && (b[i] || (rr > 0 && b[i - w]) || (rr < h - 1 && b[i + w]));
      run = ink ? run + 1 : 0;
      if (run > best) best = run;
    }
    y[r] = best / w;
  }
  return { x, y };
}
// `mode` picks what counts as a line: "ink" the adaptive mask, "run" the
// longest continuous run of ink.
export function gridLines(image, mask, shear = null, mode = "ink", invert = false) {
  const w = image.width,
    h = image.height,
    // Inverted, a screen with a light-on-dark theme has its light lines as
    // ink and its background as paper.
    g = invert ? inverted(gray(image)) : gray(image),
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
  const profile = mode === "run" ? runProfile(b, w, h, shearX, shearY) : lineProfile(b, w, h, skipRows, skipCols, visible, shearX, shearY),
    cutoff = mode === "run" ? 0.5 : LINE_CUTOFF;
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
  // Plain data only: this travels to the page with the warp's metadata, and
  // a function cannot be cloned across that boundary.
  return { x: groups(profile.x, cutoff), y: groups(profile.y, cutoff), shear: { x: shearX, y: shearY },
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
// median gap refined by a global fit; the phase is the one that
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
    initialSpacing = gaps[gaps.length >> 1];
  if (!(initialSpacing > 0)) return null;
  // Pixel-rounded adjacent gaps are only a seed. Extrapolating a 22px
  // median across a 25-cell warp (true pitch 539/25) loses real end lines.
  // Refine phase AND pitch over the currently supported thin lines before
  // deciding which lines are strays. Wide black-cell bands still meet the
  // lattice with their centre or either edge, but do not bias the fit.
  const meets = (l, anchor, spacing) => {
    for (const p of l.width >= spacing * 0.5 ? [l.at, l.lo, l.hi] : [l.at]) {
      const k = Math.round((p - anchor) / spacing);
      if (Math.abs(p - (anchor + k * spacing)) <= spacing * 0.25) return p;
    }
    return null;
  };
  let anchor = lines[0].at, spacing = initialSpacing, most = -1, bestError = Infinity;
  for (const line of lines) {
    let phase = line.at, pitch = initialSpacing;
    for (let pass = 0; pass < 3; pass++) {
      const points = lines.filter(l => l.width < pitch * 0.5 && meets(l, phase, pitch) !== null)
        .map(l => ({ k: Math.round((l.at - phase) / pitch), p: l.at }));
      if (points.length < 3) break;
      const meanK = points.reduce((sum, p) => sum + p.k, 0) / points.length,
        meanP = points.reduce((sum, p) => sum + p.p, 0) / points.length,
        variance = points.reduce((sum, p) => sum + (p.k - meanK) ** 2, 0);
      if (!variance) break;
      const next = points.reduce((sum, p) => sum + (p.k - meanK) * (p.p - meanP), 0) / variance;
      // Refine this hypothesis, never jump to a different lattice harmonic.
      if (Math.abs(next - initialSpacing) > initialSpacing * 0.1) break;
      pitch = next; phase = meanP - pitch * meanK;
    }
    let held = 0, error = 0;
    for (const l of lines) {
      const p = meets(l, phase, pitch);
      if (p === null) continue;
      held++;
      error += ((p - phase) / pitch - Math.round((p - phase) / pitch)) ** 2;
    }
    if (held > most || (held === most && error < bestError)) {
      most = held; bestError = error; anchor = phase; spacing = pitch;
    }
  }
  const kept = [],
    strays = [];
  for (const l of lines) {
    const pos = meets(l, anchor, spacing);
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
// The longest regular run of lines anywhere along an axis, at least `least`
// long and at most `most`: gaps within a quarter of their median. The grid
// may occupy only part of the warp when the quad took in a toolbar or a
// page beside it. Ties go to the stronger run.
function regularRun(lines, least, most = Infinity) {
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + least - 1; j < lines.length && j - i < most; j++) {
      const run = lines.slice(i, j + 1),
        gaps = run.slice(1).map((l, k) => l.at - run[k].at),
        median = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
      if (gaps.some((g) => Math.abs(g - median) > median * 0.25)) break;
      const strength = run.reduce((sum, l) => sum + l.peak, 0) / run.length;
      if (!best || run.length > best.run.length || (run.length === best.run.length && strength > best.strength))
        best = { run, strength, pitch: median };
    }
  }
  return best;
}
// A lattice from a regular run: its cells, its extent and a quality that
// counts the lines outside the run as strays. The run must hold at least
// three fifths of the axis's lines, or a window of a fragmented grid would
// pass as a smaller grid.
function runLattice(best, lines, length) {
  // The run must hold seven tenths of the axis's lines and span half the
  // warp: the grid is the greater part of its own quad, and a run over a
  // corner of it is some other regular thing in the frame.
  if (!best || best.run.length < lines.length * 0.7) return null;
  if (best.run.at(-1).at - best.run[0].at < length * 0.5) return null;
  const { run } = best;
  return { cells: run.length - 1, first: run[0].at, last: run.at(-1).at, quality: 1 - (lines.length - run.length) / lines.length, partial: true };
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
export function estimateGrid(image, mask, shear = null, aspect = 1, invert = false, thorough = true) {
  let lines = gridLines(image, mask, shear, "ink", invert),
    across = regular(lines.x, image.width, lines.beyondX),
    down = regular(lines.y, image.height, lines.beyondY);
  if (across.cells && !down.cells) down = latticeAt(lines.y, image.height, across.cells, lines.beyondY);
  else if (down.cells && !across.cells) across = latticeAt(lines.x, image.width, down.cells, lines.beyondX);
  // Cells full of pencil marks or handwriting lift columns of small digits
  // over the cutoff and bury the lattice in strays. Lines are continuous
  // where marks are not: the longest-run profile keeps only what runs the
  // length of the warp.
  if (thorough && !(across.cells && down.cells)) {
    const runs = gridLines(image, mask, lines.shear, "run", invert),
      runAcross = regular(runs.x, image.width, runs.beyondX),
      runDown = regular(runs.y, image.height, runs.beyondY);
    // At least five cells each way: a coarser lattice found only by continuous
    // runs is the box lines of a nine-cell grid whose cell lines are broken,
    // not a small grid, which the ink profile reads on its own.
    if (runAcross.cells >= 5 && runDown.cells >= 5) {
      lines = runs;
      across = runAcross;
      down = runDown;
    }
  }
  // Last resort: the grid occupies only part of the warp because the quad
  // took in a toolbar or a page beside it. When one axis spans the warp, the
  // other is searched for a regular run of exactly its number of lines; when
  // neither does, both are searched for runs of at least five lines whose
  // pitches agree with the quad's aspect (square cells). settle() must then
  // confirm the tightened quad, or the reading is dropped.
  if (!(across.cells && down.cells)) {
    const tx = trimmed(lines.x, image.width, lines.beyondX),
      ty = trimmed(lines.y, image.height, lines.beyondY);
    if (across.cells && !down.cells) {
      const run = regularRun(ty, across.cells + 1, across.cells + 1);
      if (run && run.run.length === across.cells + 1) down = runLattice(run, ty, image.height) ?? down;
    } else if (down.cells && !across.cells) {
      const run = regularRun(tx, down.cells + 1, down.cells + 1);
      if (run && run.run.length === down.cells + 1) across = runLattice(run, tx, image.width) ?? across;
    } else {
      const runX = regularRun(tx, 5, 26),
        runY = regularRun(ty, 5, 26);
      if (runX && runY && Math.abs(runX.pitch / runY.pitch / aspect - 1) < 0.25) {
        const partialX = runLattice(runX, tx, image.width),
          partialY = runLattice(runY, ty, image.height);
        if (partialX && partialY) {
          across = partialX;
          down = partialY;
        }
      }
    }
  }
  // Nothing at either polarity of ink: a screen with a light-on-dark theme,
  // whose light lines are not ink at all. Inverting is a last chance rather
  // than a reflex, since a dimly lit page is mostly dark too. It runs even
  // for a live frame: a dark theme is the commonest thing the line stage
  // cannot read, and one more profile is cheap beside a second outline.
  if (!invert && !(across.cells && down.cells) && lightOnDark(gray(image))) {
    // The skew is a property of the quad, not of the ink's polarity: the
    // inverted pass reuses the shear rather than searching for it again.
    const flipped = estimateGrid(image, undefined, shear ?? lines.shear, aspect, true, thorough);
    if (flipped.rows && flipped.cols) return flipped;
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
    partial: Boolean(rows && cols && (across.partial || down.partial)),
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
function settle(image, corners, thorough = true) {
  const size = 540,
    grown = padded(corners, image.width, image.height),
    // Clamping a quad that touches the frame can fold it; fall back to the
    // quad itself rather than let the warp refuse it.
    loose = validQuad(grown, image.width, image.height) ? grown : corners,
    // Square cells appear in the warp with a pitch ratio equal to the quad's
    // height over its width, which a partial lattice must respect.
    aspect = (Math.hypot(loose[3].x - loose[0].x, loose[3].y - loose[0].y) + Math.hypot(loose[2].x - loose[1].x, loose[2].y - loose[1].y)) /
      Math.max(1, Math.hypot(loose[1].x - loose[0].x, loose[1].y - loose[0].y) + Math.hypot(loose[2].x - loose[3].x, loose[2].y - loose[3].y)),
    estimated = estimateGrid(warp(image, loose, size, size), undefined, null, aspect, false, thorough);
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
  const moved = Math.max(...tight.map((p, i) => Math.hypot(p.x - corners[i].x, p.y - corners[i].y))),
    none = { corners, estimated: { ...estimated, rows: 0, cols: 0, quality: 0, extent: null, partial: false } };
  // A partial reading (the grid within part of the quad) stands only when
  // the quad it tightens to is confirmed; any other reading keeps its quad.
  if (!validQuad(tight, image.width, image.height) || moved > (estimated.partial ? 0.6 : 0.12) * diagonal)
    return estimated.partial ? none : { corners, estimated };
  // A refinement within one percent needs no confirmation; a larger move is
  // confirmed on a second padded warp, which after settling has no skew left
  // to search for.
  if (moved <= diagonal * 0.01 && !estimated.partial) return { corners: tight, estimated };
  const grownTight = padded(tight, image.width, image.height),
    again = estimateGrid(warp(image, validQuad(grownTight, image.width, image.height) ? grownTight : tight, size, size), undefined, { x: 0, y: 0 }, 1, false, thorough);
  if (again.rows === estimated.rows && again.cols === estimated.cols && !again.partial) return { corners: tight, estimated: again };
  return estimated.partial ? none : { corners, estimated };
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
function findIn(image, b, thorough = true) {
  const w = image.width,
    h = image.height,
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
      candidates.push({ corners, area, minx, miny, maxx, maxy, start: i });
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
  const result = (settled, confidence) => ({ corners: settled.corners, confidence, ...settled.estimated, lines: undefined, extent: undefined, quality: undefined, partial: undefined }),
    found = (settled) => Boolean(settled.estimated.rows && settled.estimated.cols),
    complete = (settled) => found(settled) && !settled.estimated.partial,
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
      const plain = settle(image, candidate.corners, thorough),
        wide = widen(candidate),
        diagonal = Math.hypot(candidate.corners[2].x - candidate.corners[0].x, candidate.corners[2].y - candidate.corners[0].y),
        moved = Math.max(...wide.map((p, i) => Math.hypot(p.x - candidate.corners[i].x, p.y - candidate.corners[i].y)));
      let outcome = plain;
      if (moved > diagonal * 0.01) {
        const wider = settle(image, wide, thorough);
        if (found(wider) && (!found(plain) ||
          wider.estimated.quality > plain.estimated.quality + 0.05 ||
          (samePitch(wider, plain) && wider.estimated.rows + wider.estimated.cols > plain.estimated.rows + plain.estimated.cols &&
            wider.estimated.quality > plain.estimated.quality - 0.1)))
          outcome = wider;
      }
      return (candidate.tried = outcome);
    };
  // A photograph of a page on a dark table makes the page's edge the largest
  // component, a thin ring around the grid. When a substantial candidate lies
  // inside the largest one, it is the grid if it carries a lattice.
  if (candidates.length > 1) {
    const outer = candidates[0];
    for (const inner of candidates.slice(1, 3)) {
      if (inner.area < outer.area * 0.25 || inner.minx < outer.minx || inner.miny < outer.miny ||
        inner.maxx > outer.maxx || inner.maxy > outer.maxy) continue;
      const within = tried(inner);
      // A partial reading of a contained candidate is a window of a
      // fragmented grid, not the grid.
      if (complete(within)) return result(within, 0.94);
    }
  }
  const settled = tried(candidates[0]);
  if (complete(settled)) return result(settled, 0.94);
  // The largest component may be a frame, a panel or a shadow beside the
  // grid: the next two largest get their turn before giving up, and a full
  // reading from any of them beats a partial one. Each turn is a warp and a
  // lattice, too much for a live frame.
  let partial = found(settled) ? settled : null;
  for (const next of thorough ? candidates.slice(1, 3) : []) {
    const other = tried(next);
    if (complete(other)) return result(other, 0.94);
    if (!partial && found(other)) partial = other;
  }
  return partial ? result(partial, 0.94) : result(settled, 0.45);
}
// Small round blobs of ink: components of at most `side` pixels a side,
// nearly square and mostly filled. Their centroids, with the count of
// pixels and the bounding box.
function blobs(b, w, h, side) {
  const seen = new Uint8Array(b.length),
    queue = new Int32Array(b.length),
    out = [];
  for (let i = 0; i < b.length; i++) {
    if (!b[i] || seen[i]) continue;
    let head = 0,
      tail = 1,
      minx = w,
      maxx = 0,
      miny = h,
      maxy = 0,
      sx = 0,
      sy = 0;
    queue[0] = i;
    seen[i] = 1;
    while (head < tail) {
      const k = queue[head++],
        x = k % w,
        y = (k - x) / w;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      sx += x;
      sy += y;
      if (x > 0 && b[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; queue[tail++] = k - 1; }
      if (x < w - 1 && b[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; queue[tail++] = k + 1; }
      if (y > 0 && b[k - w] && !seen[k - w]) { seen[k - w] = 1; queue[tail++] = k - w; }
      if (y < h - 1 && b[k + w] && !seen[k + w]) { seen[k + w] = 1; queue[tail++] = k + w; }
    }
    const bw = maxx - minx + 1,
      bh = maxy - miny + 1;
    if (tail >= 3 && bw <= side && bh <= side && Math.max(bw, bh) <= 1.5 * Math.min(bw, bh) && tail >= 0.5 * bw * bh)
      out.push({ x: sx / tail, y: sy / tail, pixels: tail, side: Math.max(bw, bh) });
  }
  return out;
}
// The dots of a dot lattice among small blobs: those with at least two
// neighbours at about the common nearest-neighbour distance. Digits sit at
// cell centres, off that distance, and are not round anyway.
function latticeDots(dots) {
  if (dots.length < 12 || dots.length > 3000) return [];
  const nearest = dots.map((d, i) => {
    let best = Infinity;
    for (let j = 0; j < dots.length; j++) {
      if (j === i) continue;
      const dd = Math.hypot(dots[j].x - d.x, dots[j].y - d.y);
      if (dd < best) best = dd;
    }
    return best;
  });
  const pitch = [...nearest].sort((a, b) => a - b)[nearest.length >> 1];
  if (!(pitch > 3)) return [];
  return dots.filter((d) => {
    let near = 0;
    for (const o of dots) {
      if (o === d) continue;
      const dd = Math.hypot(o.x - d.x, o.y - d.y);
      if (dd > pitch * 0.7 && dd < pitch * 1.4) near++;
    }
    return near >= 2;
  });
}
// Line groups from dot positions along one axis, for the lattice fit:
// positions within 3% of the length are one dot column (row).
function dotGroups(values, length) {
  const sorted = [...values].sort((a, b) => a - b),
    out = [];
  for (const v of sorted) {
    const last = out.at(-1);
    if (last && v - last.hi <= length * 0.03) {
      last.count++;
      last.hi = v;
      last.sum += v;
    } else out.push({ count: 1, lo: v, hi: v, sum: v });
  }
  const most = Math.max(...out.map((o) => o.count));
  return out.map((o) => ({ at: o.sum / o.count, width: 3, peak: o.count / most, lo: o.lo, hi: o.hi }));
}
// A grid drawn as dots at the lattice points (Slitherlink): the dots' extreme
// points are the quad, the dots re-found in the padded warp give the lattice
// on each axis, and the outer dots are the corners, mapped back through the
// homography.
function dotGrid(image, b) {
  const w = image.width,
    h = image.height,
    side = Math.max(4, Math.round(Math.max(w, h) * 0.02)),
    dots = latticeDots(blobs(b, w, h, side));
  if (dots.length < 12) return null;
  let minsum = Infinity,
    maxsum = -Infinity,
    mindiff = Infinity,
    maxdiff = -Infinity,
    tl, tr, br, bl;
  for (const d of dots) {
    if (d.x + d.y < minsum) { minsum = d.x + d.y; tl = d; }
    if (d.x + d.y > maxsum) { maxsum = d.x + d.y; br = d; }
    if (d.x - d.y < mindiff) { mindiff = d.x - d.y; bl = d; }
    if (d.x - d.y > maxdiff) { maxdiff = d.x - d.y; tr = d; }
  }
  const corners = [tl, tr, br, bl].map((d) => ({ x: d.x, y: d.y }));
  if (!validQuad(corners, w, h) || polygonArea(corners) < w * h * 0.03) return null;
  const grown = padded(corners, w, h, 0.06),
    loose = validQuad(grown, w, h) ? grown : corners,
    // A square warp of a wide quad stretches its dots into ellipses, which
    // are no longer round enough to be dots: keep the quad's own aspect.
    aspect = Math.min(4, Math.max(0.25,
      (Math.hypot(loose[3].x - loose[0].x, loose[3].y - loose[0].y) + Math.hypot(loose[2].x - loose[1].x, loose[2].y - loose[1].y)) /
        Math.max(1, Math.hypot(loose[1].x - loose[0].x, loose[1].y - loose[0].y) + Math.hypot(loose[2].x - loose[3].x, loose[2].y - loose[3].y)))),
    sizeX = 540,
    sizeY = Math.round(540 * aspect),
    warped = warp(image, loose, sizeX, sizeY),
    wb = thresholdGray(gray(warped), sizeX, sizeY),
    // A dot in the warp is a dot of the frame scaled by it. Measuring the
    // limit from the dots already found keeps a magnified small grid's dots
    // and still refuses clue digits, which would corrupt the pitch.
    across0 = Math.max(1, (Math.hypot(loose[1].x - loose[0].x, loose[1].y - loose[0].y) + Math.hypot(loose[2].x - loose[3].x, loose[2].y - loose[3].y)) / 2),
    dotSide = [...dots.map((d) => d.side)].sort((a, c) => a - c)[dots.length >> 1],
    inWarp = latticeDots(blobs(wb, sizeX, sizeY, Math.max(4, Math.round((dotSide * sizeX) / across0 * 1.8))));
  if (inWarp.length < 12) return null;
  const across = lattice(dotGroups(inWarp.map((d) => d.x), sizeX), sizeX),
    down = lattice(dotGroups(inWarp.map((d) => d.y), sizeY), sizeY);
  if (!across || !down || across.cells < 3 || down.cells < 3) return null;
  const m = homography(loose),
    at = (u, v) => {
      const q = project(m, u / (sizeX - 1), v / (sizeY - 1));
      return { x: Math.min(w - 1, Math.max(0, q.x)), y: Math.min(h - 1, Math.max(0, q.y)) };
    },
    tight = [at(across.first, down.first), at(across.last, down.first), at(across.last, down.last), at(across.first, down.last)];
  if (!validQuad(tight, w, h)) return null;
  return { corners: tight, confidence: 0.94, rows: down.cells, cols: across.cells, boxes: false };
}
// The grid in a frame: read from the ink mask; when that finds no grid in a
// mostly dark frame (a screen with a light-on-dark theme, whose light lines
// are not ink), from the inverted frame; and failing both, as a lattice of
// dots.
export function findGrid(image, { thorough = true } = {}) {
  const g = gray(image),
    b = thresholdGray(g, image.width, image.height);
  let best = findIn(image, b, thorough);
  if (best.confidence >= 0.9 || !thorough) return best;
  if (lightOnDark(g)) {
    const second = findIn(image, thresholdGray(inverted(g), image.width, image.height), thorough);
    if (second.confidence >= 0.9) return second;
    if (second.confidence > best.confidence) best = second;
  }
  return dotGrid(image, b) ?? best;
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
