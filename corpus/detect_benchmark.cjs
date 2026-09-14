/* Detection-only benchmark over corpus images with corner ground truth.

   Runs findGrid in the browser (the same code as the geometry worker) at the
   live scale (longest side 640) and at the photograph scale (1600), and
   records per image the stage reached (0 no quad, 0.45 quad without a
   lattice, 0.94 found), the corner error as a percentage of the true
   diagonal, rows/cols agreement with the target, and the time taken.

     node corpus/detect_benchmark.cjs [--site _site] [--limit N] [--set regex] [--out file.json]

   Prints one line per set and writes the per-image records (default
   browser-artifacts/detect-benchmark.json). It is a measurement, not a gate. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus", site: "_site", limit: 0, set: null,
  out: "browser-artifacts/detect-benchmark.json" };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i].replace(/^--/, "");
  if (flag in options) options[flag] = flag === "limit" ? Number(process.argv[++i]) : process.argv[++i];
}
const filter = options.set ? new RegExp(options.set) : null;
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const BASE = "http://127.0.0.1:8782/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function items() {
  const out = [], root = path.resolve(options.corpus);
  for (const family of fs.readdirSync(root)) {
    const familyDir = path.join(root, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const set of fs.readdirSync(familyDir)) {
      const setDir = path.join(familyDir, set), key = `${family}/${set}`;
      if (!fs.statSync(setDir).isDirectory() || (filter && !filter.test(key))) continue;
      let n = 0;
      for (const name of fs.readdirSync(setDir).sort()) {
        const ext = path.extname(name).toLowerCase();
        if (!MIME[ext]) continue;
        const target = path.join(setDir, name.slice(0, -ext.length) + ".json");
        if (!fs.existsSync(target)) continue;
        const t = JSON.parse(fs.readFileSync(target, "utf8"));
        if (!t.corners) continue;
        if (options.limit && n >= options.limit) break;
        n++;
        out.push({ key, name, file: path.join(setDir, name), mime: MIME[ext], corners: t.corners, rows: t.puzzle.rows, cols: t.puzzle.cols });
      }
    }
  }
  return out;
}

// Runs in the page.
async function detectOne({ data, mime, corners, rows, cols, scales }) {
  const { findGrid } = await import("./geometry.js");
  const img = new Image();
  img.src = `data:${mime};base64,${data}`;
  await img.decode();
  const out = {};
  for (const max of scales) {
    const s = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * s), h = Math.round(img.height * s);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h), started = performance.now(), found = findGrid(image), ms = performance.now() - started;
    const truth = corners.map(([x, y]) => ({ x: x * s, y: y * s }));
    const diagonal = Math.hypot(truth[2].x - truth[0].x, truth[2].y - truth[0].y) || 1;
    // Corner error against the best cyclic labelling of the same quad.
    let error = Infinity;
    for (let k = 0; k < 4; k++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) { const p = found.corners[(i + k) % 4]; sum += Math.hypot(p.x - truth[i].x, p.y - truth[i].y); }
      error = Math.min(error, sum / 4);
    }
    out[max] = { ms: Math.round(ms), confidence: found.confidence, rows: found.rows, cols: found.cols, boxes: found.boxes,
      error: +(100 * error / diagonal).toFixed(1), sizeOk: found.rows === rows && found.cols === cols };
  }
  return out;
}

(async () => {
  const list = items();
  if (!list.length) { console.error("no corpus images with corner ground truth under", options.corpus); process.exit(2); }
  console.log(`${list.length} images with corner ground truth`);
  const server = spawn("python", ["-m", "http.server", "8782", "--bind", "127.0.0.1", "--directory", options.site], { stdio: "ignore" });
  const results = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(100); }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
      page.setDefaultTimeout(120000);
      await page.goto(BASE);
      await page.waitForSelector('body[data-ready="true"]');
      for (const [i, item] of list.entries()) {
        const r = await page.evaluate(detectOne, { data: fs.readFileSync(item.file).toString("base64"), mime: item.mime,
          corners: item.corners, rows: item.rows, cols: item.cols, scales: [640, 1600] });
        results.push({ key: item.key, name: item.name, rows: item.rows, cols: item.cols, at640: r[640], at1600: r[1600] });
        if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${list.length}`);
      }
    } finally { await browser.close(); }
  } finally { server.kill(); }
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, JSON.stringify(results) + "\n");
  const groups = new Map();
  for (const r of results) { if (!groups.has(r.key)) groups.set(r.key, []); groups.get(r.key).push(r); }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  for (const scale of ["at640", "at1600"]) {
    console.log(`\n=== longest side ${scale.slice(2)}`);
    for (const [key, rows] of [...groups].sort()) {
      const g = rows.map((r) => r[scale]), found = g.filter((x) => x.confidence >= 0.9);
      const good = found.filter((x) => x.sizeOk && x.error <= 3).length, quad = g.filter((x) => x.confidence > 0 && x.confidence < 0.9).length;
      console.log(`${key.padEnd(34)} n ${String(rows.length).padStart(4)}  good ${String(good).padStart(4)}  found ${String(found.length).padStart(4)}`
        + `  quad only ${String(quad).padStart(4)}  none ${String(g.length - found.length - quad).padStart(4)}`
        + `  median corner error ${median(found.map((x) => x.error)) ?? "-"}%  median ms ${median(g.map((x) => x.ms))}`);
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
