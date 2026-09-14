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
  const histogram = new Uint16Array(256), cell = new Uint8Array(CELL);
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
    histogram.fill(0);
    const left = project(m, (leftX + w / 2 - w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      right = project(m, (leftX + w / 2 + w / (2 * SIDE)) / cols, (topY + h / 2) / rows),
      top = project(m, (leftX + w / 2) / cols, (topY + h / 2 - h / (2 * SIDE)) / rows),
      bottom = project(m, (leftX + w / 2) / cols, (topY + h / 2 + h / (2 * SIDE)) / rows),
      rx = Math.max(.5, (Math.abs(right.x - left.x) + Math.abs(bottom.x - top.x)) / 2),
      ry = Math.max(.5, (Math.abs(right.y - left.y) + Math.abs(bottom.y - top.y)) / 2);
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const p = project(m, (leftX + w * (x + .5) / SIDE) / cols,
        (topY + h * (y + .5) / SIDE) / rows);
      const x0 = Math.max(0, p.x + .5 - rx), x1 = Math.min(width, p.x + .5 + rx),
        y0 = Math.max(0, p.y + .5 - ry), y1 = Math.min(height, p.y + .5 + ry);
      const value = Math.round((sumAt(x1,y1) - sumAt(x0,y1) - sumAt(x1,y0) + sumAt(x0,y0)) / ((x1-x0)*(y1-y0)));
      cell[y * SIDE + x] = value; histogram[value]++;
    }
    // Normalize per-cell illumination without amplifying almost-flat noise.
    // Thin glyphs can occupy less than 5% of a cell. Use the inner 1% tails
    // rather than letting sub-pixel antialiasing redefine their ink contrast.
    let cumulative = 0, low = -1, middle = -1, paper = -1, high = 255;
    for (let value = 0; value < 256; value++) {
      cumulative += histogram[value];
      if (low < 0 && cumulative >= CELL * .01) low = value;
      if (middle < 0 && cumulative >= CELL * .5) middle = value;
      if (paper < 0 && cumulative >= CELL * .85) paper = value;
      if (cumulative >= CELL * .99) { high = value; break; }
    }
    // Either polarity can carry a printed constraint. White-on-black clues
    // would disappear if only pixels darker than the background were retained.
    // Do not stretch structural strips to their darkest sample: a thin grid
    // line straddling two samples would then change intensity under tiny motion.
    // Their smaller change budget retains small labels without that amplification.
    const lightInk = high - middle > middle - low,
      scale = output === pixels ? 255 / Math.max(40, lightInk ? high - low : paper - low) : 1;
    for (let i = 0; i < CELL; i++) output[offset + i] = Math.max(0, Math.min(255,
      Math.round((lightInk ? cell[i] - low : paper - cell[i]) * scale)));
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

export function sameGridContent(a, b) {
  if (!a || !b || a.rows !== b.rows || a.cols !== b.cols ||
    a.pixels?.length !== a.rows * a.cols * CELL || a.pixels.length !== b.pixels?.length ||
    a.structure?.length !== structureCount(a.rows, a.cols) * CELL ||
    a.structure.length !== b.structure?.length) return false;
  return sameRegions(a.pixels, b.pixels) && sameRegions(a.structure, b.structure, .01, .8) &&
    sameRegions(a.structure, b.structure, .003, .06, true);
}

// Supplemental low-contrast check: do not interpret "no delta above 64" as
// unchanged. Allow bounded sensor noise, illumination and sub-sample edge
// motion, then require even weak, coherent residual strokes to agree. Keep the
// original high-contrast check as well, so these allowances cannot weaken it.
function sameRegions(a, b, fraction = .03, average = 2.5, detail = false) {
  const rangesA = detail ? new Uint8Array(CELL) : null,
    rangesB = detail ? new Uint8Array(CELL) : null;
  for (let offset = 0; offset < a.length; offset += CELL) {
    if (detail) {
      // Avoid all registration/gradient work for identical or near-noise
      // regions; unchanged scenes remain the common battery-saving path.
      let quiet = true;
      for (let i = 0; i < CELL; i++) if (Math.abs(a[offset+i] - b[offset+i]) > 2) { quiet = false; break; }
      if (quiet) continue;
      localRanges(a, offset, rangesA); localRanges(b, offset, rangesB);
    }
    let matches = false;
    const shifts = detail ? [bestRegistration(a, b, offset)] : SHIFTS;
    // One sample of registration jitter is tolerable. Do not blur or average
    // away a changed stroke: every cell must independently pass the test.
    for (const [dx, dy] of shifts) {
      if (matches) break;
      let changed = 0, difference = 0;
      const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
      for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
        const at = offset + (y + iy) * SIDE + x + ix;
        const top = b[at] * (1 - fx) + b[at + (fx ? 1 : 0)] * fx;
        const below = fy ? b[at + SIDE] * (1 - fx) + b[at + SIDE + (fx ? 1 : 0)] * fx : top;
        const av = a[offset + y * SIDE + x], bv = top * (1 - fy) + below * fy;
        const raw = Math.abs(av - bv);
        // A fraction of the local range models antialiasing at a moving edge;
        // the intensity term covers illumination even inside a flat stroke.
        const allowance = detail ? 2 + .15 * Math.max(av, bv) +
          .4 * Math.max(rangesA[y * SIDE + x], rangesB[at - offset]) : 0;
        const delta = Math.max(0, raw - allowance);
        difference += delta;
        if (delta > (detail ? 2 : 64)) changed++;
      }
      const count = (SIDE - 2) ** 2;
      matches = changed <= count * fraction || difference <= count * average;
    }
    if (!matches) return false;
  }
  return true;
}

// Unblurred contrast around each sample. No neighbourhood crosses a region.
function localRanges(pixels, offset, output) {
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    let low = 255, high = 0;
    for (let yy = Math.max(0, y-1); yy <= Math.min(SIDE-1, y+1); yy++)
      for (let xx = Math.max(0, x-1); xx <= Math.min(SIDE-1, x+1); xx++) {
        const value = pixels[offset + yy * SIDE + xx];
        low = Math.min(low, value); high = Math.max(high, value);
      }
    output[y * SIDE + x] = high - low;
  }
}

// Select by raw L1 error BEFORE applying any allowances. Computing expensive
// residuals only for the winning shift preserves the same decision and ties.
// Non-negative partial sums let losing shifts stop early without approximation.
function bestRegistration(a, b, offset) {
  let best = SHIFTS[0], bestRaw = Infinity;
  shifts: for (const shift of SHIFTS) {
    if (bestRaw === 0) break;
    const [dx, dy] = shift, ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
    let raw = 0;
    for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
      const at = offset + (y + iy) * SIDE + x + ix;
      const top = b[at] * (1 - fx) + b[at + (fx ? 1 : 0)] * fx;
      const below = fy ? b[at + SIDE] * (1 - fx) + b[at + SIDE + (fx ? 1 : 0)] * fx : top;
      raw += Math.abs(a[offset + y * SIDE + x] - (top * (1 - fy) + below * fy));
      if (raw >= bestRaw) continue shifts;
    }
    bestRaw = raw; best = shift;
  }
  return best;
}
