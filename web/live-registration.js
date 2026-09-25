import { gray, homography, project, validQuad } from "./geometry.js";
import { gridContent, integralImage, sameGridContent } from "./live-content.js";

// A bounded, anchored patch registration, not an identity classifier. A good
// geometric fit is NEVER enough to publish OCR: every original content region
// must also match. The anchor is never replaced by a chain of similar frames.
const R = 4, PATCH = (2 * R + 1) ** 2, SEARCH = 8;
// The shared grayscale conversion, for frames the tracker can register at all:
// a malformed or out-of-range frame has none.
function frameGray(image) {
  const { width: w, height: h, data } = image;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 ||
      w > 1600 || h > 1600 || data?.length !== w * h * 4) return null;
  return gray(image);
}
// What depends on a frame alone: its grayscale pixels and the integral image
// its content is sampled from. One operation checks several anchors against
// the same frame, so each is computed once, on first use.
export function trackingFrame(image) {
  let g, integral;
  return {
    get gray() { if (g === undefined) g = frameGray(image); return g; },
    get integral() { return (integral ??= integralImage(image, this.gray)); },
  };
}
function at(g, w, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy, i = iy * w + ix;
  return (g[i] * (1 - dx) + g[i + 1] * dx) * (1 - dy) +
    (g[i + w] * (1 - dx) + g[i + w + 1] * dx) * dy;
}
function patch(g, w, h, x, y) {
  if (x < R + 1 || y < R + 1 || x >= w - R - 2 || y >= h - R - 2) return null;
  const values = new Float32Array(PATCH); let sum = 0, n = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const v = at(g, w, x + dx, y + dy); values[n++] = v; sum += v;
  }
  const mean = sum / PATCH; let energy = 0;
  for (let i = 0; i < PATCH; i++) { values[i] -= mean; energy += values[i] ** 2; }
  return { values, energy };
}
function features(image, corners, g) {
  const { width: w, height: h } = image, m = homography(corners), points = [];
  // One corner-like feature per spatial bin. Flat paper and a straight edge
  // cannot determine two-dimensional motion and are intentionally excluded.
  for (let by = 0; by < 5; by++) for (let bx = 0; bx < 5; bx++) {
    let best = null, score = 25;
    for (let sy = 0; sy < 7; sy++) for (let sx = 0; sx < 7; sx++) {
      const u = .025 + .95 * (bx + (sx + .5) / 7) / 5,
        v = .025 + .95 * (by + (sy + .5) / 7) / 5,
        p = project(m, u, v), x = Math.round(p.x), y = Math.round(p.y);
      if (x < R + 2 || y < R + 2 || x >= w - R - 3 || y >= h - R - 3) continue;
      let xx = 0, yy = 0, xy = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (y + dy) * w + x + dx, gx = g[i + 1] - g[i - 1], gy = g[i + w] - g[i - w];
        xx += gx * gx; yy += gy * gy; xy += gx * gy;
      }
      const value = (xx * yy - xy * xy) / Math.max(1, xx + yy);
      if (value > score) { score = value; best = { u, v, ...p }; }
    }
    if (best) { const q = patch(g, w, h, best.x, best.y); if (q?.energy > 1000) points.push({ ...best, ...q }); }
  }
  return points;
}
export function gridAnchor(image, corners, rows, cols, frame = trackingFrame(image)) {
  const g = frame.gray;
  if (!g || !validQuad(corners, image.width, image.height)) return null;
  const content = gridContent(image, corners, rows, cols, frame);
  if (!content) return null;
  return { image, gray: g, corners: corners.map(p => ({ ...p })), rows, cols, content,
    points: features(image, corners, g) };
}
function locate(point, g, w, h, predicted) {
  let best = null, bestError = Infinity;
  function score(x, y) {
    if (x < R + 1 || y < R + 1 || x >= w - R - 2 || y >= h - R - 2) return;
    let sum = 0, squared = 0, product = 0, anchorSum = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const value = at(g, w, x + dx, y + dy), a = point.values[n++];
      sum += value; squared += value * value; product += a * value; anchorSum += a;
    }
    const energy = Math.max(0, squared - sum * sum / PATCH);
    if (energy < point.energy * .35 || energy > point.energy * 2.8) return;
    const error = 1 - (product - anchorSum * sum / PATCH) / Math.sqrt(point.energy * energy);
    if (error < bestError) { bestError = error; best = { ...point, tx: x, ty: y, error }; }
  }
  for (let dy = -SEARCH; dy <= SEARCH; dy += 2)
    for (let dx = -SEARCH; dx <= SEARCH; dx += 2) score(predicted.x + dx, predicted.y + dy);
  for (const step of [.5, .125]) {
    if (!best) break;
    const { tx, ty } = best;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) score(tx + dx * step, ty + dy * step);
  }
  return bestError < .12 ? best : null;
}
function solve(matrix, vector) {
  const a = matrix.map((row, i) => [...row, vector[i]]), n = a.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-9) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const scale = a[k][k]; for (let j = k; j <= n; j++) a[k][j] /= scale;
    for (let i = 0; i < n; i++) if (i !== k) {
      const s = a[i][k]; for (let j = k; j <= n; j++) a[i][j] -= s * a[k][j];
    }
  }
  return a.map(row => row[n]);
}
function fit(points, perspective = false) {
  const n = perspective ? 8 : 6, a = Array.from({ length: n }, () => Array(n).fill(0)), b = Array(n).fill(0);
  for (const p of points) {
    const x = p.tx / 1600, y = p.ty / 1600, u = p.x / 1600, v = p.y / 1600;
    const rows = [[u, v, 1, 0, 0, 0], [0, 0, 0, u, v, 1]];
    if (perspective) { rows[0].push(-x * u, -x * v); rows[1].push(-y * u, -y * v); }
    rows.forEach((row, index) => {
      for (let i = 0; i < n; i++) { b[i] += row[i] * (index ? y : x); for (let j = 0; j < n; j++) a[i][j] += row[i] * row[j]; }
    });
  }
  const m = solve(a, b);
  return m && ((u, v) => {
    const z = perspective ? m[6] * u + m[7] * v + 1 : 1;
    return { x: 1600 * (m[0] * u + m[1] * v + m[2]) / z, y: 1600 * (m[3] * u + m[4] * v + m[5]) / z };
  });
}
function registration(anchor, image, g, hint) {
  const m = homography(hint), matches = anchor.points.map(p => locate(p, g, image.width, image.height, project(m, p.u, p.v))).filter(Boolean);
  if (matches.length < 8) return null;
  let inliers = [];
  // Deterministic spatial triplets: outlier patches cannot drag all four
  // corners towards a finger, screen decoration or another repeated grid line.
  for (let i = 0; i < matches.length; i++) for (const stride of [3, 5, 7]) {
    const f = fit([matches[i], matches[(i + stride) % matches.length], matches[(i + 2 * stride) % matches.length]]);
    if (!f) continue;
    const good = matches.filter(p => { const q = f(p.x / 1600, p.y / 1600); return Math.hypot(q.x - p.tx, q.y - p.ty) < 1.3; });
    if (good.length > inliers.length) inliers = good;
  }
  if (inliers.length < 8 || inliers.length < anchor.points.length * .6 ||
      Math.max(...inliers.map(p => p.u)) - Math.min(...inliers.map(p => p.u)) < .45 ||
      Math.max(...inliers.map(p => p.v)) - Math.min(...inliers.map(p => p.v)) < .45) return null;
  const f = fit(inliers, true);
  if (!f) return null;
  const corners = anchor.corners.map(p => f(p.x / 1600, p.y / 1600));
  if (!validQuad(corners, image.width, image.height) ||
      corners.some((p,i) => Math.hypot(p.x - hint[i].x, p.y - hint[i].y) > SEARCH * 2)) return null;
  return corners;
}
export function matchGrid(anchor, image, hint = anchor?.corners, diagnostic = null, frame = trackingFrame(image)) {
  if (!anchor || image?.width !== anchor.image.width || image?.height !== anchor.image.height ||
      !validQuad(hint, image.width, image.height)) {
    if (diagnostic) diagnostic.reason = 'geometry-mismatch';
    return null;
  }
  // Common stationary case avoids patch search. An exact view is not an
  // invitation to ignore later content changes; no result is cached across ticks.
  const g = frame.gray; if (!g) return null;
  let identical = true;
  for (let i = 0; i < g.length; i++) if (g[i] !== anchor.gray[i]) { identical = false; break; }
  if (identical) return { corners: anchor.corners, content: anchor.content };
  const corners = registration(anchor, image, g, hint) ?? hint;
  const content = gridContent(image, corners, anchor.rows, anchor.cols, frame);
  if (!sameGridContent(anchor.content, content, diagnostic)) return null;
  return { corners, content };
}
