from pathlib import Path


def rep(path, old, new, label):
    p = Path(path)
    s = p.read_text(encoding="utf-8")
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match in {path}, found {n}")
    p.write_text(s.replace(old, new), encoding="utf-8")


# Strong centered white-on-black digit evidence is a better Str8ts signal than
# an incidental false Kakuro corner read. Two centered digits are required so a
# blocked Hidato with one speckle cannot become Str8ts automatically.
p = "web/model.js"
rep(
    p,
    '  if (black && triangles) return { type:"kakuro", review:true, reason:"Cross-sum layout detected. Check black cells and both clue directions." };\n  if (black && blackNumbers && rows === cols && rows <= 9) return { type:"str8ts", review:true, reason:"Numbered black cells suggest Str8ts. Check every black cell and printed digit." };\n',
    '  if (black && blackNumbers >= 2 && rows === cols && rows <= 9) return { type:"str8ts", review:true, reason:"Multiple centered digits on black cells suggest Str8ts. Check every black cell and printed digit." };\n  if (black && triangles) return { type:"kakuro", review:true, reason:"Cross-sum layout detected. Check black cells and both clue directions." };\n',
    "Str8ts classification precedence",
)

# Newsprint can make a white digit on a black cell much dimmer than 165. The
# center crop keeps borders out, so 135 recovers dim clues without admitting
# ordinary black-cell texture. Real digits occupy a substantial fraction of the
# cell height; require that to reject isolated paper/halftone specks.
p = "web/scan-analysis.js"
rep(p, "        part.maxy - part.miny + 1 >= h * 0.12,\n", "        part.maxy - part.miny + 1 >= h * 0.25,\n", "digit component height")
rep(p, "          ? g[(y + yy) * w + x + xx] > 165\n", "          ? g[(y + yy) * w + x + xx] > 135\n", "dim black-cell digit threshold")

# Preserve the black-cell role when the user clears only its printed number.
p = "web/app.js"
rep(
    p,
    '$("clear-cell").onclick = () => {\n  $("cell-value").value = "";\n  $("blocked-cell").checked = false;\n  $("across-value").value = $("down-value").value = "";\n  saveCell();\n};\n',
    '$("clear-cell").onclick = () => {\n  const keepBlack =\n    state.puzzle.type === "str8ts" && (state.puzzle.black || []).includes(editing);\n  $("cell-value").value = "";\n  $("blocked-cell").checked = keepBlack;\n  $("across-value").value = $("down-value").value = "";\n  saveCell();\n};\n',
    "clear Str8ts clue",
)

