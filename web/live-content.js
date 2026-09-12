import { homography, project, validQuad } from "./geometry.js";

// Geometry/motion and printed content are different signals. Keep 24x24 samples
// PER CELL rather than averaging a whole grid down to a 64x64 thumbnail. This
// is a comparison of observed pixels only: no OCR or solver answers are used.
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
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    histogram.fill(0);
    const left = project(m, (c + .5 - .42 / SIDE) / cols, (r + .5) / rows),
      right = project(m, (c + .5 + .42 / SIDE) / cols, (r + .5) / rows),
      top = project(m, (c + .5) / cols, (r + .5 - .42 / SIDE) / rows),
      bottom = project(m, (c + .5) / cols, (r + .5 + .42 / SIDE) / rows),
      rx = Math.max(.5, (Math.abs(right.x - left.x) + Math.abs(bottom.x - top.x)) / 2),
      ry = Math.max(.5, (Math.abs(right.y - left.y) + Math.abs(bottom.y - top.y)) / 2);
    for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      // Retain nearly the full interior, including small structural clues,
      // while keeping thick grid boundaries out of the content comparison.
      const p = project(m, (c + .08 + .84 * (x + .5) / SIDE) / cols,
        (r + .08 + .84 * (y + .5) / SIDE) / rows);
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
    const lightInk = high - middle > middle - low,
      scale = 255 / Math.max(40, lightInk ? high - low : paper - low),
      offset = (r * cols + c) * CELL;
    for (let i = 0; i < CELL; i++) pixels[offset + i] = Math.max(0, Math.min(255,
      Math.round((lightInk ? cell[i] - low : paper - cell[i]) * scale)));
  }
  return { rows, cols, pixels };
}

export function sameGridContent(a, b) {
  if (!a || !b || a.rows !== b.rows || a.cols !== b.cols ||
    a.pixels?.length !== a.rows * a.cols * CELL || a.pixels.length !== b.pixels?.length) return false;
  for (let offset = 0; offset < a.pixels.length; offset += CELL) {
    let matches = false;
    // One sample of registration jitter is tolerable. Do not blur or average
    // away a changed stroke: every cell must independently pass the test.
    for (const [dx, dy] of SHIFTS) {
      if (matches) break;
      let changed = 0, difference = 0;
      const ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
      for (let y = 1; y < SIDE - 1; y++) for (let x = 1; x < SIDE - 1; x++) {
        const at = offset + (y + iy) * SIDE + x + ix;
        const top = b.pixels[at] * (1 - fx) + b.pixels[at + (fx ? 1 : 0)] * fx;
        const below = fy ? b.pixels[at + SIDE] * (1 - fx) + b.pixels[at + SIDE + (fx ? 1 : 0)] * fx : top;
        const delta = Math.abs(a.pixels[offset + y * SIDE + x] - (top * (1 - fy) + below * fy));
        difference += delta;
        if (delta > 64) changed++;
      }
      const count = (SIDE - 2) ** 2;
      matches = changed <= count * .03 || difference <= count * 2.5;
    }
    if (!matches) return false;
  }
  return true;
}
