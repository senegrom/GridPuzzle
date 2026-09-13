/* Score the production scanner against the local puzzle corpus.

   Runs the real detector, OCR and voting in a browser over images selected
   from the corpus, and compares the reading with each image's target file:
   printed clues per cell, and the grid corners where the target has them.
   Nothing from the target reaches recognition.

     node corpus/benchmark.cjs --family sudoku --set wichtounet-newspaper --limit 50
     node corpus/benchmark.cjs --variant photo --engine webkit
     node corpus/benchmark.cjs --family kakuro --true-corners

   Writes browser-artifacts/corpus-benchmark.json and prints a summary.        */
const { chromium, webkit } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const options = { corpus: process.env.PUZZLE_CORPUS || "E:/OneDrive/Coding/PuzzleCorpus",
  family: null, set: null, variant: null, limit: 0, engine: "chromium", trueCorners: false };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i].replace(/^--/, "");
  if (flag === "true-corners") options.trueCorners = true;
  else if (flag in options) options[flag] = /^(limit)$/.test(flag) ? Number(process.argv[++i]) : process.argv[++i];
}
const BASE = "http://127.0.0.1:8780/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function entries() {
  const found = [];
  const root = path.resolve(options.corpus);
  for (const family of fs.readdirSync(root)) {
    if (options.family && family !== options.family) continue;
    const familyDir = path.join(root, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const set of fs.readdirSync(familyDir)) {
      if (options.set && set !== options.set) continue;
      const setDir = path.join(familyDir, set);
      if (!fs.statSync(setDir).isDirectory()) continue;
      for (const name of fs.readdirSync(setDir).sort()) {
        const ext = path.extname(name).toLowerCase();
        if (!MIME[ext]) continue;
        if (options.variant && !name.includes(`-${options.variant}.`)) continue;
        const target = path.join(setDir, name.slice(0, -ext.length) + ".json");
        if (!fs.existsSync(target)) continue;
        found.push({ family, set, name, file: path.join(setDir, name), target, mime: MIME[ext] });
      }
    }
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
        clues: result.puzzle.clues || [], inequalities: result.puzzle.inequalities || [] },
      uncertain: result.uncertain, cageUncertain: result.cageUncertain || [],
      corners: found ? found.map((p) => [p.x, p.y]) : null,
      ocr: result.timings ? Math.round(result.timings.ocr) : null };
  } catch (error) {
    return { detected, error: `read: ${error.message}`, confidence: detection?.confidence ?? null };
  }
}

function score(target, reading) {
  const truth = target.puzzle.cells, read = reading.read.cells;
  const flagged = new Set(reading.uncertain || []);
  const structural = new Set(reading.cageUncertain || []);
  const result = { printed: 0, correct: 0, wrong: 0, missed: 0, invented: 0, unsafe: 0 };
  // Families print their clues outside the cells: Kakuro sums in the black
  // corners, cage targets in Killer and KenKen, signs between Futoshiki cells.
  // Each of those is scored as one printed item too.
  const pair = (list) => new Map(list.map((item) => [JSON.stringify(item.cells ?? item.cell), item]));
  const compare = (wanted, got, same, cells) => {
    const mine = pair(got);
    for (const [key, item] of pair(wanted)) {
      result.printed++;
      const found = mine.get(key);
      if (found && same(item, found)) { result.correct++; continue; }
      if (!found) result.missed++; else result.wrong++;
      const touched = cells(item);
      if (!touched.some((cell) => flagged.has(cell) || structural.has(cell))) result.unsafe++;
    }
    for (const [key, item] of mine) {
      if (pair(wanted).has(key)) continue;
      result.invented++;
      const touched = cells(item);
      if (!touched.some((cell) => flagged.has(cell) || structural.has(cell))) result.unsafe++;
    }
  };
  const kind = target.puzzle.type;
  if (kind === "kakuro") {
    compare(target.puzzle.clues || [], reading.read.clues,
      (a, b) => (a.across ?? null) === (b.across ?? null) && (a.down ?? null) === (b.down ?? null),
      (item) => [item.cell]);
  } else if (kind === "killersudoku" || kind === "kenken") {
    compare(target.puzzle.cages || [], reading.read.cages,
      (a, b) => a.target === b.target && (a.op || "+") === (b.op || "+"), (item) => item.cells);
  } else if (kind === "futoshiki") {
    compare(target.puzzle.inequalities || [], reading.read.inequalities,
      () => true, (item) => [item.less, item.greater]);
  }
  truth.forEach((value, cell) => {
    const got = read[cell];
    if (Number.isInteger(value)) {
      result.printed++;
      if (got === value) { result.correct++; return; }
      if (got === null || got === undefined) result.missed++; else result.wrong++;
      if (!flagged.has(cell)) result.unsafe++;
      return;
    }
    if (value === "#") return;                      // structural cell, not a printed number
    if (Number.isInteger(got)) {
      result.invented++;
      if (!flagged.has(cell)) result.unsafe++;
    }
  });
  if (target.corners && reading.corners) {
    const size = Math.hypot(target.corners[2][0] - target.corners[0][0],
      target.corners[2][1] - target.corners[0][1]) || 1;
    const distance = target.corners.reduce((sum, [x, y], index) =>
      sum + Math.hypot(x - reading.corners[index][0], y - reading.corners[index][1]), 0) / 4;
    result.cornerError = Math.round((distance / size) * 1000) / 10;   // percent of the grid diagonal
  }
  return result;
}

