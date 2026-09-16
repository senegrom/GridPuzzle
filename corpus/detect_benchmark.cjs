/* Detection-only measurement at the live (640) and photo (1600) scales.
   Uses the same checkpoint/cleanup lifecycle as the OCR benchmark.
   node corpus/detect_benchmark.cjs [--site _site] [--limit N] [--set regex] [--out file.json]
   Reports use the versioned envelope documented in web/GRID_DETECTION.md. */
const fs = require("node:fs");
const path = require("node:path");
const { runBenchmark } = require("./benchmark-runner.cjs");
const BASE = "http://127.0.0.1:8782/";
const SCALES = [640, 1600];
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function parseOptions(args) {
  const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus",
    site: "_site", limit: 0, set: null, out: "browser-artifacts/detect-benchmark.json", engine: "chromium" };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !Object.hasOwn(options, flag)) throw Error(`Unknown option: ${args[i]}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`Missing value for --${flag}`);
    options[flag] = flag === "limit" ? Number(value) : value;
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 0) throw Error("Limit must be a nonnegative whole number");
  if (!["chromium", "webkit"].includes(options.engine)) throw Error("Engine must be chromium or webkit");
  return options;
}

function items(options) {
  const out = [], root = path.resolve(options.corpus), filter = options.set ? new RegExp(options.set) : null;
  for (const family of fs.readdirSync(root).sort()) {
    const familyDir = path.join(root, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const set of fs.readdirSync(familyDir).sort()) {
      const setDir = path.join(familyDir, set), key = `${family}/${set}`;
      if (!fs.statSync(setDir).isDirectory() || (filter && !filter.test(key))) continue;
      let n = 0;
      for (const name of fs.readdirSync(setDir).sort()) {
        const ext = path.extname(name).toLowerCase();
        if (!MIME[ext]) continue;
        const target = path.join(setDir, name.slice(0, -ext.length) + ".json");
        if (!fs.existsSync(target)) continue;
        if (options.limit && n >= options.limit) break;
        // No corner truth is an intentional exclusion. Malformed/unreadable
        // targets instead enter the run and produce diagnostic error rows.
        try { if (!JSON.parse(fs.readFileSync(target, "utf8"))?.corners) continue; } catch {}
        n++;
        out.push({ family, set, name, file: path.join(setDir, name), target, mime: MIME[ext] });
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


async function measureDetection(page, item) {
  const target = JSON.parse(fs.readFileSync(item.target, "utf8")), { corners, puzzle } = target;
  if (!Array.isArray(corners) || corners.length !== 4 ||
      !corners.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
      ![puzzle?.rows, puzzle?.cols].every(n => Number.isInteger(n) && n >= 1 && n <= 25))
    throw Error("Invalid detection target: expected four numeric corners and valid rows/columns");
  const r = await page.evaluate(detectOne, { data: fs.readFileSync(item.file).toString("base64"), mime: item.mime,
    corners, rows: puzzle.rows, cols: puzzle.cols, scales: SCALES });
  return { key: `${item.family}/${item.set}`, rows: puzzle.rows, cols: puzzle.cols, at640: r[640], at1600: r[1600] };
}

function summarizeDetection(results) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.family}/${row.set}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const median = values => values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : null;
  return [...groups].sort().flatMap(([set, rows]) => SCALES.map(scale => {
    const ok = rows.filter(r => !r.error).map(r => r[`at${scale}`]), found = ok.filter(r => r.confidence >= .9);
    const quad = ok.filter(r => r.confidence > 0 && r.confidence < .9).length;
    return { set, scale, images: rows.length, failed: rows.length - ok.length,
      good: found.filter(r => r.sizeOk && r.error <= 3).length, found: found.length, quad,
      none: ok.length - found.length - quad, medianCornerError: median(found.map(r => r.error)),
      medianMs: median(ok.map(r => r.ms)) };
  }));
}

function runDetectionBenchmark({ items, options, signal }, dependencies) {
  return runBenchmark({ items, options, signal, output: options.out, base: BASE,
    measure: measureDetection, summarizeResults: summarizeDetection,
    reportMetadata: { benchmark: "grid-detection", formatVersion: 1, scales: SCALES } }, dependencies);
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args), list = items(options);
  if (!list.length) { console.error("no corpus images with corner ground truth under", options.corpus); return 2; }
  console.log(`${list.length} selected images (including invalid targets for diagnosis)`);
  const controller = new AbortController();
  const onInt = () => controller.abort(Error("Detection benchmark interrupted by SIGINT")),
    onTerm = () => controller.abort(Error("Detection benchmark interrupted by SIGTERM"));
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  let report;
  try { report = await runDetectionBenchmark({ items: list, options, signal: controller.signal }); }
  finally { process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm); }
  for (const row of report.summary)
    console.log(`${row.set} at ${row.scale}: ${row.good}/${row.images} good, ${row.found} found, `
      + `${row.quad} quad only, ${row.none} none, ${row.failed} failed; `
      + `median corner error ${row.medianCornerError ?? "-"}%, ${row.medianMs ?? "-"} ms`);
  if (report.failure) console.error(report.failure);
  for (const error of report.cleanupErrors) console.error(error);
  return report.status !== "complete" || report.results.some(row => row.error) ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { items, detectOne, measureDetection, summarizeDetection, runDetectionBenchmark, parseOptions, main };
