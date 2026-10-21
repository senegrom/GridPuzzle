/* Detection-only measurement at the live camera's size (640) and the photo
   flow's (1600), both through findGrid's default, the still photograph's path
   (thorough). --live adds the live camera's own detection as a third
   measurement, `live`: the quick path (thorough: false) on the same 640-pixel
   drawing, the size and path web/live-camera.js detects with.
   Uses the same checkpoint/cleanup lifecycle as the OCR benchmark.
   node corpus/detect_benchmark.cjs [--site _site] [--limit N] [--set names] [--live] [--out file.json]
   --set takes one name or a comma-separated list; each matches any set whose
   "family/set" key contains it, for example --set lexski,newspaper
   Reports use the versioned envelope documented in web/TESTING.md ("Puzzle
   image corpus and benchmarks"). */
const fs = require("node:fs");
const { corpusImages, runBenchmark } = require("./benchmark-runner.cjs");
const BASE = "http://127.0.0.1:8782/";
const SCALES = [640, 1600];
// live-camera.js locate(): a copy of the frame at most 640 pixels on its long
// side, detected with { thorough: false }.
const LIVE = Object.freeze({ scale: 640, thorough: false });

function parseOptions(args) {
  const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus",
    site: "_site", limit: 0, set: null, out: "browser-artifacts/detect-benchmark.json", engine: "chromium", live: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !Object.hasOwn(options, flag)) throw Error(`Unknown option: ${args[i]}`);
    if (flag === "live") { options.live = true; continue; } // the one flag without a value
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`Missing value for --${flag}`);
    options[flag] = flag === "limit" ? Number(value) : value;
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 0) throw Error("Limit must be a nonnegative whole number");
  if (!["chromium", "webkit"].includes(options.engine)) throw Error("Engine must be chromium or webkit");
  return options;
}

function items(options) {
  // Names, not a pattern: the filter is a comma-separated list and each part
  // matches a set whose "family/set" key contains it. A regular expression
  // built from the command line buys nothing here and can be made to run for
  // a very long time on a long key. The limit is per set.
  const out = [], taken = new Map(),
    wanted = options.set ? options.set.split(",").map((part) => part.trim()).filter(Boolean) : null;
  for (const item of corpusImages(options.corpus)) {
    const key = `${item.family}/${item.set}`;
    if (wanted && !wanted.some((part) => key.includes(part))) continue;
    if (options.limit && (taken.get(key) || 0) >= options.limit) continue;
    // No corner truth is an intentional exclusion. Malformed/unreadable
    // targets instead enter the run and produce diagnostic error rows.
    try { if (!JSON.parse(fs.readFileSync(item.target, "utf8"))?.corners) continue; } catch {}
    taken.set(key, (taken.get(key) || 0) + 1);
    out.push(item);
  }
  return out;
}

// Runs in the page. One measurement per scale through findGrid's default and,
// given `live`, one more the live camera's way, keyed "live".
async function detectOne({ data, mime, corners, rows, cols, scales, live = null }) {
  const { findGrid } = await import("./geometry.js");
  const img = new Image();
  img.src = `data:${mime};base64,${data}`;
  await img.decode();
  const measure = (max, options) => {
    const s = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * s), h = Math.round(img.height * s);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h), started = performance.now(), found = findGrid(image, options), ms = performance.now() - started;
    const truth = corners.map(([x, y]) => ({ x: x * s, y: y * s }));
    const diagonal = Math.hypot(truth[2].x - truth[0].x, truth[2].y - truth[0].y) || 1;
    // Corner error against the best cyclic labelling of the same quad.
    let error = Infinity;
    for (let k = 0; k < 4; k++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) { const p = found.corners[(i + k) % 4]; sum += Math.hypot(p.x - truth[i].x, p.y - truth[i].y); }
      error = Math.min(error, sum / 4);
    }
    return { ms: Math.round(ms), confidence: found.confidence, rows: found.rows, cols: found.cols, boxes: found.boxes,
      error: +(100 * error / diagonal).toFixed(1), sizeOk: found.rows === rows && found.cols === cols };
  };
  const out = {};
  for (const max of scales) out[max] = measure(max);
  if (live) out.live = measure(live.scale, { thorough: live.thorough });
  return out;
}


