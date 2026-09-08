import { isGridStroke } from "./ocr-map.js";
import { isCage } from "./model.js";
import { gray, thresholdGray, estimateGrid } from "./geometry.js";

function fraction(mask, w, h, x, y, rw, rh) {
  let sum = 0,
    n = 0;
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) {
      sum += mask[yy * w + xx];
      n++;
    }
  return sum / Math.max(1, n);
}

function mean(grayImage, w, h, x, y, rw, rh) {
  let sum = 0,
    n = 0;
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) {
      sum += grayImage[yy * w + xx];
      n++;
    }
  return sum / Math.max(1, n);
}

// Solid Str8ts/Kakuro/Hidato blocks are much darker than the bright-cell
// population even under an illumination gradient. Newspaper Sudoku shading is
// halftone grey and must not become a black structural cell merely because the
// lower corner of the photograph is in shadow.
export function detectBlackCells(g, w, h, rows, cols) {
  const cw = w / cols,
    ch = h / rows,
    dark = new Uint8Array(g.length),
    means = [],
    darkFractions = [];
  for (let i = 0; i < g.length; i++) dark[i] = g[i] < 125 ? 1 : 0;
  for (let i = 0; i < rows * cols; i++) {
    const c = i % cols,
      r = Math.floor(i / cols),
      x = (c + 0.16) * cw,
      y = (r + 0.16) * ch,
      rw = 0.68 * cw,
      rh = 0.68 * ch;
    means.push(mean(g, w, h, x, y, rw, rh));
    darkFractions.push(fraction(dark, w, h, x, y, rw, rh));
  }
  const sorted = [...means].sort((a, b) => a - b),
    brightReference = sorted[Math.floor((sorted.length - 1) * 0.8)] || 255,
    meanCutoff = Math.min(105, brightReference * 0.48);
  return means.map(
    (value, i) => value < meanCutoff && darkFractions[i] > 0.65,
  );
}

function numberBounds(mask, w, h) {
  const seen = new Uint8Array(mask.length),
    stack = [],
    parts = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let area = 0,
      minx = w,
      miny = h,
      maxx = -1,
      maxy = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop(),
        y = Math.floor(at / w),
        x = at % w;
      area++;
      minx = Math.min(minx, x);
      miny = Math.min(miny, y);
      maxx = Math.max(maxx, x);
      maxy = Math.max(maxy, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const next = yy * w + xx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
    }
    parts.push({ area, minx, miny, maxx, maxy });
  }
  parts.sort((a, b) => b.area - a.area);
  const anchor = parts.find(
      (part) =>
        part.area >= Math.max(4, w * h * 0.003) &&
        part.maxy - part.miny + 1 >= h * 0.25,
    );
  if (!anchor) return null;
  const bounds = { ...anchor },
    height = anchor.maxy - anchor.miny + 1;
  // Neighbouring digits are separate components too. Keep substantial glyphs
  // on the same line while excluding the small dots of halftone/newsprint.
  const pending = parts.filter((part) => {
    const partHeight = part.maxy - part.miny + 1,
      overlap = Math.min(anchor.maxy, part.maxy) - Math.max(anchor.miny, part.miny) + 1;
    return part !== anchor &&
      part.area >= Math.max(4, w * h * 0.003, anchor.area * 0.1) &&
      partHeight >= height * 0.55 && partHeight <= height * 1.6 &&
      overlap >= Math.min(height, partHeight) * 0.6;
  });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const part = pending[i],
        gap = Math.max(part.minx - bounds.maxx - 1, bounds.minx - part.maxx - 1);
      if (gap > height) continue;
      bounds.minx = Math.min(bounds.minx, part.minx);
      bounds.maxx = Math.max(bounds.maxx, part.maxx);
      bounds.miny = Math.min(bounds.miny, part.miny);
      bounds.maxy = Math.max(bounds.maxy, part.maxy);
      bounds.area += part.area;
      pending.splice(i, 1);
      changed = true;
    }
  }
  return bounds;
}

