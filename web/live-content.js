import { homography, project, validQuad } from "./geometry.js";

// Geometry/motion and printed content are different signals. Keep 24x24 samples
// PER REGION rather than averaging a whole grid down to a 64x64 thumbnail.
// Cell interiors alone miss inequalities on grid lines, small cage labels and
// cage walls. Track those independently; never dilute a changed constraint in
// the pixels of the rest of the board. No OCR or solver answers are used.
const SIDE = 24, CELL = SIDE * SIDE;
const SHIFTS = [[0,0]];
for (const distance of [1/3, 2/3, 1])
  for (const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]])
    SHIFTS.push([x * distance, y * distance]);
// Area sampling prevents thin anti-aliased strokes from changing merely
// because a camera pixel moves across a sampling point. The integral image
// makes this independent of the source resolution and averaging footprint.
// It depends only on the frame, so every anchor checked against one frame
// shares it (trackingFrame in live-registration.js), which also passes the
// frame's grayscale pixels: the same luminance, already computed.
export function integralImage(image, gray = null) {
  const { width, height, data } = image;
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    const above = y * stride + 1, here = above + stride;
    if (gray) for (let x = 0, at = y * width; x < width; x++, at++) {
      row += gray[at];
      integral[here + x] = integral[above + x] + row;
    } else for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      row += (77 * data[at] + 150 * data[at + 1] + 29 * data[at + 2]) >> 8;
      integral[here + x] = integral[above + x] + row;
    }
  }
  return integral;
}
// `frame` may carry this image's integral image; it is read only after the
// image and the corners have been validated.
export function gridContent(image, corners, rows, cols, frame = null) {
  const { width, height, data } = image;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 ||
    rows > 25 || cols > 25 || data?.length !== width * height * 4 ||
    !validQuad(corners, width, height)) return null;
  const m = homography(corners), pixels = new Uint8Array(rows * cols * CELL);
  const structure = new Uint8Array(structureCount(rows, cols) * CELL);
  const stride = width + 1, integral = frame?.integral ?? integralImage(image);
  const [m0, m1, m2, m3, m4, m5, m6, m7] = m, us = new Float64Array(SIDE), vs = new Float64Array(SIDE);
  // A box average is four bilinear reads of the integral image, at the box's
  // corners. This is the hottest loop of live tracking, so each sample's
  // projection is inlined and each box edge is clamped and split into cell
  // and weight once for its two corners; the arithmetic, and so every
  // resulting sample, is exactly that of project() and four separate reads.
  function sample(leftX, topY, w, h, output, offset) {
    const left = project(m, (leftX + w / 2 - w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      right = project(m, (leftX + w / 2 + w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      top = project(m, (leftX + w / 2) / cols, (topY + h / 2 - h / (2 * SIDE)) / rows),
      bottom = project(m, (leftX + w / 2) / cols, (topY + h / 2 + h / (2 * SIDE)) / rows),
      rx = Math.max(.5, (Math.abs(right.x - left.x) + Math.abs(bottom.x - top.x)) / 2),
      ry = Math.max(.5, (Math.abs(right.y - left.y) + Math.abs(bottom.y - top.y)) / 2);
    for (let i = 0; i < SIDE; i++) {
      us[i] = (leftX + w * (i + .5) / SIDE) / cols;
      vs[i] = (topY + h * (i + .5) / SIDE) / rows;
    }
    // Raw area averages only. Illumination, polarity and contrast are handled
    // when two signatures are compared, anchored to the reference, so that no
    // per-frame decision can flip between two views of the same print.
    for (let y = 0; y < SIDE; y++) {
      const v = vs[y];
      for (let x = 0; x < SIDE; x++) {
        const u = us[x], z = m6 * u + m7 * v + 1;
        if (Math.abs(z) < 1e-10) throw Error("Invalid perspective.");
        const px = (m0 * u + m1 * v + m2) / z, py = (m3 * u + m4 * v + m5) / z;
        const x0 = Math.max(0, px + .5 - rx), x1 = Math.min(width, px + .5 + rx),
          y0 = Math.max(0, py + .5 - ry), y1 = Math.min(height, py + .5 + ry);
        const ax = Math.max(0, Math.min(width, x0)), bx = Math.max(0, Math.min(width, x1)),
          ay = Math.max(0, Math.min(height, y0)), by = Math.max(0, Math.min(height, y1));
        const ax0 = Math.floor(ax), bx0 = Math.floor(bx), ay0 = Math.floor(ay), by0 = Math.floor(by);
        const ax1 = Math.min(ax0 + 1, width), bx1 = Math.min(bx0 + 1, width),
          ay1 = Math.min(ay0 + 1, height) * stride, by1 = Math.min(by0 + 1, height) * stride;
        const adx = ax - ax0, bdx = bx - bx0, ady = ay - ay0, bdy = by - by0;
        const ar = ay0 * stride, br = by0 * stride;
        const s11 = (integral[br + bx0] * (1 - bdx) + integral[br + bx1] * bdx) * (1 - bdy) +
            (integral[by1 + bx0] * (1 - bdx) + integral[by1 + bx1] * bdx) * bdy,
          s01 = (integral[br + ax0] * (1 - adx) + integral[br + ax1] * adx) * (1 - bdy) +
            (integral[by1 + ax0] * (1 - adx) + integral[by1 + ax1] * adx) * bdy,
          s10 = (integral[ar + bx0] * (1 - bdx) + integral[ar + bx1] * bdx) * (1 - ady) +
            (integral[ay1 + bx0] * (1 - bdx) + integral[ay1 + bx1] * bdx) * ady,
          s00 = (integral[ar + ax0] * (1 - adx) + integral[ar + ax1] * adx) * (1 - ady) +
            (integral[ay1 + ax0] * (1 - adx) + integral[ay1 + ax1] * adx) * ady;
        output[offset + y * SIDE + x] = Math.round((s11 - s01 - s10 + s00) / ((x1 - x0) * (y1 - y0)));
      }
    }
  }
  let region = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    sample(c + .08, r + .08, .84, .84, pixels, (r * cols + c) * CELL);
    // Supersets of scan-analysis's label/hsign/vsign crops. Boundary strips
    // span the entire edge so dotted cage walls are covered as well as signs.
    for (const dy of [0, .16]) for (const dx of [.01, .37])
      sample(c + dx, r + dy, .4, .2, structure, region++ * CELL);
    if (c < cols - 1) sample(c + .75, r, .5, 1, structure, region++ * CELL);
    if (r < rows - 1) sample(c, r + .75, 1, .5, structure, region++ * CELL);
  }
  return { rows, cols, pixels, structure };
}

function structureCount(rows, cols) {
  return 4 * rows * cols + rows * (cols - 1) + (rows - 1) * cols;
}

export function sameGridContent(a, b, diagnostic = null) {
  if (!a || !b || a.rows !== b.rows || a.cols !== b.cols ||
    a.pixels?.length !== a.rows * a.cols * CELL || a.pixels.length !== b.pixels?.length ||
    a.structure?.length !== structureCount(a.rows, a.cols) * CELL ||
    a.structure.length !== b.structure?.length) {
    if (diagnostic) diagnostic.reason = 'invalid-content';
    return false;
  }
  // Cell interiors also need residual checks: the small missing left strokes
  // between 8 and 3 can pass a high-contrast area-only test. Registration must
  // not turn that changed clue into evidence of unchanged content. Boundary strips:
  // unstretched (a thin grid line straddling two samples must not be amplified
  // by tiny motion), the high-contrast test and the low-contrast residual test.
  return sameRegions(a.pixels, b.pixels, true, [[.03, 2.5, false], [.01, .06, true]], diagnostic) &&
    sameRegions(a.structure, b.structure, false, [[.01, .8, false], [.01, .06, true]], diagnostic);
}

// Robust levels of one raw region: means over histogram bands rather than
// single percentiles, so a sub-pixel shift or a little sensor noise moves them
// slightly instead of jumping them across a cliff in the histogram. The four
// bands (low, middle, paper, high) accumulate in one pass over the histogram,
// each exactly as a pass of its own would.
const BANDS = [[0, .05], [.45, .55], [.75, .95], [.95, 1]].map(([from, to]) => [from * CELL, to * CELL]);
function levels(raw, offset, histogram, out = new Float64Array(4)) {
  histogram.fill(0);
  for (let i = 0; i < CELL; i++) histogram[raw[offset + i]]++;
  const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0];
  let seen = 0;
  for (let value = 0; value < 256 && seen < CELL; value++) {
    const count = histogram[value];
    if (!count) continue;
    for (let band = 0; band < 4; band++) {
      const lo = Math.max(BANDS[band][0], seen), hi = Math.min(BANDS[band][1], seen + count);
      if (hi > lo) { sums[band] += value * (hi - lo); counts[band] += hi - lo; }
    }
    seen += count;
  }
  for (let band = 0; band < 4; band++) out[band] = counts[band] ? sums[band] / counts[band] : 0;
  return out;
}
const LOW = 0, MIDDLE = 1, PAPER = 2, HIGH = 3;
// The reference side of a comparison is an anchor's stored content, compared
// with every frame it is verified against: its levels are computed once.
const referenceLevels = new WeakMap();
function levelsOf(raw, histogram) {
  let all = referenceLevels.get(raw);
  if (!all) {
    all = new Float64Array(raw.length / CELL * 4);
    for (let offset = 0; offset < raw.length; offset += CELL)
      levels(raw, offset, histogram, all.subarray(offset / CELL * 4, offset / CELL * 4 + 4));
    referenceLevels.set(raw, all);
  }
  return all;
}

// Either polarity can carry a printed constraint: white-on-black clues would
// disappear if only samples darker than the paper were kept. The polarity and
// the contrast stretch come from the REFERENCE region and apply to both, so
// they cannot flip between two frames of the same print; only the paper (or
// black) level follows each frame, which absorbs a uniform illumination change.
function normalize(raw, offset, out, lightInk, level, scale) {
  for (let i = 0; i < CELL; i++) {
    const v = raw[offset + i];
    out[i] = Math.max(0, Math.min(255, Math.round((lightInk ? v - level : level - v) * scale)));
  }
}

// rawA is the reference: an anchor's content, never modified once built.
function sameRegions(rawA, rawB, stretch, checks, diagnostic) {
  const histogram = new Uint16Array(256), a = new Uint8Array(CELL), b = new Uint8Array(CELL),
    rangesA = new Uint8Array(CELL), rangesB = new Uint8Array(CELL), B = new Float64Array(4);
  const reference = levelsOf(rawA, histogram);
  for (let offset = 0; offset < rawA.length; offset += CELL) {
    const A = reference.subarray(offset / CELL * 4, offset / CELL * 4 + 4);
    levels(rawB, offset, histogram, B);
    // Light ink on a dark ground only when the bright band clearly dominates;
    // on blank paper the two bands differ by a few levels of grain and the
    // dark-ink anchor (the paper band) is the stable one.
    const lightInk = A[HIGH] - A[MIDDLE] > 2 * (A[MIDDLE] - A[LOW]) && A[HIGH] - A[MIDDLE] > 24,
      // Thin glyphs can occupy less than 5% of a cell; a floor keeps almost-flat
      // noise from being amplified into ink.
      scale = stretch ? 255 / Math.max(40, lightInk ? A[HIGH] - A[LOW] : A[PAPER] - A[LOW]) : 1;
    normalize(rawA, offset, a, lightInk, lightInk ? A[LOW] : A[PAPER], scale);
    normalize(rawB, offset, b, lightInk, lightInk ? B[LOW] : B[PAPER], scale);
    for (const [fraction, average, detail] of checks)
      if (!regionMatches(a, b, fraction, average, detail, rangesA, rangesB, histogram)) {
        // Numeric region position and a bounded reason only; never raw pixels.
        if (diagnostic) { diagnostic.reason = stretch ? 'cell-content' : 'structural-content'; diagnostic.region = offset / CELL; }
        return false;
      }
  }
  return true;
}

// One sample of registration jitter is tolerable. Do not blur or average away
// a changed stroke: every region must independently pass the test.
//
// High-contrast test: samples that differ by more than 64 levels, at the best
// of the small shifts. A grid line thinner than the sample spacing cannot be
// interpolated to a fractional shift, so when every shift fails, the best raw
// registration alone is forgiven a tenth of the local contrast; a shift chosen
// merely to hide a change gets no allowance, which keeps a small changed label
// visible.
//
// Low-contrast test (detail): allows sensor noise, a bounded relative
// illumination change and a fraction of the local edge contrast for
// sub-sample motion, then requires even weak residual strokes to agree. It is
// evaluated only at the best raw registration, so it cannot pick a different
// shift merely to hide weak ink behind a strong grid line.
//
// Its noise floor is measured, not assumed: NOISE_FACTOR times the pair's own
// frame-to-frame noise, in the region's units whether stretched or not, and
// never below NOISE. A clean print keeps the NOISE floor that catches an 8
// becoming a 3 down to print contrast 15; a grainy one gets a floor that grows
// with its grain. Scaling NOISE by the contrast stretch instead (#73) raised
// the floor for every faint print, grainy or not, and missed 8/3 changes up to
// contrast 130, while grain in unstretched structural strips still failed.
const NOISE = 4, NOISE_FACTOR = 1.5, REGISTRATION = .1;
function regionMatches(a, b, fraction, average, detail, rangesA, rangesB, histogram) {
  if (!detail) {
    for (const shift of SHIFTS) if (passes(a, b, shift, fraction, average, 0, rangesA, rangesB)) return true;
    localRanges(a, rangesA); localRanges(b, rangesB);
    return passes(a, b, bestRegistration(a, b), fraction, average, REGISTRATION, rangesA, rangesB);
  }
  // Identical or near-noise regions skip the registration work; unchanged
  // scenes remain the common, battery-saving path.
  let quiet = true;
  for (let i = 0; i < CELL; i++) if (Math.abs(a[i] - b[i]) > 2) { quiet = false; break; }
  if (quiet) return true;
  localRanges(a, rangesA); localRanges(b, rangesB);
  const shift = bestRegistration(a, b);
  return passes(a, b, shift, fraction, average, null, rangesA, rangesB,
    Math.max(NOISE, NOISE_FACTOR * pairNoise(a, b, shift, histogram)));
}

// Frame-to-frame noise of a region pair: the median absolute difference of the
// compared samples at the given registration, times 1.4826, the standard
// deviation of Gaussian differences with that median. A changed stroke covers
// a minority of the samples and cannot move the median.
// The three comparisons below read b bilinearly at a sub-sample shift of each
// sample. Per shift, the weights are hoisted, and an axis without a fraction
// reads its sample directly: b * 1 + b' * 0 is exactly b, so every value and
// every decision is that of the full interpolation.
function pairNoise(a, b, [dx, dy], histogram) {
  const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy, wx = 1 - fx, wy = 1 - fy, ox = fx ? 1 : 0;
  histogram.fill(0);
  for (let y = 1; y < SIDE - 1; y++) {
    const row = (y + iy) * SIDE + ix, ref = y * SIDE;
    for (let x = 1; x < SIDE - 1; x++) {
      const at = row + x, top = fx ? b[at] * wx + b[at + ox] * fx : b[at];
      const bv = fy ? top * wy + (b[at + SIDE] * wx + b[at + SIDE + ox] * fx) * fy : top;
      histogram[Math.round(Math.abs(a[ref + x] - bv))]++;
    }
  }
  let median = 0;
  for (let seen = histogram[0]; seen * 2 < (SIDE - 2) ** 2; seen += histogram[++median]);
  return 1.4826 * median;
}

// allow: 0 is the strict 64-level test, a number forgives that fraction of the
// local contrast in the 64-level test, null is the low-contrast residual test.
function passes(a, b, [dx, dy], fraction, average, allow, rangesA, rangesB, noise = NOISE) {
  const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy, wx = 1 - fx, wy = 1 - fy, ox = fx ? 1 : 0,
    threshold = allow === null ? noise : 64;
  let changed = 0, difference = 0;
  for (let y = 1; y < SIDE - 1; y++) {
    const row = (y + iy) * SIDE + ix, ref = y * SIDE;
    for (let x = 1; x < SIDE - 1; x++) {
      const at = row + x, top = fx ? b[at] * wx + b[at + ox] * fx : b[at];
      const av = a[ref + x], bv = fy ? top * wy + (b[at + SIDE] * wx + b[at + SIDE + ox] * fx) * fy : top;
      let allowance = 0;
      if (allow === null) allowance = noise + .15 * Math.max(av, bv) + .4 * Math.max(rangesA[ref + x], rangesB[at]);
      else if (allow) allowance = allow * Math.max(rangesA[ref + x], rangesB[at]);
      const delta = Math.max(0, Math.abs(av - bv) - allowance);
      difference += delta;
      if (delta > threshold) changed++;
    }
  }
  const count = (SIDE - 2) ** 2;
  return changed <= count * fraction || difference <= count * average;
}

// Unblurred contrast around each sample. No neighbourhood crosses a region.
// The 3x3 range is taken as row extremes first, then their column extremes:
// the same minimum and maximum, from a third of the reads.
const rowLow = new Uint8Array(CELL), rowHigh = new Uint8Array(CELL);
function localRanges(pixels, output) {
  for (let y = 0; y < SIDE; y++) for (let x = 0, at = y * SIDE; x < SIDE; x++, at++) {
    let low = pixels[at], high = low;
    if (x > 0) { const v = pixels[at - 1]; if (v < low) low = v; if (v > high) high = v; }
    if (x < SIDE - 1) { const v = pixels[at + 1]; if (v < low) low = v; if (v > high) high = v; }
    rowLow[at] = low; rowHigh[at] = high;
  }
  for (let y = 0; y < SIDE; y++) for (let x = 0, at = y * SIDE; x < SIDE; x++, at++) {
    let low = rowLow[at], high = rowHigh[at];
    if (y > 0) { if (rowLow[at - SIDE] < low) low = rowLow[at - SIDE]; if (rowHigh[at - SIDE] > high) high = rowHigh[at - SIDE]; }
    if (y < SIDE - 1) { if (rowLow[at + SIDE] < low) low = rowLow[at + SIDE]; if (rowHigh[at + SIDE] > high) high = rowHigh[at + SIDE]; }
    output[at] = high - low;
  }
}

// Select by raw L1 error BEFORE applying any allowances. Computing expensive
// residuals only for the winning shift preserves the same decision and ties.
// Non-negative partial sums let losing shifts stop early without approximation.
function bestRegistration(a, b) {
  let best = SHIFTS[0], bestRaw = Infinity;
  shifts: for (const shift of SHIFTS) {
    if (bestRaw === 0) break;
    const [dx, dy] = shift, ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy,
      wx = 1 - fx, wy = 1 - fy, ox = fx ? 1 : 0;
    let raw = 0;
    for (let y = 1; y < SIDE - 1; y++) {
      const row = (y + iy) * SIDE + ix, ref = y * SIDE;
      for (let x = 1; x < SIDE - 1; x++) {
        const at = row + x, top = fx ? b[at] * wx + b[at + ox] * fx : b[at];
        raw += Math.abs(a[ref + x] - (fy ? top * wy + (b[at + SIDE] * wx + b[at + SIDE + ox] * fx) * fy : top));
        if (raw >= bestRaw) continue shifts;
      }
    }
    bestRaw = raw; best = shift;
  }
  return best;
}
