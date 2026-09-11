/* Real DOM, session and Pyodide regressions. Scanner outputs are deterministic. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8770/GridPuzzle/";
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle")) fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn("python", ["-m", "http.server", "8770", "--bind", "127.0.0.1", "--directory", "_preview"], { stdio: "ignore" });
const reports = [];
async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async () => { window.repairApp = await import("./app.js"); });
}
async function importRegressions(page) {
  const before = await page.evaluate(() => repairApp.getState().puzzle);
  const latin = { type: "latinsquare", rows: 2, cols: 2, cells: [null, null, null, null] };
  await page.evaluate(() => {
    window.originalImportText = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "held-puzzle.json")
        return new Promise((resolve, reject) => { window.heldImport = { resolve, reject }; });
      return originalImportText.call(this);
    };
  });
  try {
    for (const late of ["success", "error"]) {
      for (const newer of ["oversized file", "oversized draft", "invalid JSON draft", "invalid puzzle draft"]) {
        await page.evaluate(() => { window.heldImport = null; });
        await page.setInputFiles("#json-file", {
          name: "held-puzzle.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(latin)),
        });
        await page.waitForFunction(() => window.heldImport !== null);
        if (newer === "oversized file")
          await page.setInputFiles("#json-file", {
            name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(200001, 32),
          });
        else {
          await page.fill("#json-data", newer === "oversized draft" ? "x".repeat(200001)
            : newer === "invalid JSON draft" ? "{" : '{"type":"auto"}');
          await page.click("#apply-json");
        }
        const message = await page.textContent("#status-text");
        assert.ok(message.length > 0);
        await page.evaluate(async ({ late, payload }) => {
          if (late === "success") heldImport.resolve(JSON.stringify(payload));
          else heldImport.reject(Error("Obsolete file failed"));
          // Let the real asynchronous onchange continuation finish.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }, { late, payload: latin });
        assert.deepEqual(await page.evaluate(() => repairApp.getState().puzzle), before, `${newer}: stale board`);
        assert.equal(await page.textContent("#status-text"), message, `${newer}: stale status`);
      }
    }
  } finally {
    await page.evaluate(() => { File.prototype.text = originalImportText; });
  }
  for (const black of [null, false, 0, ""]) {
    await page.fill("#json-data", JSON.stringify({ ...latin, black }));
    await page.click("#apply-json");
    assert.match(await page.textContent("#status-text"), /black-cell metadata/);
    assert.deepEqual(await page.evaluate(() => repairApp.getState().puzzle), before);
  }
  await page.fill("#json-data", JSON.stringify({ type: "str8ts", rows: 1, cols: 1, cells: [null] }));
  await page.click("#apply-json");
  assert.match(await page.textContent("#status-text"), /2 × 2/);
  assert.deepEqual(await page.evaluate(() => repairApp.getState().puzzle), before);
  for (const type of ["str8ts", "hidato"]) {
    await page.fill("#json-data", JSON.stringify({ ...latin, type, cells: ["#", "#", "#", "#"],
      ...(type === "str8ts" ? { black: [0, 1, 2, 3] } : {}) }));
    await page.click("#apply-json");
    assert.match(await page.textContent("#status-text"), /Puzzle loaded/);
    await page.click("#solve");
    assert.match(await page.textContent("#status-text"), /at least one/);
    assert.equal(await page.evaluate(() => repairApp.getState().busy), false);
    assert.equal(await page.evaluate(() => repairApp.getState().result), null);
  }
  for (const type of ["hidato", "numbrix"]) {
    await page.fill("#json-data", JSON.stringify({ ...latin, type, cells: [1, 1, null, null] }));
    await page.click("#apply-json");
    assert.match(await page.textContent("#status-text"), /Puzzle loaded/);
    await page.click("#solve");
    assert.match(await page.textContent("#status-text"), /must not repeat/);
    assert.equal(await page.evaluate(() => repairApp.getState().busy), false);
    assert.equal(await page.evaluate(() => repairApp.getState().result), null);
  }
}
async function scan(page) {
  const image = await page.evaluate(async () => {
    const { Scanner, puzzleFromReadings } = await import("./scanner.js");
    Scanner.prototype.detect = async () => ({ rows: 3, cols: 3, confidence: 0.99,
      corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }] });
    Scanner.prototype.read = async () => ({ ...puzzleFromReadings({
      entries: [{ kind: "value", cell: 0, text: "1", confidence: 99 },
        { kind: "blackvalue", cell: 4, text: "3", confidence: 99 }],
      black: [false, false, false, false, true, false, false, false, false],
      meta: { rows: 3, cols: 3, boxes: false }, mask: new Uint8Array(900), width: 30, height: 30,
    }, "auto", 3, 3), rectified: canvas });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 600;
    canvas.getContext("2d").fillRect(0, 0, 600, 600);
    document.getElementById("auto-solve").checked = false;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.selectOption("#puzzle-type", "auto");
  await page.setInputFiles("#photo-file", { name: "reading.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Grid found.");
  await page.click("#read-photo");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
}
async function cell(page, index, value) {
  await page.click(`[data-cell="${index}"]`);
  await page.fill("#cell-value", String(value));
  await page.click("#save-cell");
  await page.waitForFunction(() => !document.getElementById("cell-dialog").open);
}
async function exercise(page) {
  await page.goto(BASE); await ready(page); await scan(page);
  const pending = await page.evaluate(() => repairApp.getState());
  assert.deepEqual(pending.blackReadings, [{ cell: 4, value: 3 }]);
  assert.ok(pending.cellUncertain.includes(4));
  await page.reload(); await ready(page);
  assert.deepEqual(await page.evaluate(() => repairApp.getState().blackReadings), pending.blackReadings);
  await page.selectOption("#puzzle-type", "str8ts"); await page.click("#use-type");
  const corrected = await page.evaluate(() => repairApp.getState());
  assert.equal(corrected.puzzle.cells[4], 3); assert.ok(corrected.cellUncertain.includes(4));
  assert.ok(corrected.needsReview);
  await page.click("#solve");
  assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
  await page.click("#confirm-solve");
  await page.waitForFunction(() => repairApp.getState().result !== null, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => repairApp.getState().result.status), "unique");
  await page.click("#undo");
  assert.equal(await page.evaluate(() => repairApp.getState().puzzle.type), "hidato");
  assert.deepEqual(await page.evaluate(() => repairApp.getState().blackReadings), pending.blackReadings);
  await scan(page);
  // A manually confirmed blank must not resurrect a stale OCR digit later.
  await page.click('[data-cell="4"]'); await page.click("#save-cell");
  assert.deepEqual(await page.evaluate(() => repairApp.getState().blackReadings), []);
  await page.selectOption("#puzzle-type", "str8ts"); await page.click("#use-type");
  assert.equal(await page.evaluate(() => repairApp.getState().puzzle.cells[4]), "#");
  await page.click("#undo"); await page.click("#undo");
  assert.deepEqual(await page.evaluate(() => repairApp.getState().blackReadings), pending.blackReadings);
  await cell(page, 0, 2); await cell(page, 0, 3);
  await page.click("#show-crop");
  await page.evaluate(async () => { (await import("./scanner.js")).Scanner.prototype.detect = async () => { throw Error("Detector unavailable"); }; });
  await page.click("#detect-photo");
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Detector unavailable");
  assert.equal(await page.locator("#undo").isEnabled(), true);
  await page.click("#undo");
  assert.equal(await page.evaluate(() => repairApp.getState().puzzle.cells[0]), 2);
  // Real 6000x6000 lossless WebP: unavailable resizing must not fall back to full decoding.
  await page.evaluate(() => {
    window.repairBitmap = window.createImageBitmap;
    window.repairDecode = Image.prototype.decode;
    window.repairFullDecodes = 0;
    window.createImageBitmap = async () => { throw Error("Resized decoder unavailable"); };
    Image.prototype.decode = function () { window.repairFullDecodes++; return repairDecode.call(this); };
  });
  try {
    await page.setInputFiles("#photo-file", { name: "oversized.webp", mimeType: "image/webp", buffer: Buffer.from("524946461e000000574542505650384c110000002f6fd7db0507d0fffef7bfff8188e87f0000", "hex") });
    await page.waitForFunction(() => document.getElementById("status-text").textContent.includes("cannot downscale"));
    assert.equal(await page.evaluate(() => repairFullDecodes), 0);
  } finally {
    await page.evaluate(() => { window.createImageBitmap = repairBitmap; Image.prototype.decode = repairDecode; });
  }
  const before = await page.evaluate(() => repairApp.getState().puzzle);
  await page.evaluate(() => document.getElementById("data-editor").open = true);
  await page.fill("#json-data", JSON.stringify({ type: "kenken", rows: 2, cols: 2, cells: [1, 2, 2, 1],
    cages: [1, 2, 2, 1].map((target, i) => ({ cells: [i], target, op: null })) }));
  await page.click("#apply-json");
  assert.match(await page.textContent("#status-text"), /operator/);
  assert.deepEqual(await page.evaluate(() => repairApp.getState().puzzle), before);
}
async function playPhotoRegressions(page) {
  // Re-scan without reloading: the photo mapping must still be present.
  await scan(page);
  await page.selectOption("#puzzle-type", "str8ts"); await page.click("#use-type");
  await page.click("#solve"); await page.click("#confirm-solve");
  await page.waitForFunction(() => repairApp.getState().result !== null, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => repairApp.getState().result.status), "unique");
  await page.click("#photo-view");
  assert.equal(await page.locator("#solution-photo").isVisible(), true);
  const solved = await page.evaluate(() => repairApp.getState());
  await page.selectOption("#edit-tool", "play");
  assert.equal(await page.locator("#solution-photo").isVisible(), false);
  assert.equal(await page.locator("#board-scroll").isVisible(), true);
  assert.equal(await page.locator("#photo-view").isDisabled(), true);
  assert.equal(await page.locator("#save-photo").isVisible(), false);
  assert.equal(await page.locator("#next-solution").isVisible(), false);
  assert.deepEqual(await page.evaluate(() => repairApp.getState().play), solved.play);
  await page.selectOption("#edit-tool", "value"); await page.click("#photo-view");
  assert.equal(await page.locator("#solution-photo").isVisible(), true);
  assert.deepEqual(await page.evaluate(() => repairApp.getState().result), solved.result);
}
(async () => {
  try {
    let available = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE)).ok) { available = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(available, "Static test server did not start");
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = []; page.setDefaultTimeout(20000);
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await exercise(page); await playPhotoRegressions(page); await importRegressions(page); assert.deepEqual(errors, []);
        reports.push({ browser: name, version: browser.version(), status: "passed" });
      } catch (e) {
        reports.push({ browser: name, status: "failed", message: e.message, errors });
        await page.screenshot({ path: `browser-artifacts/${name}-repair-failure.png`, fullPage: true }).catch(() => {});
        throw e;
      } finally { await browser.close(); }
    }
  } finally {
    fs.writeFileSync("browser-artifacts/scanner-repairs.json", JSON.stringify(reports, null, 2) + "\n");
    server.kill();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
