/* Real DOM, photo overlays and Pyodide. OCR completion is controlled explicitly. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8772/GridPuzzle/";
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle")) fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn("python", ["-m", "http.server", "8772", "--bind", "127.0.0.1", "--directory", "_preview"], { stdio: "ignore" });
const reports = [];
const state = (page) => page.evaluate(() => photoApp.getState());
async function exercise(page, report) {
  await page.goto(BASE);
  await page.waitForSelector('body[data-ready="true"]');
  const image = await page.evaluate(async () => {
    window.photoApp = await import("./app.js");
    const { Scanner } = await import("./scanner.js"), { makePuzzle } = await import("./model.js");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 600;
    canvas.getContext("2d").fillRect(0, 0, 600, 600);
    window.photoProposal = (value = 1) => {
      const puzzle = makePuzzle("latinsquare", 2); puzzle.cells[0] = value;
      return { puzzle, cellUncertain: [], cageUncertain: [], needsReview: false, notes: [], rectified: canvas };
    };
    Scanner.prototype.detect = async () => ({ rows: 2, cols: 2, confidence: 0.99,
      corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }] });
    Scanner.prototype.read = async () => photoProposal();
    document.getElementById("auto-solve").checked = false;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.selectOption("#puzzle-type", "latinsquare");
  await page.setInputFiles("#photo-file", { name: "latin.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Grid found.");
  await page.click("#read-photo");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
  await page.click("#solve");
  await page.waitForFunction(() => photoApp.getState().result?.status === "unique", null, { timeout: 120000 });
  await page.click("#photo-view"); await page.click("#show-crop");
  const accepted = await state(page);
  const session = await page.evaluate(() => localStorage.getItem("gridpuzzle-session-v1"));
  const overlay = await page.locator("#solution-photo").evaluate((canvas) => canvas.toDataURL());
  await page.evaluate(async () => {
    window.photoJobs = [];
    (await import("./scanner.js")).Scanner.prototype.read = (...args) => new Promise((resolve, reject) => {
      const progress = args.at(-1);
      photoJobs.push({ resolve, reject, progress }); progress("Reading retained photo…", 0.1);
    });
  });
  async function read() {
    const count = await page.evaluate(() => photoJobs.length);
    await page.click("#read-photo");
    await page.waitForFunction((n) => photoJobs.length === n + 1, count);
    assert.equal((await state(page)).busy, true);
    assert.deepEqual((await state(page)).result, accepted.result);
  }
  async function preserved() {
    const actual = await state(page);
    for (const key of ["puzzle", "result", "play", "hints", "cellUncertain", "cageUncertain", "needsReview"])
      assert.deepEqual(actual[key], accepted[key], `${key} changed after rejected OCR`);
    assert.equal(actual.busy, false);
    assert.equal(await page.locator("#photo-view").isEnabled(), true);
    assert.equal(await page.locator("#solution-photo").isVisible(), true);
    assert.equal(await page.locator("#solution-photo").evaluate((canvas) => canvas.toDataURL()), overlay);
    assert.equal(await page.evaluate(() => localStorage.getItem("gridpuzzle-session-v1")), session);
  }
  for (const failure of ["error", "invalid-puzzle", "invalid-metadata", "cancelled"]) {
    await read();
    if (failure === "cancelled") await page.click("#stop");
    await page.evaluate(async (failure) => {
      const job = photoJobs.at(-1);
      if (failure === "error") job.reject(Error("OCR unavailable"));
      else {
        const found = photoProposal(2);
        if (failure === "invalid-puzzle") found.puzzle.cells[0] = 99;
        if (failure === "invalid-metadata") found.notes = null;
        job.resolve(found);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, failure);
    await preserved();
  }
  report.checks.push("failed, malformed and cancelled OCR preserve the real solved board, photo overlay, answers and session");
  await page.locator("#layout-settings").evaluate((details) => { details.open = true; });
  for (const ending of ["result", "error"]) {
    await read(); await page.fill("#rows", "0"); await page.click("#read-photo");
    const warning = await page.textContent("#status-text"); assert.match(warning, /whole numbers/);
    await page.evaluate(async (ending) => {
      const job = photoJobs.at(-1); job.progress("Obsolete progress", 0.5);
      if (ending === "result") job.resolve(photoProposal(2)); else job.reject(Error("Obsolete error"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, ending);
    assert.equal(await page.textContent("#status-text"), warning);
    await preserved(); await page.fill("#rows", "2");
  }
  report.checks.push("a rejected second Read supersedes late progress, results and errors from older OCR");
  await read();
  await page.evaluate(() => photoJobs.at(-1).resolve(photoProposal(2)));
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
  assert.equal((await state(page)).puzzle.cells[0], 2);
  assert.equal((await state(page)).result, null);
  assert.equal(await page.locator("#solution-photo").isVisible(), false);
  await page.click("#undo");
  assert.deepEqual((await state(page)).puzzle, accepted.puzzle);
  await page.click("#solve");
  await page.waitForFunction(() => photoApp.getState().result?.status === "unique", null, { timeout: 120000 });
  report.checks.push("a valid re-read replaces the board; Undo and the real solver still work");
}
(async () => {
  try {
    let available = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE)).ok) { available = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(available, "Static server did not start");
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(), report = { browser: name, version: browser.version(), checks: [], errors: [] };
      reports.push(report); page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => report.errors.push(error.message));
      try {
        await exercise(page, report); assert.deepEqual(report.errors, []); report.status = "passed";
        console.log(`${name}: photo Read transaction regressions passed`);
      } catch (error) {
        report.status = "failed"; report.failure = error.stack;
        await page.screenshot({ path: `browser-artifacts/${name}-photo-read-failure.png`, fullPage: true }).catch(() => {});
        throw error;
      } finally { await browser.close(); }
    }
  } finally {
    fs.writeFileSync("browser-artifacts/photo-read-transactions.json", JSON.stringify(reports, null, 2) + "\n");
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
