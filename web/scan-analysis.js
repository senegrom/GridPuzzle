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

export function prepareScan(image, type, rows, cols) {
  const w = image.width,
    h = image.height,
    cw = w / cols,
    ch = h / rows,
    g = gray(image),
    mask = thresholdGray(g, w, h);
  const dark = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) dark[i] = g[i] < 125 ? 1 : 0;
  const black = Array.from(
    { length: rows * cols },
    (_, i) =>
      fraction(
        dark,
        w,
        h,
        ((i % cols) + 0.16) * cw,
        (Math.floor(i / cols) + 0.16) * ch,
        0.68 * cw,
        0.68 * ch,
      ) > 0.48,
  );
  const entries = [];
  function region(kind, cell, x, y, rw, rh, invert = false, other = null) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    rw = Math.max(1, Math.min(w - x, Math.round(rw)));
    rh = Math.max(1, Math.min(h - y, Math.round(rh)));
    let minx = rw,
      miny = rh,
      maxx = -1,
      maxy = -1,
      ink = 0;
    for (let yy = 0; yy < rh; yy++)
      for (let xx = 0; xx < rw; xx++) {
        const val = invert
          ? g[(y + yy) * w + x + xx] > 175
          : mask[(y + yy) * w + x + xx];
        if (val) {
          minx = Math.min(minx, xx);
          miny = Math.min(miny, yy);
          maxx = Math.max(maxx, xx);
          maxy = Math.max(maxy, yy);
          ink++;
        }
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
      if (black[i] && ["auto", "kakuro", "hidato"].includes(type)) {
        if (type !== "hidato") {
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
      if (type === "auto" || isCage(type))
        region(
          "label",
          i,
          (c + 0.04) * cw,
          (r + 0.015) * ch,
          0.7 * cw,
          0.255 * ch,
        );
      if (type === "auto" || type === "futoshiki") {
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