(async () => {
  const items = entries();
  if (!items.length) { console.error("no matching images under", options.corpus); process.exit(2); }
  console.log(`${items.length} images from ${options.corpus}`);
  fs.mkdirSync("browser-artifacts", { recursive: true });
  const server = spawn("python", ["-m", "http.server", "8780", "--bind", "127.0.0.1", "--directory", "_site"],
    { stdio: "ignore" });
  const results = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(100); }
    const browser = await (options.engine === "webkit" ? webkit : chromium).launch({ headless: true });
    const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
    page.setDefaultTimeout(180000);
    await page.goto(BASE);
    await page.waitForSelector('body[data-ready="true"]');
    for (const [index, item] of items.entries()) {
      const target = JSON.parse(fs.readFileSync(item.target, "utf8"));
      const reading = await page.evaluate(scan, { data: fs.readFileSync(item.file).toString("base64"),
        mime: item.mime, puzzle: target.puzzle, corners: target.corners || null, useTrue: options.trueCorners });
      const row = { family: item.family, set: item.set, name: item.name,
        confidence: reading.confidence, grid: reading.grid, total: Math.round(reading.total || 0),
        detected: Math.round(reading.detected || 0), error: reading.error };
      if (!reading.error) Object.assign(row, score(target, reading));
      results.push(row);
      if ((index + 1) % 25 === 0 || index === items.length - 1) console.log(`  ${index + 1}/${items.length}`);
    }
    await page.evaluate(() => window.benchScanner?.cancel());
    await browser.close();
  } finally { server.kill(); }

  const groups = new Map();
  for (const row of results) {
    const key = `${row.family}/${row.set}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const summary = [];
  for (const [key, rows] of [...groups].sort()) {
    const ok = rows.filter((r) => !r.error);
    const sum = (field) => ok.reduce((n, r) => n + (r[field] || 0), 0);
    const corner = ok.filter((r) => r.cornerError !== undefined).map((r) => r.cornerError).sort((a, b) => a - b);
    summary.push({ set: key, images: rows.length, failed: rows.length - ok.length,
      gridFound: ok.filter((r) => r.grid).length,
      printed: sum("printed"), correct: sum("correct"), wrong: sum("wrong"), missed: sum("missed"),
      invented: sum("invented"), unsafe: sum("unsafe"),
      perfect: ok.filter((r) => r.printed && r.correct === r.printed && !r.invented).length,
      medianCornerError: corner.length ? corner[Math.floor(corner.length / 2)] : null,
      medianMs: ok.length ? ok.map((r) => r.total).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null });
  }
  fs.writeFileSync("browser-artifacts/corpus-benchmark.json",
    JSON.stringify({ options, summary, results }, null, 1) + "\n");
  for (const row of summary) {
    console.log(`${row.set}: ${row.correct}/${row.printed} clues, ${row.unsafe} unflagged, `
      + `${row.perfect}/${row.images} perfect, grid found ${row.gridFound}/${row.images}, `
      + `corner error ${row.medianCornerError ?? "-"}%, ${row.medianMs} ms`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
