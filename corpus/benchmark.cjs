/* Score the production scanner against the local puzzle corpus, reading each
   photograph the way the photo flow does.

   Runs the real detector, OCR and voting in a browser over images selected
   from the corpus, and compares the reading with each image's target file:
   printed clues per cell, and the grid corners where the target has them.
   Nothing from the target reaches recognition unless --true-corners is set.

   As in web/photo-flow.js, the photograph is drawn on white with its long side
   at most 1600 px and read through the corners the detector proposes, however
   confident. When that confidence is 0.8 or less, the flow asks for the
   corners to be set and, read unchanged, highlights every cell, so every cell
   of such a reading counts as flagged. --true-corners reads through the
   target's outline instead, pulled onto the frame where it lies on or past
   the edge, as a user dragging the handles there would.

     node corpus/benchmark.cjs --family sudoku --set wichtounet-newspaper --limit 50
     node corpus/benchmark.cjs --variant photo --engine webkit
     node corpus/benchmark.cjs --family kakuro --true-corners
     node corpus/benchmark.cjs --site ../other/_site --out before.json
     node corpus/benchmark.cjs --list names.txt   (one "set/name" per line)

   Serves --site (default _site), writes --out (default
   browser-artifacts/corpus-benchmark.json) and prints a summary.              */
const fs = require("node:fs");
const { corpusImages, runBenchmark } = require("./benchmark-runner.cjs");
const { score, SCORE_VERSION } = require("./score.cjs");

const BASE = "http://127.0.0.1:8780/";
// photo-flow.js: the photograph's longest side (MAX_SIDE), and the detector
// confidence above which its corners need no confirmation (unconfirmedCorners).
const PHOTO_MAX_SIDE = 1600, CONFIRMED = 0.8;

function parseOptions(args) {
  const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus",
    family: null, set: null, variant: null, list: null, limit: 0, engine: "chromium", trueCorners: false,
    site: "_site", out: "browser-artifacts/corpus-benchmark.json" };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i].replace(/^--/, "");
    if (flag === "true-corners") options.trueCorners = true;
    else if (flag in options) options[flag] = flag === "limit" ? Number(args[++i]) : args[++i];
  }
  return options;
}

function entries(options) {
  const found = [], listed = options.list ? new Set(fs.readFileSync(options.list, "utf8").split(/\r?\n/).filter(Boolean)) : null;
  for (const item of corpusImages(options.corpus)) {
    if (listed && !listed.has(`${item.set}/${item.name}`)) continue;
    if (options.family && item.family !== options.family) continue;
    if (options.set && item.set !== options.set) continue;
    if (options.variant && !item.name.includes(`-${options.variant}.`)) continue;
    found.push(item);
  }
  return options.limit ? found.slice(0, options.limit) : found;
}

