/* Testable benchmark lifecycle. A report is checkpointed before startup, after
   each image and after cleanup; it remains useful when a later image fails. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { score, isPerfect, SCORE_VERSION } = require("./score.cjs");
const message = error => error?.message || String(error);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/* Every image with a target file under a corpus root, families, sets and
   names in sorted order: { family, set, name, file, target, mime }. */
function* corpusImages(root) {
  root = path.resolve(root);
  for (const family of fs.readdirSync(root).sort()) {
    const familyDir = path.join(root, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const set of fs.readdirSync(familyDir).sort()) {
      const setDir = path.join(familyDir, set);
      if (!fs.statSync(setDir).isDirectory()) continue;
      for (const name of fs.readdirSync(setDir).sort()) {
        const ext = path.extname(name).toLowerCase();
        if (!MIME[ext]) continue;
        const target = path.join(setDir, name.slice(0, -ext.length) + ".json");
        if (fs.existsSync(target)) yield { family, set, name, file: path.join(setDir, name), target, mime: MIME[ext] };
      }
    }
  }
}

function summarize(results) {
  const groups = new Map();
  for (const row of results) {
    const key = `${row.family}/${row.set}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].sort().map(([key, rows]) => {
    const ok = rows.filter(r => !r.error);
    const sum = field => ok.reduce((n, r) => n + (r[field] || 0), 0);
    const median = values => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
    return { set: key, images: rows.length, failed: rows.length - ok.length,
      gridFound: ok.filter(r => r.grid).length, unconfirmed: ok.filter(r => r.unconfirmed).length,
      printed: sum("printed"), correct: sum("correct"), wrong: sum("wrong"), missed: sum("missed"),
      invented: sum("invented"), unsafe: sum("unsafe"), topologyWrong: sum("topologyWrong"),
      topologyUnsafe: sum("topologyUnsafe"), shapeErrors: sum("shapeErrors"), perfect: ok.filter(isPerfect).length,
      flaggedCorrect: sum("flaggedCorrect"), emptyCells: sum("emptyCells"), flaggedEmpty: sum("flaggedEmpty"),
      medianCornerError: median(ok.filter(r => r.cornerError !== undefined).map(r => r.cornerError)),
      medianMs: median(ok.map(r => r.total)) };
  });
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(report, null, 1) + "\n");
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

async function abortable(promise, signal) {
  if (!signal) return promise;
  let stop;
  const interrupted = new Promise((_, reject) => {
    stop = () => reject(signal.reason || Error("Benchmark interrupted"));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener("abort", stop); }
}

async function waitForServer(base, getError) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (getError()) throw getError();
    // HEAD: a response body left unread makes Node 24 assert when the timeout
    // signal fires, and readiness needs only the status.
    try { if ((await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await sleep(100);
  }
  throw Error("Benchmark HTTP server did not become ready");
}

async function runBenchmark({ items, options, scan, output = "browser-artifacts/corpus-benchmark.json",
  base = "http://127.0.0.1:8780/", signal, measure,
  summarizeResults = summarize, reportMetadata = { scoreVersion: SCORE_VERSION } }, dependencies = {}) {
  const launch = dependencies.launch || (() => require("playwright")[options.engine].launch({ headless: true }));
  const startServer = dependencies.startServer || (() => spawn("python",
    ["-m", "http.server", new URL(base).port || "80", "--bind", "127.0.0.1", "--directory", options.site || "_site"], { stdio: "ignore" }));
  const wait = dependencies.waitForServer || waitForServer;
  const persist = dependencies.writeReport || writeReport;
  const log = dependencies.log || console.log;
  // Both OCR and detection-only measurements use this lifecycle. The callback
  // returns a row without mutating results, so an aborted read cannot append
  // late data after the final report has been saved.
  const measureItem = measure || (async (page, item) => {
    const target = JSON.parse(fs.readFileSync(item.target, "utf8"));
    const reading = await page.evaluate(scan, { data: fs.readFileSync(item.file).toString("base64"),
      mime: item.mime, puzzle: target.puzzle, corners: target.corners || null, useTrue: options.trueCorners });
    return { confidence: reading.confidence, grid: reading.grid,
      total: Math.round(reading.total || 0), detected: Math.round(reading.detected || 0), error: reading.error,
      ...(!reading.error ? score(target, reading) : {}) };
  });
  const results = [], cleanupErrors = [];
  let browser, context, server, serverError, failure = null, closing = false, status = "running";
  const report = () => ({ ...reportMetadata, options, status, totalImages: items.length,
    completedImages: results.length, failure, cleanupErrors, summary: summarizeResults(results), results });
  // If output cannot be opened, fail before allocating any browser/server.
  persist(output, report());
  try {
    signal?.throwIfAborted();
    server = startServer();
    server.on("error", error => { serverError = error; });
    server.on("exit", (code, reason) => {
      if (!closing) serverError = Error(`Benchmark HTTP server exited: ${code ?? reason}`);
    });
    await abortable(wait(base, () => serverError), signal);
    if (serverError) throw serverError;
    browser = await launch();
    context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    await abortable(page.goto(base), signal);
    await abortable(page.waitForSelector('body[data-ready="true"]'), signal);
    for (const [index, item] of items.entries()) {
      signal?.throwIfAborted();
      if (serverError) throw serverError;
      const row = { family: item.family, set: item.set, name: item.name };
      let itemError;
      try {
        Object.assign(row, await abortable(measureItem(page, item), signal));
      } catch (error) { row.error = message(error); itemError = error; }
      results.push(row);
      persist(output, report());
      // Invalid input is local to this image. A lost browser or interrupt is
      // a run failure, not thousands of misleading individual scan failures.
      if (signal?.aborted || page.isClosed() || !browser.isConnected())
        throw itemError || signal?.reason || Error("Benchmark browser disconnected");
      if ((index + 1) % 25 === 0 || index === items.length - 1) log(`  ${index + 1}/${items.length}`);
    }
    if (serverError) throw serverError;
    status = "complete";
  } catch (error) {
    failure = message(error);
    status = signal?.aborted ? "interrupted" : "failed";
  } finally {
    closing = true;
    const close = async (name, action) => {
      let timer;
      try {
        await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error(`${name} cleanup timed out`)), 5000);
        })]);
      } catch (error) { cleanupErrors.push(`${name}: ${message(error)}`); }
      finally { clearTimeout(timer); }
    };
    // Closing the context also terminates its scanner workers. Do not send a
    // new evaluate() to a crashed or stalled page just to cancel the scanner.
    if (context) await close("context", () => context.close());
    if (browser) await close("browser", () => browser.close());
    if (server) await close("server", () => server.kill());
    if (cleanupErrors.length && status === "complete") status = "failed";
    try { persist(output, report()); }
    catch (error) {
      throw new AggregateError([...(failure ? [Error(failure)] : []), error],
        `Could not save benchmark report${failure ? ` after: ${failure}` : ""}: ${message(error)}`);
    }
  }
  return report();
}
/* Reading a corpus photograph the way the photo flow reads it (web/photo-flow.js),
   for corpus/benchmark.cjs: drawn on white with its long side at most 1600 px,
   read through the corners the detector proposes at any confidence, and with
   every cell flagged when that confidence is 0.8 or less, since the flow then
   asks for the corners to be set and highlights every cell of a reading
   through them unchanged. --true-corners reads through the target's outline,
   pulled onto the frame where it lies on or past the edge. */
// photo-flow.js: the photograph's longest side (MAX_SIDE), and the detector
// confidence above which its corners need no confirmation (unconfirmedCorners).
const PHOTO_MAX_SIDE = 1600, CONFIRMED = 0.8;

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

async function photoFlowMeasure(page, item, options) {
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

// The corpus images a benchmark reads: by family, set and variant, a --list file
// of "set/name" lines, and a limit.
function selectImages(options) {
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

module.exports = { corpusImages, runBenchmark, summarize, writeReport, selectImages,
  photoSize, readingCorners, photoFlowReview, photoFlowMeasure, PHOTO_MAX_SIDE, CONFIRMED };
