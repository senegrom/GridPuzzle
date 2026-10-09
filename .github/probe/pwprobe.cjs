// Temporary probe for the Playwright 1.64 pull request, removed again once it
// has run: what both engines draw, decode and resample for the suites and the
// app, so that a job in the 1.63.0 image and one in the 1.64.0 image can be
// compared pixel for pixel. The font part is the scanner-setup pull request's
// probe (#129); the rest follows the canvas paths the suites and the app take
// (photo import, original detail, OCR crops, ocr_quality's blur and half
// size, scan_input's JPEG pages). Prints one line per drawing and writes
// probe-out/<engine>/index.json with a PNG per drawing where useful.
"use strict";
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const playwright = require("playwright");

const OUT = "probe-out";
// The suites' phone (scripts/harness.cjs).
const PHONE = { serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true };
// The families the suites write their test pictures in (scripts/*.cjs), at
// every size they draw.
const FAMILIES = ["Arial", "Times New Roman", "Courier New", "DejaVu Sans", "DejaVu Serif",
  "FreeSans", "FreeSerif", "Georgia", "serif", "sans-serif", "monospace"];
const SIZES = [24, 25, 26, 27, 28, 30, 32, 38, 40, 42, 48, 52, 58, 64, 70, 100, 130];
const SUITE_TEXT = "0123456789 47 Daily puzzle";
// What the app draws on canvases: the solution digits (app.js, stroked), the
// preview bar and the overlay digits (live-overlay.js) and the corner
// numbers (photo-flow.js), at their weights.
const APP_CANVAS = [
  ...[10, 20, 38, 60].map((size) => ({ font: `650 ${size}px -apple-system,Arial,sans-serif`, stroke: true })),
  ...[13, 23, 30].map((size) => ({ font: `600 ${size}px system-ui, sans-serif` })),
  ...[8, 14, 24, 40].map((size) => ({ font: `700 ${size}px system-ui, sans-serif` })),
  ...[12, 18, 30].map((size) => ({ font: `bold ${size}px sans-serif` })),
];
const APP_TEXT = "PREVIEW Read Check ? Unread ? Solution 0123456789";
// The page's own text (style.css).
const BODY = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const APP_CSS = [
  ...[400, 550, 600, 650, 750].flatMap((weight) =>
    [9, 12, 16, 20].map((size) => `font: ${weight} ${size}px ${BODY}`)),
  ...[45, 74].map((size) => `font: 650 ${size}px ${BODY}; letter-spacing: -3.2px`),
  ...[16, 45, 74].map((size) => `font: 550 ${size}px Georgia, serif`),
  `font: 400 12px ui-monospace, monospace`,
];
const DOM_TEXT = "Scan a puzzle · 9 × 9 · 27 printed clues — 0123456789";

// Page helpers: a pixel hash (FNV-1a over getImageData), a snapshot of a
// canvas with an optional PNG, and a deterministic photo-like source made
// with putImageData, so that resampling is probed apart from decoding.
const HELPERS = `(() => {
  window.__fnv = (data) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) { hash ^= data[i]; hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).padStart(8, "0");
  };
  window.__shot = (canvas, keep) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) ink++;
    return { desc: canvas.width + "x" + canvas.height + " ink=" + ink + " hash=" + window.__fnv(data),
      png: keep ? canvas.toDataURL("image/png") : null };
  };
  window.__synthetic = (w, h) => {
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"), image = ctx.createImageData(w, h), d = image.data;
    let seed = 12345;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 222 + 22 * Math.sin(x / 97) * Math.cos(y / 71);
      if (x % 50 < 2 || y % 50 < 2) v = 40;
      const r = Math.hypot(((x % 50) - 25) / 8, ((y % 50) - 25) / 13);
      if (Math.abs(r - 1) < 0.18 && (((x / 50) | 0) + ((y / 50) | 0)) % 3 === 0) v = 30;
      v += (rand() - 0.5) * 16;
      const i = (y * w + x) * 4;
      d[i] = clamp(v + 6); d[i + 1] = clamp(v); d[i + 2] = clamp(v - 8); d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  };
})()`;

