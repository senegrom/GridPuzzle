/* Real UI/solver regressions with deterministic scanner results, not OCR tests. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8769/GridPuzzle/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle"))
  fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn("python", ["-m", "http.server", "8769", "--bind", "127.0.0.1", "--directory", "_preview"], { stdio: "ignore" });
const reports = [];

async function setup(page) {
  await page.goto(BASE);
  await page.waitForSelector('body[data-ready="true"]');
  return page.evaluate(async () => {
    window.settingsApp = await import("./app.js");
    window.settingsModel = await import("./model.js");
    const { Scanner } = await import("./scanner.js");
    window.settingsMode = { rows: 6, cols: 6, boxes: [3, 2], type: "sudoku" };
    Scanner.prototype.detect = async () => ({
      rows: settingsMode.rows, cols: settingsMode.cols, confidence: 0.99,
      corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }],
    });
    Scanner.prototype.read = async (_photo, _corners, _type, rows, cols) => {
      let puzzle, needsReview = false;
      if (settingsMode.type === "auto-black") {
        const { puzzleFromReadings } = await import("./scanner.js");
        puzzle = puzzleFromReadings({
          entries: [{ kind: "value", cell: 0, text: "1", confidence: 99 }],
          black: [false, false, false, false, true, false, false, false, false],
          meta: { boxes: false, rows: 3, cols: 3 },
          mask: new Uint8Array(900), width: 30, height: 30,
        }, "auto", 3, 3).puzzle;
        needsReview = true;
      } else {
        puzzle = settingsModel.makePuzzle("sudoku", rows, cols);
        const [br, bc] = settingsMode.boxes;
        puzzle.cells = Array.from({ length: 36 }, (_, i) =>
          (Math.floor(i / 6) % br * bc + Math.floor(Math.floor(i / 6) / br) + i % 6) % 6 + 1,
        );
      }
      const rectified = document.createElement("canvas");
      rectified.width = rectified.height = 600;
      return { puzzle, uncertain: [], cageUncertain: [], needsReview, notes: [], rectified };
    };
    settingsApp.loadPuzzle({ ...settingsModel.makePuzzle("sudoku", 6), boxRows: 3, boxCols: 2 });
    document.getElementById("auto-solve").checked = true;
    const photo = document.createElement("canvas");
    photo.width = photo.height = 600;
    const context = photo.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 600, 600);
    return photo.toDataURL("image/png").split(",")[1];
  });
}
async function found(page) {
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Grid found.");
}
async function photograph(page, image, name) {
  await page.setInputFiles("#photo-file", {
    name: `${name}.png`, mimeType: "image/png", buffer: Buffer.from(image, "base64"),
  });
  await found(page);
}
async function solved(page) {
  await page.waitForFunction(() => settingsApp.getState().result !== null, null, { timeout: 120000 });
  const state = await page.evaluate(() => settingsApp.getState());
  assert.equal(state.result.status, "unique", JSON.stringify(state.result));
  return state;
}
async function exercise(page) {
  const image = await setup(page);
  await page.selectOption("#puzzle-type", "sudoku");
  await photograph(page, image, "chosen-boxes");
  assert.equal(await page.inputValue("#box-rows"), "3");
  assert.equal(await page.inputValue("#box-cols"), "2");
  await page.click("#detect-photo");
  await found(page);
  assert.equal(await page.inputValue("#box-rows"), "3");
  await page.click("#read-photo");
  const first = await solved(page);
  assert.deepEqual([first.puzzle.boxRows, first.puzzle.boxCols], [3, 2]);

  await page.click("#show-crop");
  await page.evaluate(() => { settingsMode.boxes = [2, 3]; });
  await page.click("#rotate-photo");
  await found(page);
  assert.equal(await page.inputValue("#box-rows"), "2");
  assert.equal(await page.inputValue("#box-cols"), "3");
  await page.click("#read-photo");
  await solved(page);

  await page.evaluate(() => settingsApp.loadPuzzle(settingsModel.makePuzzle()));
  await photograph(page, image, "proposed-boxes");
  await page.click("#read-photo");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
  const proposal = await page.evaluate(() => settingsApp.getState());
  assert.equal(proposal.needsReview, true);
  assert.equal(proposal.result, null);
  assert.equal(proposal.busy, false);
  await page.click("#solve");
  assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
  assert.match(await page.textContent("#confirm-text"), /Boxes: 2 rows × 3 columns/);
  await page.click("#confirm-solve");
  await solved(page);

  await page.evaluate(() => {
    settingsApp.loadPuzzle(settingsModel.makePuzzle("hidato", 3));
    settingsMode = { rows: 3, cols: 3, type: "auto-black" };
  });
  await page.selectOption("#puzzle-type", "auto");
  await photograph(page, image, "misclassified-str8ts");
  await page.click("#read-photo");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
  const before = await page.evaluate(() => settingsApp.getState().puzzle);
  assert.equal(before.type, "hidato");
  assert.deepEqual(before.black, []);
  await page.selectOption("#puzzle-type", "str8ts");
  await page.click("#use-type");
  const corrected = await page.evaluate(() => settingsApp.getState().puzzle);
  assert.equal(corrected.type, "str8ts");
  assert.deepEqual(corrected.black, [4]);
  assert.deepEqual(corrected.cells, before.cells);
  assert.match(await page.locator('[data-cell="4"]').getAttribute("class"), /blocked/);
  await page.click("#undo");
  assert.deepEqual(await page.evaluate(() => settingsApp.getState().puzzle), before);

  await page.evaluate(() => settingsApp.loadPuzzle(settingsModel.demo("kenken")));
  const cageBoard = await page.evaluate(() => settingsApp.getState().puzzle);
  await page.selectOption("#puzzle-type", "sudoku");
  await page.click("#use-type");
  assert.deepEqual(await page.evaluate(() => settingsApp.getState().puzzle), cageBoard);
  assert.match(await page.textContent("#status-text"), /structural clues/);
}
(async () => {
  try {
    let available = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE)).ok) { available = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(available, "Local static server did not start");
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      const context = await browser.newContext({
        serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
      });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await exercise(page);
        assert.deepEqual(errors, [], "Uncaught page errors");
        reports.push({ browser: name, version: browser.version(), status: "passed" });
        console.log(`${name}: scanner settings, correction, undo and solver regressions passed`);
      } catch (error) {
        reports.push({ browser: name, status: "failed", message: error.message, errors });
        await page.screenshot({ path: `browser-artifacts/${name}-scanner-settings-failure.png`, fullPage: true }).catch(() => {});
        throw error;
      } finally {
        await browser.close();
      }
    }
  } finally {
    fs.writeFileSync("browser-artifacts/scanner-settings.json", JSON.stringify(reports, null, 2) + "\n");
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
