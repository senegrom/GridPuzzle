/* Quality measurements before correction; fixture values never enter the recognizer. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BASE = "http://127.0.0.1:8775/";
const ROOT = "Examples/BrowserScanner/Newspaper";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This runs in the browser against the production Scanner and its real workers.
async function measure({ fixture, variation }) {
  const { Scanner } = await import("./scanner.js");
  const canvas = document.createElement("canvas");
  let expected, rows, cols, type;
  if (fixture.imageData) {
    const image = new Image();
    image.src = `data:image/webp;base64,${fixture.imageData}`;
    await image.decode();
    const scale = variation.small ? 0.5 : 1;
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    expected = fixture.cells;
    rows = cols = 9;
    type = variation.auto ? "auto" : fixture.type;
  } else {
    rows = cols = 12;
    type = "numbrix";
    canvas.width = canvas.height = 900;
    expected = Array(144).fill(null);
    const values = [1, 7, 11, 12, 16, 18, 20, 21, 25, 28, 33, 38, 44, 48, 55,
      66, 77, 88, 99, 100, 101, 108, 111, 117, 121, 128, 132, 138, 141, 144];
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 900, 900);
    context.strokeStyle = "black";
    context.lineWidth = 2;
    for (let i = 0; i <= 12; i++) {
      context.beginPath();
      context.moveTo(i * 75, 0); context.lineTo(i * 75, 900);
      context.moveTo(0, i * 75); context.lineTo(900, i * 75);
      context.stroke();
    }
    context.fillStyle = "black";
    context.font = `${fixture.holdout ? 28 : 30}px ${fixture.font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    values.forEach((value, j) => {
      const i = (j * 37 + 13) % 144;
      expected[i] = value;
      context.fillText(String(value), (i % 12 + 0.5) * 75 + (fixture.holdout ? 2 : 0),
        (Math.floor(i / 12) + 0.5) * 75 - (fixture.holdout ? 1 : 0));
    });
  }
  if (variation.blur) {
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    const context = canvas.getContext("2d");
    context.filter = `blur(${variation.blur}px)`;
    context.drawImage(copy, 0, 0);
    context.filter = "none";
  }
  if (variation.contrast) {
    const context = canvas.getContext("2d"), pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4)
      for (let k = 0; k < 3; k++)
        pixels.data[i + k] = Math.round(255 - (255 - pixels.data[i + k]) * variation.contrast);
    context.putImageData(pixels, 0, 0);
  }
  const scanner = new Scanner(), start = performance.now();
  const geometry = scanner.geometry.bind(scanner);
  let detectedBlack = [];
  // Observe the real preparation result, including structure which an explicit
  // puzzle type might discard. No pixels or recognition results are mocked.
  scanner.geometry = async (...args) => {
    const result = await geometry(...args);
    if (args[0] === "prepare")
      detectedBlack = result.black.flatMap((value, i) => value ? [i] : []);
    return result;
  };
  try {
    const result = await scanner.read(canvas, [
      { x: 0, y: 0 }, { x: canvas.width - 1, y: 0 },
      { x: canvas.width - 1, y: canvas.height - 1 }, { x: 0, y: canvas.height - 1 },
    ], type, rows, cols);
    const actual = result.puzzle.cells, flagged = new Set(result.uncertain),
      wrong = expected.flatMap((value, cell) => value === actual[cell] ? [] : [{ cell, expected: value, actual: actual[cell] }]);
    return {
      name: fixture.name, variation: variation.name, type: result.puzzle.type, detectedBlack,
      printed: expected.filter(Number.isInteger).length,
      correct: expected.filter((value, i) => Number.isInteger(value) && actual[i] === value).length,
      wrong, unsafe: wrong.filter(({ cell }) => !flagged.has(cell)),
      flagged: result.uncertain, black: result.puzzle.black || [],
      needsReview: result.needsReview, notes: result.notes,
      milliseconds: Math.round(performance.now() - start), retryCount: result.retryCount || 0,
    };
  } finally {
    scanner.cancel();
  }
}

async function run() {
  const server = spawn("python", ["-m", "http.server", "8775", "--bind", "127.0.0.1", "--directory", "_site"], { stdio: "ignore" });
  const reports = [];
  fs.mkdirSync("browser-artifacts", { recursive: true });
  try {
    let available = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(BASE)).ok) { available = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(available, "OCR quality test server did not start");
    const photographs = JSON.parse(fs.readFileSync(path.join(ROOT, "ground-truth.json"))).fixtures;
    const fixtures = [
      ...photographs.map((f) => ({ ...f, imageData: fs.readFileSync(path.join(ROOT, f.image)).toString("base64") })),
      ...["Arial", "Times New Roman", "Courier New"].map((font) => ({ name: `numbers-${font}`, font })),
      ...["DejaVu Sans", "DejaVu Serif"].map((font) => ({ name: `holdout-${font}`, font, holdout: true })),
    ];
    const variations = [
      { name: "original" }, { name: "small", small: true },
      { name: "faded", contrast: 0.35 }, { name: "mild-fade", contrast: 0.65 },
      { name: "blur", blur: 0.6 },
      { name: "auto-original", auto: true },
      { name: "auto-faded", auto: true, contrast: 0.35 },
      { name: "auto-mild-fade", auto: true, contrast: 0.65 },
    ];
    for (const [name, engine] of Object.entries({ chromium, webkit })) {
      const browser = await engine.launch({ headless: true });
      const report = { browser: name, version: browser.version(), scans: [], errors: [] };
      reports.push(report);
      try {
        const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.on("pageerror", (error) => report.errors.push(error.message));
        await page.goto(BASE);
        await page.waitForSelector('body[data-ready="true"]');
        for (const fixture of fixtures)
          for (const variation of variations.filter((v) => fixture.imageData || (fixture.holdout ? v.name === "original" : v.name !== "small" && !v.auto))) {
            const scan = await page.evaluate(measure, { fixture, variation });
            report.scans.push(scan);
            const label = `${name}/${fixture.name}/${variation.name}`;
            assert.deepEqual(scan.unsafe, [], `${label}: every wrong, missed or invented clue must be flagged`);
            assert.deepEqual(scan.black, fixture.black || [], `${label}: structural black-cell geometry`);
            assert.deepEqual(scan.detectedBlack, fixture.black || [], `${label}: pre-classification black-cell geometry`);
            if (fixture.imageData)
              assert.equal(scan.type, fixture.type, `${label}: automatic family classification`);
            const minimum = fixture.imageData ? (fixture.type === "sudoku" ? 24 : variation.small ? 17 : variation.contrast && (variation.auto || variation.contrast === 0.35) ? 19 : 20) : fixture.holdout ? 27 : 29;
            assert.ok(scan.correct >= minimum, `${label}: ${scan.correct}/${scan.printed} (minimum ${minimum})`);
            if (!fixture.imageData)
              assert.ok(scan.flagged.length <= (fixture.holdout ? 8 : 5), `${label}: excessive manual review burden`);
            if (variation.contrast) {
              assert.ok(scan.needsReview, `${label}: low-contrast adjustments require confirmation`);
              assert.ok(scan.notes.some((note) => /Low-contrast/.test(note)), `${label}: missing contrast warning`);
            }
            console.log(`${label}: ${scan.correct}/${scan.printed}, ${scan.flagged.length} flagged, ${scan.milliseconds}ms`);
          }
        assert.deepEqual(report.errors, []);
        report.ok = true;
      } catch (error) {
        report.ok = false;
        report.failure = error.stack;
        throw error;
      } finally {
        await browser.close();
      }
    }
  } finally {
    fs.writeFileSync("browser-artifacts/ocr-quality.json", JSON.stringify(reports, null, 2) + "\n");
    server.kill();
  }
}
module.exports = { run };
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