function sh(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); } catch (error) { return `(${command} failed: ${error.message.split("\n")[0]})`; }
}

function recorder(engine) {
  const dir = path.join(OUT, engine);
  fs.mkdirSync(dir, { recursive: true });
  const index = { engine, entries: {} };
  return {
    index,
    save(key, desc, png) {
      let file = null;
      if (png) {
        const buffer = Buffer.isBuffer(png) ? png : Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
        file = `${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}.png`;
        fs.writeFileSync(path.join(dir, file), buffer);
      }
      index.entries[key] = { desc, file };
      console.log(`${engine} ${key}: ${desc}`);
    },
    write() { fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 1)); },
  };
}

async function drawText(page, font, text, stroke = false) {
  return page.evaluate(({ font, text, stroke }) => {
    const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const width = measure.measureText(text).width;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width + 16 + size * 0.2); canvas.height = Math.ceil(size * 2);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = stroke ? "#808080" : "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = font; ctx.textBaseline = "middle";
    if (stroke) {
      ctx.lineWidth = Math.max(2, size * 0.1); ctx.strokeStyle = "#ffffffee";
      ctx.strokeText(text, 8, canvas.height / 2);
      ctx.fillStyle = "#067c6b";
    } else ctx.fillStyle = "#000";
    ctx.fillText(text, 8, canvas.height / 2);
    const shot = window.__shot(canvas, true);
    return { desc: `${shot.desc} width=${Math.round(width * 100) / 100}`, png: shot.png };
  }, { font, text, stroke });
}

