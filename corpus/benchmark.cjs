/* Score the production scanner against the local puzzle corpus, reading each
   photograph the way the photo flow does.

   Runs the real detector, OCR and voting in a browser over images selected
   from the corpus, and compares the reading with each image's target file:
   printed clues per cell, and the grid corners where the target has them.
   The reference type and row/column counts configure recognition, so this is
   not an automatic family/size benchmark. Reference clue values stay in the
   scorer; reference corners are supplied only with --true-corners.

   As in web/photo-flow.js, the photograph is decoded to a preview on white with
   its long side at most 1600 px, the grid is detected on that preview, and it is
   read through the corners the detector proposes, however confident, and
   through photoDetail: a larger original's grid region at up to 1800 px. When that confidence is 0.8 or less, the flow asks for the
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
const { runBenchmark, selectImages, photoFlowMeasure, photoFlowMetadata } = require("./benchmark-runner.cjs");

const BASE = "http://127.0.0.1:8780/";
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

async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args), items = selectImages(options);
  if (!items.length) { console.error("no matching images under", options.corpus); return 2; }
  if (!["chromium", "webkit"].includes(options.engine)) throw Error("Engine must be chromium or webkit");
  console.log(`${items.length} images from ${options.corpus}`);
  console.log(`Recognition uses reference type and dimensions; ${options.trueCorners ? "reference corners where available" : "detector proposals"}. Not fully automatic.`);
  const controller = new AbortController();
  const interrupt = name => controller.abort(Error(`Benchmark interrupted by ${name}`));
  const onInt = () => interrupt("SIGINT"), onTerm = () => interrupt("SIGTERM");
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  let report;
  try {
    report = await runBenchmark({ items, options, base: BASE, signal: controller.signal, output: options.out,
      measure: (page, item) => photoFlowMeasure(page, item, options),
      reportMetadata: photoFlowMetadata(options) });
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
module.exports = { parseOptions, main };
