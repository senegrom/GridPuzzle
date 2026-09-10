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
export function thresholdGray(g, w, h, window = 25, bias = 12) {
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
      out[y * w + x] = g[y * w + x] < Math.min(215, mean - bias) ? 1 : 0;
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
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] > cutoff) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ at: (start + i - 1) / 2, width: i - start });
      start = -1;
    }
  }
  return out;
}
export function gridLines(image, mask) {
  const w = image.width,
    h = image.height,
    b = mask ?? threshold(image),
    x = new Float64Array(w),
    y = new Float64Array(h);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      x[c] += b[r * w + c] / h;
      y[r] += b[r * w + c] / w;
    }
  return { x: groups(x, 0.47), y: groups(y, 0.47) };
}
function regular(lines, length) {
  if (lines.length < 4 || lines.length > 26) return 0;
  const gap = (lines.at(-1).at - lines[0].at) / (lines.length - 1);
  if (lines[0].at > length * 0.1 || lines.at(-1).at < length * 0.9) return 0;
  return lines
    .slice(1)
    .every((l, i) => Math.abs(l.at - lines[i].at - gap) < gap * 0.23)
    ? lines.length - 1
    : 0;
}
export function estimateGrid(image, mask) {
  const lines = gridLines(image, mask),
    cols = regular(lines.x, image.width),
    rows = regular(lines.y, image.height);
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
