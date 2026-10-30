/* OCR latency and engine reuse, with real Tesseract in Chromium and WebKit
   (or the engines BROWSER_ENGINES selects). Wall-clock times are reported,
   not enforced; reuse and safety are asserted. As the harness's engines()
   does, every engine runs, also after one has failed, its report is written
   after it, a browser that will not close fails an engine that passed, and
   the first failure is rethrown after the last engine.
   Set OCR_BASELINE_SITE to another built site to time it in the same browser. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { exitIfUnclosed, selectedEngines, watch } = require("./harness.cjs");
const ROOT = "Examples/BrowserScanner/Newspaper";
const fixtures = JSON.parse(fs.readFileSync(`${ROOT}/ground-truth.json`)).fixtures.map((f) => ({ ...f,
  imageData: fs.readFileSync(`${ROOT}/${f.image}`).toString("base64") }));
const mime = { ".js": "application/javascript", ".mjs": "application/javascript", ".wasm": "application/wasm",
  ".json": "application/json", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
  ".gz": "application/gzip", ".zip": "application/zip", ".webmanifest": "application/manifest+json" };
const server = http.createServer((request, response) => {
  const u = new URL(request.url, "http://localhost"), baseline = u.pathname.startsWith("/baseline/");
  const root = path.resolve(baseline ? process.env.OCR_BASELINE_SITE || "_site" : "_site");
  const name = decodeURIComponent(u.pathname.replace(/^\/(baseline|candidate)\//, "")) || "index.html";
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); response.end(data);
  });
});
// Five reads on one Scanner: the same photograph three times, the other one,
// then the first again. Cold and warm times, first provisional reading, worker
// counts and cache hits come back per read; every discrepancy must be flagged.
async function sequence(page, fixtures) {
  return page.evaluate(async (fixtures) => {
    const { Scanner } = await import("./scanner.js");
    const originalWorker = window.Worker, counts = { ocr: 0, geometry: 0 };
    window.Worker = class extends originalWorker { constructor(url, options) {
      super(url, options); if (String(url).includes("ocr-host-worker")) counts.ocr++;
      if (String(url).includes("geometry-worker")) counts.geometry++;
    } };
    const scanner = new Scanner(), scans = [];
    try {
      for (const fixture of [fixtures[0], fixtures[0], fixtures[0], fixtures[1], fixtures[0]]) {
        const image = new Image(); image.src = `data:image/webp;base64,${fixture.imageData}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const start = performance.now(); let firstReading = null;
        const result = await scanner.read(canvas, [{ x: 0, y: 0 }, { x: canvas.width - 1, y: 0 },
          { x: canvas.width - 1, y: canvas.height - 1 }, { x: 0, y: canvas.height - 1 }], fixture.type, 9, 9, () => {}, {
          onPreview(partial) {
            if (partial.entries.some((entry) => entry.confidence !== 0) || !partial.needsReview)
              throw Error("Unverified atlas readings were trusted");
            firstReading ??= performance.now() - start;
          },
        });
        const flagged = new Set(result.uncertain), wrong = fixture.cells.flatMap((value, cell) => value === result.puzzle.cells[cell] ? [] : [{ cell, expected: value, actual: result.puzzle.cells[cell] }]);
        scans.push({ name: fixture.name, milliseconds: Math.round(performance.now() - start), firstReading: firstReading && Math.round(firstReading),
          timings: result.timings, ocrStats: result.ocrStats, wrong, unsafe: wrong.filter((item) => !flagged.has(item.cell)),
          correct: fixture.cells.filter((value, cell) => Number.isInteger(value) && value === result.puzzle.cells[cell]).length,
          workers: { ...counts } });
      }
      return { scans, counts };
    } finally { scanner.cancel(); window.Worker = originalWorker; }
  }, fixtures);
}
// `playwright`, `port` and `out` are there for web/tests/ocr-latency.test.js,
// which runs this with stand-ins for the browsers.
async function run({ playwright = require("playwright"), port = 8777, out = "browser-artifacts/ocr-latency.json" } = {}) {
  const selected = selectedEngines();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, reports = [], failures = [];
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const save = () => fs.writeFileSync(out, JSON.stringify(reports, null, 2) + "\n");
  try {
    for (const name of selected) {
      const browser = await playwright[name].launch({ headless: true }), watched = watch(browser);
      // Each variant's page's uncaught errors, the later page's with its URL.
      const report = { browser: name, version: browser.version(), errors: watched.errors, ended: watched.ended,
        cleanupErrors: watched.cleanupErrors }; reports.push(report);
      try {
        for (const variant of process.env.OCR_BASELINE_SITE ? ["baseline", "candidate"] : ["candidate"]) {
          const context = await browser.newContext({ serviceWorkers: "block" });
          const page = await context.newPage(); page.setDefaultTimeout(120000);
          await page.goto(`${origin}/${variant}/`); await page.waitForSelector('body[data-ready="true"]');
          report[variant] = await sequence(page, fixtures);
          for (const scan of report[variant].scans) assert.deepEqual(scan.unsafe, [], `${name}/${variant}: unflagged error`);
          if (variant === "candidate") {
            assert.equal(report[variant].counts.ocr, 1, "reuse one OCR host for the entire sequence");
            assert.equal(report[variant].counts.geometry, 1, "reuse the geometry worker");
            assert.ok(report[variant].scans.slice(1, 3).every((scan) => scan.ocrStats.cacheHits > 0), "repeated identical crops hit the cache");
            assert.ok(report[variant].scans.every((scan) => scan.firstReading !== null && scan.firstReading <= scan.milliseconds), "a provisional reading precedes the result");
          }
          const times = report[variant].scans.map((scan) => scan.milliseconds);
          console.log(`${name}/${variant}: reads ${times.join(", ")} ms; first provisional reading ${report[variant].scans.map((s) => s.firstReading ?? "-").join(", ")} ms; OCR hosts ${report[variant].counts.ocr}, geometry workers ${report[variant].counts.geometry}`);
          await context.close();
        }
        assert.deepEqual(report.errors, [], `${name}: uncaught page errors`);
        watched.check(name);
        report.ok = true;
      } catch (thrown) {
        const error = await watched.lead(thrown); report.ok = false; report.failure = error.stack;
        failures.push(error); console.error(name, error);
      } finally {
        const unclosed = await watched.close(name);
        if (unclosed && report.ok) { report.ok = false; report.failure = unclosed.stack; failures.push(unclosed); }
        save();
      }
    }
  } finally { save(); server.close(); }
  if (failures.length) throw failures[0];
  return reports;
}
module.exports = run;
if (require.main === module)
  run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => exitIfUnclosed(module));
