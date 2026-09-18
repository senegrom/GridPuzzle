/* Score the production scanner against the local puzzle corpus.

   Runs the real detector, OCR and voting in a browser over images selected
   from the corpus, and compares the reading with each image's target file:
   printed clues per cell, and the grid corners where the target has them.
   Nothing from the target reaches recognition.

     node corpus/benchmark.cjs --family sudoku --set wichtounet-newspaper --limit 50
     node corpus/benchmark.cjs --variant photo --engine webkit
     node corpus/benchmark.cjs --family kakuro --true-corners

   Writes browser-artifacts/corpus-benchmark.json and prints a summary.        */
const { corpusImages, runBenchmark } = require("./benchmark-runner.cjs");

const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus",
  family: null, set: null, variant: null, limit: 0, engine: "chromium", trueCorners: false };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i].replace(/^--/, "");
  if (flag === "true-corners") options.trueCorners = true;
  else if (flag in options) options[flag] = /^(limit)$/.test(flag) ? Number(process.argv[++i]) : process.argv[++i];
}
const BASE = "http://127.0.0.1:8780/";

function entries() {
  const found = [];
  for (const item of corpusImages(options.corpus)) {
    if (options.family && item.family !== options.family) continue;
    if (options.set && item.set !== options.set) continue;
    if (options.variant && !item.name.includes(`-${options.variant}.`)) continue;
    found.push(item);
  }
  return options.limit ? found.slice(0, options.limit) : found;
}

// Runs in the page: the production Scanner, one warm instance for the whole run.
async function scan({ data, mime, puzzle, corners, useTrue }) {
  const { Scanner } = await import("./scanner.js");
  window.benchScanner ??= new Scanner();
  const scanner = window.benchScanner;
  const image = new Image();
  image.src = `data:${mime};base64,${data}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  const started = performance.now();
  let detection = null;
  try { detection = await scanner.detect(canvas); } catch (error) { return { error: `detect: ${error.message}` }; }
  const detected = performance.now() - started;
  const frame = [{ x: 0, y: 0 }, { x: canvas.width - 1, y: 0 },
    { x: canvas.width - 1, y: canvas.height - 1 }, { x: 0, y: canvas.height - 1 }];
  const found = detection?.confidence >= 0.5 && detection.corners ? detection.corners : null;
  const used = useTrue && corners ? corners.map(([x, y]) => ({ x, y })) : (found ?? frame);
  try {
    const result = await scanner.read(canvas, used, puzzle.type, puzzle.rows, puzzle.cols);
    return { detected, total: performance.now() - started, confidence: detection?.confidence ?? null,
      grid: Boolean(found), fell_back: !found && !useTrue,
      read: { cells: result.puzzle.cells, cages: result.puzzle.cages || [],
        clues: result.puzzle.clues || [], inequalities: result.puzzle.inequalities || [],
        black: result.puzzle.black || [] },
      uncertain: result.uncertain, cageUncertain: result.cageUncertain || [],
      corners: found ? found.map((p) => [p.x, p.y]) : null,
      ocr: result.timings ? Math.round(result.timings.ocr) : null };
  } catch (error) {
    return { detected, error: `read: ${error.message}`, confidence: detection?.confidence ?? null };
  }
}


async function main() {
  const items = entries();
  if (!items.length) { console.error("no matching images under", options.corpus); return 2; }
  if (!["chromium", "webkit"].includes(options.engine)) throw Error("Engine must be chromium or webkit");
  console.log(`${items.length} images from ${options.corpus}`);
  const controller = new AbortController();
  const interrupt = name => controller.abort(Error(`Benchmark interrupted by ${name}`));
  const onInt = () => interrupt("SIGINT"), onTerm = () => interrupt("SIGTERM");
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  let report;
  try { report = await runBenchmark({ items, options, scan, base: BASE, signal: controller.signal }); }
  finally { process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm); }
  for (const row of report.summary) {
    console.log(`${row.set}: ${row.correct}/${row.printed} clues, ${row.unsafe} unflagged, `
      + `${row.topologyWrong} topology errors, ${row.perfect}/${row.images} perfect, grid found ${row.gridFound}/${row.images}, `
      + `corner error ${row.medianCornerError ?? "-"}%, ${row.medianMs} ms`);
  }
  if (report.failure) console.error(report.failure);
  for (const error of report.cleanupErrors) console.error(error);
  return report.status !== "complete" || report.results.some(row => row.error) ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; })
  .catch(error => { console.error(error); process.exitCode = 1; });
