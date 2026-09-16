/* Real browser/OCR checks: complete damaged crops, never solver-derived clues. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8778/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measure({ pieces, black, leading, narrow }) {
  const { Scanner } = await import("./scanner.js");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 400;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 400, 400);
  if (black) {
    context.fillStyle = "#0a0a0a";
    context.fillRect(0, 0, 100, 100);
  }
  context.fillStyle = black ? "#f5f5f5" : "#0a0a0a";
  if (leading) context.fillRect(27, 28, 5, 44);
  for (const [x, y, w, h] of pieces) context.fillRect(x, y, w, h);
  context.fillStyle = "#101010";
  context.font = "38px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("2", 350, 350);
  const scanner = new Scanner();
  try {
    const found = await scanner.read(canvas, [
      { x: 0, y: 0 }, { x: 399, y: 0 }, { x: 399, y: 399 }, { x: 0, y: 399 },
    ], black ? "str8ts" : "numbrix", 4, 4);
    const expected = Array(16).fill(null);
    expected[0] = leading || narrow ? 11 : 1;
    expected[15] = 2;
    const wrong = expected.flatMap((value, cell) =>
      value === found.puzzle.cells[cell] ? [] : [{ cell, expected: value, actual: found.puzzle.cells[cell] }]);
    return {
      actual: found.puzzle.cells, marked: found.markedCells, uncertain: found.uncertain,
      black: found.puzzle.black || [], wrong,
      unsafe: wrong.filter(({ cell }) => !found.uncertain.includes(cell)),
      entry: found.entries.find((entry) => entry.cell === 0 && /value$/.test(entry.kind)),
      ocrStats: found.ocrStats,
    };
  } finally {
    scanner.cancel();
  }
}

async function run() {
  const fixtures = [];
  for (const black of [false, true])
    for (const [name, pieces] of [
      ["short-cap", [[49, 28, 8, 9], [49, 41, 8, 31]]],
      ["short-foot", [[49, 28, 8, 31], [49, 63, 8, 9]]],
      ["three-pieces", [[49, 28, 8, 9], [49, 43, 8, 13], [49, 62, 8, 10]]],
    ]) fixtures.push({ name: `${name}-${black ? "inverted" : "normal"}`, pieces, black });
  fixtures.push({ name: "trailing-fragment", leading: true,
    pieces: [[49, 28, 8, 9], [49, 41, 8, 31]] });
  fixtures.push({ name: "narrow-number", narrow: true,
    pieces: [[46, 28, 4, 44], [56, 28, 4, 44]] });
  const reports = [];
  const server = spawn("python", ["-m", "http.server", "8778", "--bind", "127.0.0.1", "--directory", "_site"], { stdio: "ignore" });
  let serverError;
  server.on("error", (error) => { serverError = error; });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (serverError) throw serverError;
      try { if ((await fetch(BASE)).ok) { ready = true; break; } } catch {}
      await sleep(100);
    }
    assert.ok(ready, "Recognition regression server did not start");
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
        for (const fixture of fixtures) {
          const scan = await page.evaluate(measure, fixture);
          report.scans.push({ name: fixture.name, ...scan });
          const label = `${name}/${fixture.name}`;
          assert.deepEqual(scan.unsafe, [], `${label}: no unflagged errors`);
          assert.deepEqual(scan.black, fixture.black ? [0] : [], `${label}: unchanged black layout`);
          assert.equal(scan.actual[15], 2, `${label}: intact control clue`);
          assert.ok(scan.marked.includes(0), `${label}: printed evidence cannot disappear`);
          assert.equal(scan.entry?.y, 28, `${label}: complete crop top`);
          assert.equal(scan.entry?.h, 44, `${label}: complete crop height`);
          if (fixture.narrow) {
            assert.equal(scan.entry.glyphCount, 2, `${label}: retain both narrow glyphs`);
            assert.equal(scan.entry.recoveredMark, undefined, `${label}: intact glyphs are not damaged`);
          } else {
            assert.equal(scan.entry.recoveredMark, true, `${label}: repaired crop stays reviewable`);
            assert.ok(scan.uncertain.includes(0), `${label}: damaged clue always requires review`);
          }
          if (fixture.leading) {
            assert.equal(scan.entry.x, 27);
            assert.equal(scan.entry.w, 30);
            assert.equal(scan.entry.glyphCount, 2);
          }
          console.log(`${label}: ${scan.actual[0]}, ${scan.wrong.length} discrepancies, all flagged`);
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
    server.kill();
    fs.mkdirSync("browser-artifacts", { recursive: true });
    fs.writeFileSync("browser-artifacts/recognition-fragments.json", JSON.stringify(reports, null, 2) + "\n");
  }
}
module.exports = { run };
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
