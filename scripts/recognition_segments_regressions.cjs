/* Paired real-OCR measurements. Reference answers score results, never repair them. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { SMALL_PHONE, serve, baselineSite, engines, main } = require("./harness.cjs");
const { measure: measureQuality, qualityCases } = require("./ocr_quality_regressions.cjs");
const BASELINE = "23f7bc9e223410f5f64d749adcbce2b84be769bc";

async function measure(fixture) {
  const { Scanner } = await import("./scanner.js");
  const rows = 12, size = 1200, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#101010"; ctx.lineWidth = 2;
  for (let i = 0; i <= rows; i++) {
    ctx.beginPath(); ctx.moveTo(i * 100, 0); ctx.lineTo(i * 100, size);
    ctx.moveTo(0, i * 100); ctx.lineTo(size, i * 100); ctx.stroke();
  }
  const expected = Array(144).fill(null);
  ctx.fillStyle = "#101010";
  ctx.font = `42px ${fixture.font || "Arial"}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const values = fixture.bars ? [11, 111, 1, 7, 8] : [11, 17, 71, 111, 117, 121, 1, 7, 8];
  values.forEach((value, j) => {
    const cell = (j * 37 + 13) % 144, x = (cell % 12) * 100, y = Math.floor(cell / 12) * 100;
    expected[cell] = value;
    if (fixture.bars && j < 2) {
      const n = String(value).length;
      for (let i = 0; i < n; i++) ctx.fillRect(x + 50 - (n * 10 - 6) / 2 + i * 10, y + 28, 4, 44);
    } else {
      ctx.save(); ctx.translate(x + 50, y + 50); ctx.scale(fixture.scale || 1, 1);
      ctx.fillText(String(value), 0, 0); ctx.restore();
    }
  });
  if (!window.segmentScanner) window.segmentScanner = new Scanner();
  const found = await window.segmentScanner.read(canvas, [
    { x: 0, y: 0 }, { x: size - 1, y: 0 }, { x: size - 1, y: size - 1 }, { x: 0, y: size - 1 },
  ], "numbrix", rows, rows);
  const wrong = expected.flatMap((value, cell) => value === found.puzzle.cells[cell] ? [] : [{ cell, expected: value, actual: found.puzzle.cells[cell] }]);
  return {
    name: fixture.name, expected, actual: found.puzzle.cells,
    printed: values.length, correct: values.filter((value, j) => found.puzzle.cells[(j * 37 + 13) % 144] === value).length,
    wrong, unsafe: wrong.filter(({ cell }) => !found.uncertain.includes(cell)),
    flagged: found.uncertain, retryCount: found.retryCount, ocrStats: found.ocrStats,
    timings: found.timings, entries: found.entries.map(({ cell, text, confidence, glyphCount, segmentedRead, lengthRecovered, aspectRecovered }) =>
      ({ cell, text, confidence, glyphCount, segmentedRead, lengthRecovered, aspectRecovered })),
  };
}

async function run() {
  const site = baselineSite(BASELINE, ["scanner.js", "scan-analysis.js", "ocr-host-worker.js"]);
  const server = await serve({ directory: site.directory });
  const fixtures = [{ name: "narrow-bars", bars: true },
    ...["Arial", "Times New Roman", "Courier New", "DejaVu Sans"].flatMap((font) =>
      [1, 0.65, 0.5].map((scale) => ({ name: `${font}-${scale}`, font, scale }))),
    ...["FreeSans", "FreeSerif"].flatMap((font) =>
      [1, 0.65, 0.5].map((scale) => ({ name: `holdout-${font}-${scale}`, font, scale })))];
  try {
    await engines("recognition-segments.json", async (candidate, report, name, browser) => {
      Object.assign(report, { baseline: BASELINE, pairs: [], qualityPairs: [] });
      const baseline = await (await browser.newContext(SMALL_PHONE)).newPage();
      baseline.on("pageerror", (e) => report.errors.push(`baseline: ${e.message}`));
      const pages = { baseline, candidate };
      for (const version of ["baseline", "candidate"]) {
        await pages[version].goto(`${server.origin}/${version}/`);
        await pages[version].waitForSelector('body[data-ready="true"]');
      }
      for (const [i, fixture] of fixtures.entries()) {
        const pair = { name: fixture.name };
        // Alternate which version runs first, after both have identical fonts/assets.
        for (const version of (i % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]))
          pair[version] = await pages[version].evaluate(measure, fixture);
        report.pairs.push(pair);
        const { baseline: before, candidate: after } = pair;
        assert.deepEqual(after.unsafe, [], `${name}/${fixture.name}: no unflagged discrepancy`);
        assert.ok(after.retryCount <= 24, "the combined extra-recognition budget stays bounded");
        pair.gained = after.expected.flatMap((v, cell) => Number.isInteger(v) && after.actual[cell] === v && before.actual[cell] !== v ? [cell] : []);
        pair.lost = after.expected.flatMap((v, cell) => Number.isInteger(v) && before.actual[cell] === v && after.actual[cell] !== v ? [cell] : []);
        assert.deepEqual(pair.lost, [], `${name}/${fixture.name}: previously correct clues are retained`);
        if (!fixture.name.startsWith("holdout-")) assert.equal(after.correct, after.printed, "the original narrow-number matrix must now transcribe every clue, not merely flag it");
        console.log(`${name}/${fixture.name}: ${before.correct} -> ${after.correct}/${after.printed}; +${pair.gained.length}, -${pair.lost.length}`);
      }
      for (const page of Object.values(pages)) await page.evaluate(() => window.segmentScanner?.cancel());
      // Recheck every existing quality case against the preceding scanner.
      // The old minimum-accuracy gate allowed a previously correct clue to
      // become a flagged error. Compare individual cells, not just totals.
      const currentQuality = JSON.parse(fs.readFileSync("browser-artifacts/ocr-quality.json"))
        .find((r) => r.browser === name);
      assert.equal(currentQuality?.status, "passed", "run the existing quality suite before the paired suite");
      assert.equal(currentQuality.version, report.version, "compare the same browser version");
      const cases = qualityCases();
      assert.equal(currentQuality.scans.length, cases.length);
      for (const spec of cases) {
        const before = await pages.baseline.evaluate(measureQuality, spec);
        const after = currentQuality.scans.find((scan) =>
          scan.name === spec.fixture.name && scan.variation === spec.variation.name);
        assert.ok(after, "every baseline quality case has a candidate result");
        const priorWrong = new Set(before.wrong.map((item) => item.cell)),
          currentWrong = new Set(after.wrong.map((item) => item.cell)),
          lost = after.wrong.filter((item) => !priorWrong.has(item.cell)),
          gained = before.wrong.filter((item) => !currentWrong.has(item.cell));
        report.qualityPairs.push({ name: before.name, variation: before.variation,
          baseline: before, candidate: after, gained, lost });
        assert.deepEqual(lost, [], `${name}/${before.name}/${before.variation}: no previously correct quality cell lost`);
        assert.deepEqual(after.unsafe, []);
        console.log(`${name}/existing/${before.name}/${before.variation}: ${before.correct} -> ${after.correct}/${after.printed}`);
      }
    }, { context: SMALL_PHONE, timeout: 30000 });
  } finally {
    server.close();
    site.remove();
  }
}
module.exports = { run };
main(module, run);