// Resampling, filters and encoders on the deterministic source: the canvas
// operations the app's OCR crops and the suites' degraded pictures use.
async function synthetic(page) {
  return page.evaluate(async () => {
    const out = {}, source = window.__synthetic(1200, 900);
    const shot = (key, canvas, keep = true) => { out[key] = window.__shot(canvas, keep); };
    const blank = (w, h, fill = "#fff") => {
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h);
      return [canvas, ctx];
    };
    shot("source", source, false);
    for (const quality of ["high", "medium", "low", "off"]) {
      const [canvas, ctx] = blank(443, 332);
      if (quality === "off") ctx.imageSmoothingEnabled = false;
      else { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = quality; }
      ctx.drawImage(source, 0, 0, 443, 332);
      shot(`downscale 0.369 ${quality}`, canvas);
    }
    // cageLabelCrop (40 px high, 16 px margin) and sampleCanvas (64 px high,
    // 16 px pad), smoothing high, of small boxes: enlargements
    for (const [x, y, w, h] of [[103, 98, 30, 40], [260, 212, 21, 33], [611, 407, 44, 28]]) {
      for (const height of [40, 64]) {
        const scale = height / h, [canvas, ctx] = blank(Math.max(1, Math.round(w * scale)) + 32, height + 32);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, x, y, w, h, 16, 16, canvas.width - 32, height);
        shot(`crop ${x},${y},${w}x${h} to ${height}px high`, canvas);
      }
      // the OCR atlas tile: default smoothing, scaled to fit 74/112 of a 112 px tile
      const tile = 112, scale = Math.min((tile * 74) / 112 / w, (tile * 72) / 112 / h), [canvas, ctx] = blank(tile, tile);
      ctx.drawImage(source, x, y, w, h, (tile - w * scale) / 2, (tile - h * scale) / 2, w * scale, h * scale);
      shot(`atlas ${x},${y},${w}x${h}`, canvas);
    }
    // ocr-aspect.js: horizontal stretches with smoothing high
    for (const factor of [1.5, 2]) {
      const [canvas, ctx] = blank(Math.round(120 * factor), 60);
      const [crop] = blank(120, 60); crop.getContext("2d").drawImage(source, 300, 300, 120, 60, 0, 0, 120, 60);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(crop, 0, 0, canvas.width, canvas.height);
      shot(`aspect ${factor}`, canvas);
    }
    // ocr_quality's blur variation (0.6 px), drawn as it draws it, and wider
    // radii: whether the context has a filter at all, and what it changes
    {
      const sourceData = source.getContext("2d").getImageData(0, 0, 1200, 900).data;
      out["canvas filter"] = { desc: `"filter" in context: ${"filter" in source.getContext("2d")}`, png: null };
      for (const radius of [0.6, 1, 2]) {
        const [copy] = blank(1200, 900); copy.getContext("2d").drawImage(source, 0, 0);
        const [canvas, ctx] = blank(1200, 900); ctx.drawImage(source, 0, 0);
        ctx.filter = `blur(${radius}px)`; ctx.drawImage(copy, 0, 0); ctx.filter = "none";
        shot(`blur ${radius}px`, canvas, false);
        const data = ctx.getImageData(0, 0, 1200, 900).data;
        let changed = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] !== sourceData[i] || data[i + 1] !== sourceData[i + 1] || data[i + 2] !== sourceData[i + 2]) changed++;
        out[`blur ${radius}px`].desc += ` changed=${changed}`;
      }
    }
    // encoders and the decoders' resize: scan_input's JPEG pages, PNG round trip
    const blob = (type, quality) => new Promise((resolve) => source.toBlob(resolve, type, quality));
    // about:blank is no secure context, so no crypto.subtle: FNV-1a of the bytes
    const digest = async (b) => window.__fnv(new Uint8Array(await b.arrayBuffer()));
    for (const quality of [0.94, 0.95]) {
      const jpeg = await blob("image/jpeg", quality);
      const natural = await createImageBitmap(jpeg);
      const [canvas, ctx] = blank(natural.width, natural.height); ctx.drawImage(natural, 0, 0); natural.close();
      shot(`jpeg ${quality} decoded`, canvas, false);
      out[`jpeg ${quality} decoded`].desc += ` bytes=${jpeg.size} file=${await digest(jpeg)}`;
      const resized = await createImageBitmap(jpeg, { resizeWidth: 800, imageOrientation: "from-image", resizeQuality: "high" });
      const [small, sctx] = blank(resized.width, resized.height); sctx.drawImage(resized, 0, 0); resized.close();
      shot(`jpeg ${quality} decoded, resized to 800 high`, small);
    }
    {
      const png = await blob("image/png");
      const bitmap = await createImageBitmap(png);
      const [canvas, ctx] = blank(bitmap.width, bitmap.height); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      shot("png round trip", canvas, false);
    }
    for (const quality of ["high", "low"]) {
      const bitmap = await createImageBitmap(source, { resizeWidth: 443, resizeHeight: 332, resizeQuality: quality });
      const [canvas, ctx] = blank(bitmap.width, bitmap.height); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      shot(`createImageBitmap resize ${quality}`, canvas);
    }
    return out;
  });
}

// A photo through the app's import (photo-import.js), the original-detail
// read (photo-detail.js), ocr_quality's Image decode at half size, and crops
// of the import as the OCR reads them.
async function photo(page, name, bytes, keep) {
  return page.evaluate(async ({ base64, keep }) => {
    const out = {}, data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new Blob([data], { type: "image/webp" });
    const shot = (key, canvas, png = false) => { out[key] = window.__shot(canvas, png); };
    const blank = (w, h) => {
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      return [canvas, ctx];
    };
    const natural = await createImageBitmap(file, { imageOrientation: "from-image" });
    const W = natural.width, H = natural.height;
    { const [canvas, ctx] = blank(W, H); ctx.drawImage(natural, 0, 0); shot("decode", canvas); canvas.width = 0; }
    const scale = Math.min(1, 1600 / Math.max(W, H)), w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    let via = "createImageBitmap", source = null;
    try { source = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high", imageOrientation: "from-image" }); }
    catch (error) {
      via = `Image after ${error.name}`;
      source = new Image(); source.src = URL.createObjectURL(file); await source.decode();
    }
    const [imported, ictx] = blank(w, h); ictx.drawImage(source, 0, 0, w, h); source.close?.();
    shot("import", imported, keep); out.import.desc += ` via ${via}`;
    {
      const image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * 0.5); canvas.height = Math.round(image.naturalHeight * 0.5);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      shot("Image decode at half size", canvas, keep);
    }
    {
      const sx = Math.round(W / 4), sy = Math.round(H / 4), sw = Math.round(W / 2), sh = Math.round(H / 2);
      const [canvas, ctx] = blank(Math.round(sw * 1.25), Math.round(sh * 1.25));
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(natural, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      shot("detail 1.25x high", canvas); canvas.width = 0;
    }
    natural.close();
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) {
      const bw = Math.max(8, Math.round(w * 0.07)), bh = Math.max(8, Math.round(h * 0.05));
      const bx = Math.round(w * (0.2 + k * 0.17)), by = Math.round(h * (0.3 + r * 0.15)), id = `crop ${r}${k}`;
      { const [canvas, ctx] = blank(bw, bh); ctx.drawImage(imported, bx, by, bw, bh, 0, 0, bw, bh); shot(`${id} native`, canvas, true); }
      for (const height of [40, 64]) {
        const [canvas, ctx] = blank(Math.max(1, Math.round(bw * (height / bh))) + 32, height + 32);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imported, bx, by, bw, bh, 16, 16, canvas.width - 32, height);
        shot(`${id} ${height}px high`, canvas, true);
      }
    }
    imported.width = 0;
    return out;
  }, { base64: bytes.toString("base64"), keep });
}

