/* Real user-supplied newspaper photographs: OCR/structure safety regression. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BASE = "http://127.0.0.1:8768/GridPuzzle/";
const ROOT = path.resolve("Examples/BrowserScanner/Newspaper");
const TRUTH = JSON.parse(fs.readFileSync(path.join(ROOT, "ground-truth.json"), "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle"))
  fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn(
  "python",
  ["-m", "http.server", "8768", "--bind", "127.0.0.1", "--directory", "_preview"],
  { stdio: "ignore" },
);
const reports = [];

async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
}

async function scan(page, fixture) {
  const jpeg = fs.readFileSync(path.join(ROOT, fixture.image)).toString("base64");
  return page.evaluate(async ({ jpeg, type }) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${jpeg}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const { Scanner } = await import("./scanner.js");
    const scanner = new Scanner();
    try {
      return await scanner.read(
        canvas,
        [
          { x: 0, y: 0 },
          { x: canvas.width - 1, y: 0 },
          { x: canvas.width - 1, y: canvas.height - 1 },
          { x: 0, y: canvas.height - 1 },
        ],
        type,
        9,
        9,
      );
    } finally {
      scanner.cancel();
    }
  }, { jpeg, type: fixture.type });
}

function assess(fixture, scanResult) {
  const expected = fixture.cells,
    actual = scanResult.puzzle.cells,
    uncertain = new Set(scanResult.uncertain),
    wrong = expected.flatMap((value, i) => (actual[i] === value ? [] : [i])),
    unsafe = wrong.filter((i) => !uncertain.has(i)),
    printed = expected.filter(Number.isInteger).length,
    correctPrinted = expected.filter(
      (value, i) => Number.isInteger(value) && actual[i] === value,
    ).length;
  assert.deepEqual(unsafe, [], `${fixture.name}: wrong/invented clues must require review`);
  assert.equal(scanResult.puzzle.type, fixture.type);
  if (fixture.type === "str8ts") {
    assert.deepEqual(scanResult.puzzle.black, fixture.black, "Str8ts black-cell geometry changed");
    assert.ok(scanResult.needsReview, "Str8ts scan must remain review-gated");
    assert.ok(correctPrinted >= 18, `${fixture.name}: only ${correctPrinted}/${printed} printed values read`);
  } else {
    assert.deepEqual(scanResult.puzzle.black || [], [], "Shaded Sudoku cells became structural black cells");
    assert.ok(correctPrinted >= 22, `${fixture.name}: only ${correctPrinted}/${printed} printed values read`);
  }
  return {
    name: fixture.name,
    type: fixture.type,
    printed,
    correctPrinted,
    wrong,
    unsafe,
    uncertain: scanResult.uncertain,
    black: scanResult.puzzle.black || [],
  };
}

(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await sleep(100);
  }
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const report = { browser: name, version: browser.version(), scans: [], errors: [] };
    reports.push(report);
    page.on("pageerror", (error) => report.errors.push(error.message));
    try {
      await page.goto(BASE);
      await ready(page);
      for (const fixture of TRUTH.fixtures)
        report.scans.push(assess(fixture, await scan(page, fixture)));
      assert.deepEqual(report.errors, []);
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.failure = error.stack;
      console.error(name, error);
    } finally {
      await browser.close();
      fs.writeFileSync(
        "browser-artifacts/newspaper-regressions.json",
        JSON.stringify(reports, null, 2),
      );
    }
  }
  if (reports.some((report) => !report.ok)) process.exitCode = 1;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
