/* Benchmark the production scanner on a directory of Sudoku photographs with
   ground truth: <name>.jpg (or .png/.webp) next to <name>.dat whose last nine
   lines hold the grid (0 = empty), the layout of wichtounet/sudoku_dataset
   (CC BY 4.0). Detection, OCR and voting are the real browser pipeline on one
   warm Scanner; nothing is fed back from the truth. Usage:
     node scripts/sudoku_dataset_benchmark.cjs <dataset dir> [limit] [chromium|webkit]
   Writes browser-artifacts/sudoku-dataset-benchmark.json and prints a summary. */
const { chromium, webkit } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const [, , directory, limitArg = "0", engineName = "chromium"] = process.argv;
if (!directory) { console.error("usage: node scripts/sudoku_dataset_benchmark.cjs <dataset dir> [limit] [chromium|webkit]"); process.exit(2); }
const limit = Number(limitArg) || Infinity;
const BASE = "http://127.0.0.1:8779/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function truthOf(datFile) {
  const lines = fs.readFileSync(datFile, "utf8").trim().split(/\r?\n/);
  const rows = lines.slice(-9).map((line) => line.trim().split(/\s+/).map(Number));
  if (rows.length !== 9 || rows.some((row) => row.length !== 9 || row.some((n) => !Number.isInteger(n) || n < 0 || n > 9))) return null;
  return { device: lines[0] || "", cells: rows.flat().map((n) => n || null) };
}
function fixtures(dir) {
  const items = [];
  for (const file of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const dat = path.join(dir, file.replace(/\.[^.]+$/, ".dat"));
    if (!fs.existsSync(dat)) continue;
    const truth = truthOf(dat);
    if (!truth) continue;
    const ext = path.extname(file).toLowerCase(), mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    items.push({ name: file, ...truth, data: `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString("base64")}` });
    if (items.length >= limit) break;
  }
  return items;
}
async function scanOne(page, fixture) {
  return page.evaluate(async (fixture) => {
    const { Scanner } = await import("./scanner.js");
    window.benchScanner ??= new Scanner();
    const scanner = window.benchScanner;
    const image = new Image(); image.src = fixture.data; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const started = performance.now();
    let detection = null;
    try { detection = await scanner.detect(canvas); } catch (error) { return { name: fixture.name, error: `detect: ${error.message}` }; }
    const detected = performance.now() - started;
    const corners = detection?.confidence >= 0.5 && detection.corners
      ? detection.corners
      : [{ x: 0, y: 0 }, { x: canvas.width - 1, y: 0 }, { x: canvas.width - 1, y: canvas.height - 1 }, { x: 0, y: canvas.height - 1 }];
    try {
      const result = await scanner.read(canvas, corners, "sudoku", 9, 9);
      const total = performance.now() - started, flagged = new Set(result.uncertain);
      let correct = 0, missed = 0, wrong = 0, invented = 0, unsafe = 0;
      fixture.cells.forEach((truth, cell) => {
        const read = result.puzzle.cells[cell];
        if (truth === null) { if (read !== null) { invented++; if (!flagged.has(cell)) unsafe++; } return; }
        if (read === truth) correct++;
        else { if (read === null) missed++; else wrong++; if (!flagged.has(cell)) unsafe++; }
      });
      return { name: fixture.name, device: fixture.device, detected: Math.round(detected), total: Math.round(total),
        ocr: result.timings ? Math.round(result.timings.ocr) : null, confidence: detection?.confidence ?? null,
        printed: fixture.cells.filter(Number.isInteger).length, correct, missed, wrong, invented, unsafe,
        flagged: flagged.size, retries: result.retryCount || 0 };
    } catch (error) { return { name: fixture.name, device: fixture.device, detected: Math.round(detected), error: `read: ${error.message}` }; }
  }, fixture);
}
async function run() {
  const items = fixtures(directory);
  if (!items.length) { console.error("no <image>.jpg + <image>.dat pairs found in", directory); process.exit(2); }
  fs.mkdirSync("browser-artifacts", { recursive: true });
  const server = spawn("python", ["-m", "http.server", "8779", "--bind", "127.0.0.1", "--directory", "_site"], { stdio: "ignore" });
  const results = [];
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) { ready = true; break; } } catch {} await sleep(100); }
    if (!ready) throw Error("static server did not start");
    const browser = await (engineName === "webkit" ? webkit : chromium).launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage(); page.setDefaultTimeout(180000);
      await page.goto(BASE); await page.waitForSelector('body[data-ready="true"]');
      for (const [index, fixture] of items.entries()) {
        const scan = await scanOne(page, fixture);
        results.push(scan);
        if (scan.error) console.log(`${index + 1}/${items.length} ${scan.name}: ${scan.error}`);
        else console.log(`${index + 1}/${items.length} ${scan.name}: ${scan.correct}/${scan.printed} correct, ${scan.wrong} wrong, ${scan.missed} missed, ${scan.invented} invented, ${scan.unsafe} unflagged, ${scan.total} ms`);
      }
      await page.evaluate(() => window.benchScanner?.cancel());
    } finally { await browser.close(); }
  } finally { server.kill(); }
  const ok = results.filter((r) => !r.error), median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const sum = (key) => ok.reduce((n, r) => n + r[key], 0);
  const summary = {
    engine: engineName, images: results.length, failed: results.length - ok.length,
    printedClues: sum("printed"), correct: sum("correct"), wrong: sum("wrong"), missed: sum("missed"), invented: sum("invented"), unsafe: sum("unsafe"),
    perfectImages: ok.filter((r) => r.correct === r.printed && !r.invented).length,
    cleanImages: ok.filter((r) => r.unsafe === 0).length,
    medianTotalMs: median(ok.map((r) => r.total)), medianOcrMs: median(ok.filter((r) => r.ocr !== null).map((r) => r.ocr)),
    firstReadMs: ok[0]?.total ?? null, medianDetectMs: median(ok.map((r) => r.detected)),
  };
  fs.writeFileSync("browser-artifacts/sudoku-dataset-benchmark.json", JSON.stringify({ summary, results }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