// The photo flow's working size for a photograph (photo-flow.js fit()).
function photoSize(width, height) {
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// The corners a reading goes through, in the scaled photograph, and whether
// the photo flow would hold them unconfirmed.
function readingCorners({ detection, truth, size, trueCorners }) {
  if (trueCorners && truth)
    return { unconfirmed: false, corners: truth.map(([x, y]) => ({
      x: Math.min(size.width - 1, Math.max(0, x * size.scale)),
      y: Math.min(size.height - 1, Math.max(0, y * size.scale)) })) };
  return { unconfirmed: !(detection.confidence > CONFIRMED), corners: detection.corners };
}

// A reading through unconfirmed corners has every cell highlighted.
function photoFlowReview(reading, unconfirmed) {
  if (!unconfirmed) return reading;
  return { ...reading, uncertain: [...new Set([...(reading.uncertain || []), ...reading.read.cells.keys()])] };
}

// In the page, in three steps so that the corners are chosen in Node: decode,
// draw at the photo flow's size and detect, read.
async function decodeImage({ data, mime }) {
  const image = new Image();
  image.src = `data:${mime};base64,${data}`;
  await image.decode();
  window.benchImage = image;
  return { width: image.naturalWidth, height: image.naturalHeight };
}
async function detectGrid({ width, height }) {
  const { Scanner } = await import("./scanner.js");
  window.benchScanner ??= new Scanner();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.drawImage(window.benchImage, 0, 0, width, height);
  window.benchCanvas = canvas;
  const started = performance.now();
  try {
    const found = await window.benchScanner.detect(canvas);
    return { detected: performance.now() - started,
      detection: { corners: found.corners, confidence: found.confidence, rows: found.rows, cols: found.cols } };
  } catch (error) { return { error: `detect: ${error.message}` }; }
}
async function readGrid({ corners, type, rows, cols }) {
  const started = performance.now();
  try {
    const result = await window.benchScanner.read(window.benchCanvas, corners, type, rows, cols);
    return { ms: performance.now() - started,
      read: { cells: result.puzzle.cells, cages: result.puzzle.cages || [],
        clues: result.puzzle.clues || [], inequalities: result.puzzle.inequalities || [],
        black: result.puzzle.black || [] },
      uncertain: result.uncertain, cageUncertain: result.cageUncertain || [],
      ocr: result.timings ? Math.round(result.timings.ocr) : null };
  } catch (error) { return { error: `read: ${error.message}` }; }
}

async function measure(page, item, options) {
  const target = JSON.parse(fs.readFileSync(item.target, "utf8")), { puzzle } = target;
  const natural = await page.evaluate(decodeImage, { data: fs.readFileSync(item.file).toString("base64"), mime: item.mime });
  const size = photoSize(natural.width, natural.height), found = await page.evaluate(detectGrid, size);
  if (found.error) return { error: found.error };
  const { detection } = found,
    { corners, unconfirmed } = readingCorners({ detection, truth: target.corners, size, trueCorners: options.trueCorners });
  const reading = await page.evaluate(readGrid, { corners, type: puzzle.type, rows: puzzle.rows, cols: puzzle.cols });
  const row = { confidence: detection.confidence, grid: detection.confidence > CONFIRMED, unconfirmed,
    width: size.width, height: size.height, detected: Math.round(found.detected),
    total: Math.round(found.detected + (reading.ms || 0)) };
  if (reading.error) return { ...row, error: reading.error };
  // Corner error is scored for a found grid, in the target's own pixels.
  const reported = row.grid ? detection.corners.map((p) => [p.x / size.scale, p.y / size.scale]) : null;
  return { ...row, ocr: reading.ocr, ...score(target, photoFlowReview({ ...reading, corners: reported }, unconfirmed)) };
}

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args), items = entries(options);
  if (!items.length) { console.error("no matching images under", options.corpus); return 2; }
  if (!["chromium", "webkit"].includes(options.engine)) throw Error("Engine must be chromium or webkit");
  console.log(`${items.length} images from ${options.corpus}`);
  const controller = new AbortController();
  const interrupt = name => controller.abort(Error(`Benchmark interrupted by ${name}`));
  const onInt = () => interrupt("SIGINT"), onTerm = () => interrupt("SIGTERM");
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  let report;
  try {
    report = await runBenchmark({ items, options, base: BASE, signal: controller.signal, output: options.out,
      measure: (page, item) => measure(page, item, options),
      reportMetadata: { scoreVersion: SCORE_VERSION, harness: { maxSide: PHOTO_MAX_SIDE, confirmedAbove: CONFIRMED,
        corners: options.trueCorners ? "target, pulled onto the frame" : "detector, any confidence" } } });
  } finally { process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm); }
  for (const row of report.summary) {
    console.log(`${row.set}: ${row.correct}/${row.printed} clues, ${row.unsafe} unflagged, `
      + `${row.topologyWrong} topology errors, ${row.perfect}/${row.images} perfect, `
      + `grid found ${row.gridFound}/${row.images} (${row.unconfirmed} read through unconfirmed corners), `
      + `flags on ${row.flaggedCorrect} correct clues and ${row.flaggedEmpty}/${row.emptyCells} empty cells, `
      + `corner error ${row.medianCornerError ?? "-"}%, ${row.medianMs} ms`);
  }
  if (report.failure) console.error(report.failure);
  for (const error of report.cleanupErrors) console.error(error);
  return report.status !== "complete" || report.results.some(row => row.error) ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseOptions, entries, photoSize, readingCorners, photoFlowReview, measure, main };
