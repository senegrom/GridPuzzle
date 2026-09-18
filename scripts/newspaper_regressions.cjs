/* Real user-supplied newspaper photographs: OCR/structure safety regression. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SMALL_PHONE, serve, engines, main } = require("./harness.cjs");

const ROOT = path.resolve("Examples/BrowserScanner/Newspaper");
const TRUTH = JSON.parse(fs.readFileSync(path.join(ROOT, "ground-truth.json"), "utf8"));

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

async function run() {
  const server = await serve({ pages: true });
  try {
    await engines("newspaper-regressions.json", async (page, report) => {
      report.scans = [];
      await page.goto(server.base);
      await ready(page);
      for (const fixture of TRUTH.fixtures)
        report.scans.push(assess(fixture, await scan(page, fixture)));
    }, { context: SMALL_PHONE });
  } finally {
    server.close();
  }
  await require("./ocr_quality_regressions.cjs").run();
}
module.exports = { run };
main(module, run);