export function prepareScan(image, type, rows, cols) {
  const w = image.width,
    h = image.height,
    cw = w / cols,
    ch = h / rows,
    g = gray(image),
    mask = thresholdGray(g, w, h),
    black = detectBlackCells(g, w, h, rows, cols),
    anyBlack = black.some(Boolean),
    entries = [];

  function region(kind, cell, x, y, rw, rh, invert = false, other = null) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    rw = Math.max(1, Math.min(w - x, Math.round(rw)));
    rh = Math.max(1, Math.min(h - y, Math.round(rh)));
    const local = new Uint8Array(rw * rh);
    let minx = rw,
      miny = rh,
      maxx = -1,
      maxy = -1,
      ink = 0;
    for (let yy = 0; yy < rh; yy++)
      for (let xx = 0; xx < rw; xx++) {
        const val = invert
          ? g[(y + yy) * w + x + xx] > 135
          : mask[(y + yy) * w + x + xx];
        local[yy * rw + xx] = val ? 1 : 0;
        if (val) {
          minx = Math.min(minx, xx);
          miny = Math.min(miny, yy);
          maxx = Math.max(maxx, xx);
          maxy = Math.max(maxy, yy);
          ink++;
        }
      }
    // Filter speckle without cutting a multi-digit clue into a single glyph.
    if (["value", "blackvalue"].includes(kind)) {
      const part = numberBounds(local, rw, rh);
      if (!part) return;
      ({ minx, miny, maxx, maxy } = part);
      ink = part.area;
    }
    if (
      ink < Math.max(4, rw * rh * 0.008) ||
      maxy - miny < Math.max(2, rh * 0.1)
    )
      return;
    if (kind === "label" && (maxy >= rh - 2 || maxy - miny < 3)) return;
    let edgeInk = 0;
    if (kind === "label") {
      const band = Math.max(1, Math.round(ch * 0.03));
      for (let yy = miny; yy <= maxy; yy++)
        for (let xx = minx; xx <= maxx; xx++)
          if (yy < miny + band || xx < minx + band)
            edgeInk += mask[(y + yy) * w + x + xx];
    }
    if (
      isGridStroke({
        kind,
        width: maxx - minx + 1,
        height: maxy - miny + 1,
        ink,
        edgeInk,
        regionWidth: rw,
        cellHeight: ch,
      })
    )
      return;
    if (kind === "hsign" && maxx - minx < (maxy - miny) * 0.3) return;
    if (kind === "vsign" && maxy - miny < (maxx - minx) * 0.3) return;
    entries.push({
      kind,
      cell,
      other,
      x: x + minx,
      y: y + miny,
      w: maxx - minx + 1,
      h: maxy - miny + 1,
      invert,
      text: "",
      confidence: 0,
    });
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (black[i] && ["auto", "kakuro", "hidato", "str8ts"].includes(type)) {
        if (type === "auto" || type === "str8ts")
          region(
            "blackvalue",
            i,
            (c + 0.16) * cw,
            (r + 0.16) * ch,
            0.68 * cw,
            0.68 * ch,
            true,
          );
        if (type === "auto" || type === "kakuro") {
          region(
            "across",
            i,
            (c + 0.48) * cw,
            (r + 0.04) * ch,
            0.46 * cw,
            0.4 * ch,
            true,
          );
          region(
            "down",
            i,
            (c + 0.05) * cw,
            (r + 0.55) * ch,
            0.4 * cw,
            0.4 * ch,
            true,
          );
        }
      } else
        region(
          "value",
          i,
          (c + 0.14) * cw,
          (r + 0.16) * ch,
          0.72 * cw,
          0.72 * ch,
        );
      // Structural probes are expensive and can turn a shadow into false
      // cage/sign evidence. Once a true solid block is present, the black-cell
      // families provide the useful structural signal instead.
      if ((type === "auto" && !anyBlack) || isCage(type))
        region(
          "label",
          i,
          (c + 0.04) * cw,
          (r + 0.015) * ch,
          0.7 * cw,
          0.255 * ch,
        );
      if ((type === "auto" && !anyBlack) || type === "futoshiki") {
        if (c < cols - 1)
          region(
            "hsign",
            i,
            (c + 0.82) * cw,
            (r + 0.25) * ch,
            0.36 * cw,
            0.5 * ch,
            false,
            i + 1,
          );
        if (r < rows - 1)
          region(
            "vsign",
            i,
            (c + 0.25) * cw,
            (r + 0.82) * ch,
            0.5 * cw,
            0.36 * ch,
            false,
            i + cols,
          );
      }
    }

  return { image, meta: estimateGrid(image, mask), mask, g, black, entries };
}