// scan_input's wide page: 25 px digits on a 3200x2400 page, JPEG at 0.94,
// decoded to 1600 wide with resizeQuality high.
async function widePage(page, font) {
  return page.evaluate(async (font) => {
    const canvas = document.createElement("canvas"); canvas.width = 3200; canvas.height = 2400;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 3200, 2400);
    ctx.fillStyle = "#333"; ctx.font = "24px serif"; ctx.fillText("Daily puzzle — printed number recognition", 900, 650);
    const x = 1200, y = 850, cell = 90, size = cell * 9;
    ctx.strokeStyle = "#111";
    for (let k = 0; k <= 9; k++) {
      ctx.lineWidth = k % 3 === 0 ? 3 : 1;
      ctx.beginPath(); ctx.moveTo(x + k * cell, y); ctx.lineTo(x + k * cell, y + size);
      ctx.moveTo(x, y + k * cell); ctx.lineTo(x + size, y + k * cell); ctx.stroke();
    }
    ctx.fillStyle = "#111"; ctx.font = `25px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let k = 0; k < 27; k++) {
      const i = (k * 37 + 13) % 81, r = Math.floor(i / 9), c = i % 9, value = (r * 3 + Math.floor(r / 3) + c) % 9 + 1;
      ctx.fillText(String(value), x + (c + .5) * cell, y + (r + .5) * cell);
    }
    const page = window.__shot(canvas, false);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .94));
    const bitmap = await createImageBitmap(blob, { resizeWidth: 1600, imageOrientation: "from-image", resizeQuality: "high" });
    const preview = document.createElement("canvas"); preview.width = bitmap.width; preview.height = bitmap.height;
    preview.getContext("2d").drawImage(bitmap, 0, 0); bitmap.close();
    // the board's area only, as a PNG
    const board = document.createElement("canvas"); board.width = 420; board.height = 420;
    board.getContext("2d").drawImage(preview, 590, 415, 420, 420, 0, 0, 420, 420);
    return { page: page.desc, jpeg: `bytes=${blob.size}`, preview: window.__shot(preview, false).desc, board: window.__shot(board, true) };
  }, font);
}

async function main() {
  console.log("os:", sh("sh", ["-c", ". /etc/os-release; echo $PRETTY_NAME"]), "| host:", sh("sh", ["-c", "[ -r /run/host/os-release ] && . /run/host/os-release && echo $PRETTY_NAME || echo none"]));
  console.log("playwright:", require("playwright/package.json").version);
  console.log("docker-info:", fs.existsSync("/ms-playwright/.docker-info") ? fs.readFileSync("/ms-playwright/.docker-info", "utf8").replace(/\s+/g, " ") : "none");
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "dpkg.txt"), sh("dpkg-query", ["-W", "-f", "${Package}\t${Version}\n"]) + "\n");
  console.log("libraries:", sh("dpkg-query", ["-W", "-f", "${Package}=${Version} ",
    "libfreetype6", "libharfbuzz0b", "libfontconfig1", "fontconfig-config", "libwebp7", "libjpeg-turbo8", "libpng16-16t64",
    "libcairo2", "libglib2.0-0t64", "libicu74", "libwoff1", "libgstreamer1.0-0", "fonts-liberation", "fonts-freefont-ttf"]));
  for (const name of ["chromium", "webkit"]) console.log(`executable ${name}:`, playwright[name].executablePath());
  const patterns = [...FAMILIES, "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "ui-monospace", "Lato",
    "sans-serif:weight=600", "sans-serif:bold", "serif:bold", "Arial:bold", "Georgia:weight=550"];
  for (const pattern of patterns) console.log(`fc-match ${pattern}:`, sh("fc-match", ["-f", "%{family[0]}|%{style[0]}|%{file}", pattern]));
  const families = sh("fc-list", [":", "family"]).split("\n").map((line) => line.trim()).filter(Boolean).sort();
  console.log(`fc-list: ${new Set(families).size} families:`, [...new Set(families)].join("; "));
  const fixtures = [
    ...fs.readdirSync("Examples/BrowserScanner/Newspaper").filter((name) => name.endsWith(".webp"))
      .map((name) => ({ name, bytes: fs.readFileSync(path.join("Examples/BrowserScanner/Newspaper", name)), keep: true })),
    ...JSON.parse(fs.readFileSync("live-fixtures/fixtures.json", "utf8")).fixtures
      .map((f) => ({ name: f.name.replace(/^images\//, ""), bytes: Buffer.from(f.data.slice(f.data.indexOf(",") + 1), "base64"), keep: false })),
  ];
  for (const name of ["chromium", "webkit"]) {
    const browser = await playwright[name].launch({ headless: true });
    const context = await browser.newContext(PHONE), page = await context.newPage();
    const record = recorder(name);
    record.index.version = browser.version();
    console.log(`version ${name}:`, browser.version());
    await page.setContent("<!doctype html><title>probe</title>");
    await page.evaluate(HELPERS);
    for (const size of SIZES)
      for (const family of FAMILIES) {
        const { desc, png } = await drawText(page, `${size}px ${family}`, SUITE_TEXT);
        record.save(`suite ${size}px ${family}`, desc, png);
      }
    for (const { font, stroke } of APP_CANVAS) {
      const { desc, png } = await drawText(page, font, APP_TEXT, stroke);
      record.save(`app ${font}${stroke ? " stroked" : ""}`, desc, png);
    }
    const first = await synthetic(page), again = await synthetic(page);
    for (const [key, value] of Object.entries(first))
      record.save(`synthetic ${key}`, value.desc + (again[key].desc === value.desc ? "" : ` NONDETERMINISTIC (${again[key].desc})`), value.png);
    for (const fixture of fixtures) {
      const result = await photo(page, fixture.name, fixture.bytes, fixture.keep);
      for (const [key, value] of Object.entries(result)) record.save(`photo ${fixture.name} ${key}`, value.desc, value.png);
    }
    for (const family of FAMILIES) {
      const result = await widePage(page, family);
      record.save(`wide ${family} page`, result.page, null);
      record.save(`wide ${family} jpeg preview`, `${result.preview} ${result.jpeg}`, null);
      record.save(`wide ${family} board`, result.board.desc, result.board.png);
    }
    await page.setContent("<!doctype html><meta charset=utf-8><title>probe</title>"
      + "<style>body{margin:0;background:#fff;color:#000}div{display:inline-block;padding:4px;white-space:nowrap}</style>"
      + APP_CSS.map((style, index) => `<div id=d${index} style='${style}'>${DOM_TEXT}</div><br>`).join(""));
    for (const [index, style] of APP_CSS.entries()) {
      const box = await page.locator(`#d${index}`).boundingBox();
      const png = await page.locator(`#d${index}`).screenshot();
      record.save(`dom ${style}`, `${Math.round(box.width * 100) / 100}x${Math.round(box.height * 100) / 100}`, png);
    }
    record.write();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
