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
export function gridContent(image, corners, rows, cols) {
  const { width, height, data } = image;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 ||
    rows > 25 || cols > 25 || data?.length !== width * height * 4 ||
    !validQuad(corners, width, height)) return null;
  const m = homography(corners), pixels = new Uint8Array(rows * cols * CELL);
  const structure = new Uint8Array(structureCount(rows, cols) * CELL);
  // Area sampling prevents thin anti-aliased strokes from changing merely
  // because a camera pixel moves across a sampling point. The integral image
  // makes this independent of the source resolution and averaging footprint.
  const stride = width + 1, integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      row += (77 * data[at] + 150 * data[at + 1] + 29 * data[at + 2]) >> 8;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const sumAt = (x, y) => {
    const xx = Math.max(0, Math.min(width, x)), yy = Math.max(0, Math.min(height, y));
    const x0 = Math.floor(xx), y0 = Math.floor(yy), x1 = Math.min(x0 + 1, width), y1 = Math.min(y0 + 1, height);
    const dx = xx - x0, dy = yy - y0;
    return (integral[y0 * stride + x0] * (1 - dx) + integral[y0 * stride + x1] * dx) * (1 - dy) +
      (integral[y1 * stride + x0] * (1 - dx) + integral[y1 * stride + x1] * dx) * dy;
  };
  function sample(leftX, topY, w, h, output, offset) {
    const left = project(m, (leftX + w / 2 - w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      right = project(m, (leftX + w / 2 + w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      top = project(m, (leftX + w / 2) / cols, (topY + h / 2 - h / (2 * SIDE)) / rows),
      bottom = project(m, (leftX + w / 2) / cols, (topY + h / 2 + h / (2 * SIDE)) / rows),
      rx = Math.max(.5, (Math.abs(right.x - left.x) + Math.abs(bottom.x - top.x)) / 2),
      ry = Math.max(.5, (Math.abs(right.y - left.y) + Math.abs(bottom.y - top.y)) / 2);
    // Raw area averages only. Illumination, polarity and contrast are handled
    // when two signatures are compared, anchored to the reference, so that no
    // per-frame decision can flip between two views of the same print.
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const p = project(m, (leftX + w * (x + .5) / SIDE) / cols,
        (topY + h * (y + .5) / SIDE) / rows);
      const x0 = Math.max(0, p.x + .5 - rx), x1 = Math.min(width, p.x + .5 + rx),
        y0 = Math.max(0, p.y + .5 - ry), y1 = Math.min(height, p.y + .5 + ry);
      output[offset + y * SIDE + x] = Math.round((sumAt(x1,y1) - sumAt(x0,y1) - sumAt(x1,y0) + sumAt(x0,y0)) / ((x1-x0)*(y1-y0)));
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
// slightly instead of jumping them across a cliff in the histogram.
function levels(raw, offset, histogram) {
  histogram.fill(0);
  for (let i = 0; i < CELL; i++) histogram[raw[offset + i]]++;
  const band = (from, to) => {
    let seen = 0, sum = 0, n = 0;
    for (let value = 0; value < 256; value++) {
      const count = histogram[value];
      if (!count) continue;
      const lo = Math.max(from * CELL, seen), hi = Math.min(to * CELL, seen + count);
      if (hi > lo) { sum += value * (hi - lo); n += hi - lo; }
      seen += count;
    }
    return n ? sum / n : 0;
  };
  return { low: band(0, .05), middle: band(.45, .55), paper: band(.75, .95), high: band(.95, 1) };
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

function sameRegions(rawA, rawB, stretch, checks, diagnostic) {
  const histogram = new Uint16Array(256), a = new Uint8Array(CELL), b = new Uint8Array(CELL),
    rangesA = new Uint8Array(CELL), rangesB = new Uint8Array(CELL);
  for (let offset = 0; offset < rawA.length; offset += CELL) {
    const A = levels(rawA, offset, histogram), B = levels(rawB, offset, histogram),
      // Light ink on a dark ground only when the bright band clearly dominates;
      // on blank paper the two bands differ by a few levels of grain and the
      // dark-ink anchor (the paper band) is the stable one.
      lightInk = A.high - A.middle > 2 * (A.middle - A.low) && A.high - A.middle > 24,
      // Thin glyphs can occupy less than 5% of a cell; a floor keeps almost-flat
      // noise from being amplified into ink.
      scale = stretch ? 255 / Math.max(40, lightInk ? A.high - A.low : A.paper - A.low) : 1;
    normalize(rawA, offset, a, lightInk, lightInk ? A.low : A.paper, scale);
    normalize(rawB, offset, b, lightInk, lightInk ? B.low : B.paper, scale);
    for (const [fraction, average, detail] of checks)
      if (!regionMatches(a, b, fraction, average, detail, rangesA, rangesB, NOISE * scale)) {
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
const NOISE = 4, REGISTRATION = .1;
function regionMatches(a, b, fraction, average, detail, rangesA, rangesB, noise) {
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
  // Contrast stretching scales both print and sensor noise. Keeping a raw
  // four-level floor here amplified flat-cell noise into changed-clue evidence
  // and could block acquisition indefinitely before OCR even started.
  return passes(a, b, bestRegistration(a, b), fraction, average, null, rangesA, rangesB, noise);
}

// allow: 0 is the strict 64-level test, a number forgives that fraction of the
// local contrast in the 64-level test, null is the low-contrast residual test.
function passes(a, b, [dx, dy], fraction, average, allow, rangesA, rangesB, noise = NOISE) {
  const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy,
    threshold = allow === null ? noise : 64;
  let changed = 0, difference = 0;
  for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
    const at = (y + iy) * SIDE + x + ix;
    const top = b[at] * (1 - fx) + b[at + (fx ? 1 : 0)] * fx;
    const below = fy ? b[at + SIDE] * (1 - fx) + b[at + SIDE + (fx ? 1 : 0)] * fx : top;
    const av = a[y * SIDE + x], bv = top * (1 - fy) + below * fy;
    let allowance = 0;
    if (allow === null) allowance = noise + .15 * Math.max(av, bv) + .4 * Math.max(rangesA[y * SIDE + x], rangesB[at]);
    else if (allow) allowance = allow * Math.max(rangesA[y * SIDE + x], rangesB[at]);
    const delta = Math.max(0, Math.abs(av - bv) - allowance);
    difference += delta;
    if (delta > threshold) changed++;
  }
  const count = (SIDE - 2) ** 2;
  return changed <= count * fraction || difference <= count * average;
}

// Unblurred contrast around each sample. No neighbourhood crosses a region.
function localRanges(pixels, output) {
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    let low = 255, high = 0;
    for (let yy = Math.max(0, y-1); yy <= Math.min(SIDE-1, y+1); yy++)
      for (let xx = Math.max(0, x-1); xx <= Math.min(SIDE-1, x+1); xx++) {
        const value = pixels[yy * SIDE + xx];
        low = Math.min(low, value); high = Math.max(high, value);
      }
    output[y * SIDE + x] = high - low;
  }
}

// Select by raw L1 error BEFORE applying any allowances. Computing expensive
// residuals only for the winning shift preserves the same decision and ties.
// Non-negative partial sums let losing shifts stop early without approximation.
function bestRegistration(a, b) {
  let best = SHIFTS[0], bestRaw = Infinity;
  shifts: for (const shift of SHIFTS) {
    if (bestRaw === 0) break;
    const [dx, dy] = shift, ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
    let raw = 0;
    for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
      const at = (y + iy) * SIDE + x + ix;
      const top = b[at] * (1 - fx) + b[at + (fx ? 1 : 0)] * fx;
      const below = fy ? b[at + SIDE] * (1 - fx) + b[at + SIDE + (fx ? 1 : 0)] * fx : top;
      raw += Math.abs(a[y * SIDE + x] - (top * (1 - fy) + below * fy));
      if (raw >= bestRaw) continue shifts;
    }
    bestRaw = raw; best = shift;
  }
  return best;
}