async function measureDetection(page, item, { live = false } = {}) {
  const target = JSON.parse(fs.readFileSync(item.target, "utf8")), { corners, puzzle } = target;
  if (!Array.isArray(corners) || corners.length !== 4 ||
      !corners.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
      ![puzzle?.rows, puzzle?.cols].every(n => Number.isInteger(n) && n >= 1 && n <= 25))
    throw Error("Invalid detection target: expected four numeric corners and valid rows/columns");
  const r = await page.evaluate(detectOne, { data: fs.readFileSync(item.file).toString("base64"), mime: item.mime,
    corners, rows: puzzle.rows, cols: puzzle.cols, scales: SCALES, ...(live ? { live: LIVE } : {}) });
  return { key: `${item.family}/${item.set}`, rows: puzzle.rows, cols: puzzle.cols, at640: r[640], at1600: r[1600],
    ...(live ? { live: r.live } : {}) };
}

// One summary row per set and scale; with `live`, one more per set for the
// live camera's measurement, which says thorough: false.
function summarizeDetection(results, { live = false } = {}) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.family}/${row.set}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const median = values => values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : null;
  const columns = [...SCALES.map(scale => ({ scale, field: `at${scale}` })),
    ...(live ? [{ scale: LIVE.scale, field: "live", path: { thorough: LIVE.thorough } }] : [])];
  return [...groups].sort().flatMap(([set, rows]) => columns.map(({ scale, field, path }) => {
    const ok = rows.filter(r => !r.error).map(r => r[field]), found = ok.filter(r => r.confidence >= .9);
    const quad = ok.filter(r => r.confidence > 0 && r.confidence < .9).length;
    return { set, scale, ...path, images: rows.length, failed: rows.length - ok.length,
      good: found.filter(r => r.sizeOk && r.error <= 3).length, found: found.length, quad,
      none: ok.length - found.length - quad, medianCornerError: median(found.map(r => r.error)),
      medianMs: median(ok.map(r => r.ms)) };
  }));
}

function runDetectionBenchmark({ items, options, signal }, dependencies) {
  const live = options.live === true;
  return runBenchmark({ items, options, signal, output: options.out, base: BASE,
    measure: (page, item) => measureDetection(page, item, { live }),
    summarizeResults: results => summarizeDetection(results, { live }),
    reportMetadata: { benchmark: "grid-detection", formatVersion: 1, scales: SCALES, ...(live ? { live: LIVE } : {}) } }, dependencies);
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args), list = items(options);
  if (!list.length) { console.error("no corpus images with corner ground truth under", options.corpus); return 2; }
  console.log(`${list.length} selected images (including invalid targets for diagnosis)`
    + (options.live ? `; the live camera's detection (thorough: false at ${LIVE.scale}) too` : ""));
  const controller = new AbortController();
  const onInt = () => controller.abort(Error("Detection benchmark interrupted by SIGINT")),
    onTerm = () => controller.abort(Error("Detection benchmark interrupted by SIGTERM"));
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  let report;
  try { report = await runDetectionBenchmark({ items: list, options, signal: controller.signal }); }
  finally { process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm); }
  for (const row of report.summary)
    console.log(`${row.set} ${row.thorough === false ? "live " : ""}at ${row.scale}: ${row.good}/${row.images} good, ${row.found} found, `
      + `${row.quad} quad only, ${row.none} none, ${row.failed} failed; `
      + `median corner error ${row.medianCornerError ?? "-"}%, ${row.medianMs ?? "-"} ms`);
  if (report.failure) console.error(report.failure);
  for (const error of report.cleanupErrors) console.error(error);
  return report.status !== "complete" || report.results.some(row => row.error) ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { items, detectOne, measureDetection, summarizeDetection, runDetectionBenchmark, parseOptions, main, LIVE };