# The geometry worker finds the digit component. Build OCR tiles from a padded
# local grayscale crop and binarize each tile independently with Otsu. This is
# far more stable on shaded/dirty newspaper paper than reusing the whole-page
# adaptive threshold while retaining one bounded Tesseract call.
p = "web/scanner.js"
insert_after = '''function fraction(mask, w, h, x, y, rw, rh) {
  let sum = 0,
    n = 0;
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, y + rh); yy++)
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, x + rw); xx++) {
      sum += mask[yy * w + xx];
      n++;
    }
  return sum / Math.max(1, n);
}
'''
helpers = '''function otsuThreshold(g, width, x, y, w, h) {
  const histogram = new Uint32Array(256);
  let total = 0,
    sum = 0;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const value = g[yy * width + xx];
      histogram[value]++;
      total++;
      sum += value;
    }
  let background = 0,
    backgroundSum = 0,
    best = -1,
    threshold = 127;
  for (let value = 0; value < 256; value++) {
    background += histogram[value];
    if (!background) continue;
    const foreground = total - background;
    if (!foreground) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / background,
      meanForeground = (sum - backgroundSum) / foreground,
      score = background * foreground * (meanBackground - meanForeground) ** 2;
    if (score > best) {
      best = score;
      threshold = value;
    }
  }
  return threshold;
}
function digitCrop(entry, g, imageWidth, imageHeight, cellWidth, cellHeight, cols) {
  const pad = Math.max(2, Math.round(Math.min(cellWidth, cellHeight) * 0.05)),
    row = Math.floor(entry.cell / cols),
    col = entry.cell % cols,
    minX = Math.max(0, Math.round((col + 0.08) * cellWidth)),
    maxX = Math.min(imageWidth, Math.round((col + 0.92) * cellWidth)),
    minY = Math.max(0, Math.round((row + 0.08) * cellHeight)),
    maxY = Math.min(imageHeight, Math.round((row + 0.92) * cellHeight)),
    x = Math.max(minX, entry.x - pad),
    y = Math.max(minY, entry.y - pad),
    right = Math.min(maxX, entry.x + entry.w + pad),
    bottom = Math.min(maxY, entry.y + entry.h + pad),
    width = Math.max(1, right - x),
    height = Math.max(1, bottom - y),
    threshold = otsuThreshold(g, imageWidth, x, y, width, height),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d"),
    pixels = context.createImageData(width, height);
  for (let yy = 0; yy < height; yy++)
    for (let xx = 0; xx < width; xx++) {
      const source = g[(y + yy) * imageWidth + x + xx],
        foreground = entry.invert ? source > threshold : source < threshold,
        value = foreground ? 0 : 255,
        at = 4 * (yy * width + xx);
      pixels.data[at] = pixels.data[at + 1] = pixels.data[at + 2] = value;
      pixels.data[at + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
'''
rep(p, insert_after, insert_after + helpers, "local Otsu helpers")
old = '''    entries.forEach((e, i) => {
      const scale = Math.min((tile * 74) / 112 / e.w, (tile * 72) / 112 / e.h),
        dw = e.w * scale,
        dh = e.h * scale,
        x = (i % columns) * tile + (tile - dw) / 2,
        y = Math.floor(i / columns) * tile + (tile - dh) / 2;
      ctx.save();
      if (e.invert) ctx.filter = "invert(1)";
      ctx.drawImage(
        e.invert ? rectified : bw,
        e.x,
        e.y,
        e.w,
        e.h,
        x,
        y,
        dw,
        dh,
      );
      ctx.restore();
    });
'''
new = '''    entries.forEach((e, i) => {
      const isDigit = ["value", "blackvalue"].includes(e.kind),
        source = isDigit
          ? digitCrop(e, g, w, h, cw, ch, cols)
          : e.invert
            ? rectified
            : bw,
        sx = isDigit ? 0 : e.x,
        sy = isDigit ? 0 : e.y,
        sw = isDigit ? source.width : e.w,
        sh = isDigit ? source.height : e.h,
        scale = Math.min((tile * 74) / 112 / sw, (tile * 72) / 112 / sh),
        dw = sw * scale,
        dh = sh * scale,
        x = (i % columns) * tile + (tile - dw) / 2,
        y = Math.floor(i / columns) * tile + (tile - dh) / 2;
      ctx.save();
      if (!isDigit && e.invert) ctx.filter = "invert(1)";
      ctx.drawImage(source, sx, sy, sw, sh, x, y, dw, dh);
      ctx.restore();
    });
'''
rep(p, old, new, "per-digit Otsu atlas")

# Regression: Str8ts evidence must win over a stray corner read only when it is
# strong, and dim white-on-black clues must survive preprocessing.
p = Path("web/tests/classification.test.js")
s = p.read_text(encoding="utf-8")
extra = '''\ntest("multiple centered black digits distinguish Str8ts from a stray Kakuro read", () => {
  assert.equal(
    classify({ rows: 9, cols: 9, black: 22, blackNumbers: 4, triangles: 1 }).type,
    "str8ts",
  );
  assert.equal(
    classify({ rows: 9, cols: 9, black: 22, blackNumbers: 1, triangles: 4 }).type,
    "kakuro",
  );
});
'''
if extra.strip() not in s:
    p.write_text(s + extra, encoding="utf-8")

p = Path("web/tests/newspaper-analysis.test.js")
s = p.read_text(encoding="utf-8")
s = s.replace(
    'import { detectBlackCells } from "../scan-analysis.js";',
    'import { detectBlackCells, prepareScan } from "../scan-analysis.js";',
)
extra = '''\ntest("dim white-on-black newspaper digits still produce a Str8ts OCR region", () => {
  const width = 90, height = 90,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 30; y < 60; y++)
    for (let x = 30; x < 60; x++) {
      const at = 4 * (y * width + x);
      data[at] = data[at + 1] = data[at + 2] = 25;
    }
  for (let y = 37; y < 54; y++)
    for (let x = 42; x < 48; x++) {
      const at = 4 * (y * width + x);
      data[at] = data[at + 1] = data[at + 2] = 150;
    }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const result = prepareScan({ width, height, data }, "str8ts", 3, 3);
  assert.equal(result.black[4], true);
  assert.ok(result.entries.some((e) => e.kind === "blackvalue" && e.cell === 4));
});
'''
if extra.strip() not in s:
    p.write_text(s + extra, encoding="utf-8")
