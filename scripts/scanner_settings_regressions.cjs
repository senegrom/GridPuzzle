/* Real UI/solver regressions with deterministic scanner results, not OCR tests. */
const assert = require("node:assert/strict");
const { serve, engines, main } = require("./harness.cjs");

async function setup(page, base) {
  await page.goto(base);
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
async function exercise(page, base) {
  const image = await setup(page, base);
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

  // Invalid Sudoku inputs become hidden when the family is changed. Read
  // must ignore them for non-boxed families, while still rejecting them for
  // Sudoku and Killer Sudoku. OCR completions remain controlled in this gate.
  await page.evaluate(async () => {
    settingsApp.loadPuzzle(settingsModel.makePuzzle("sudoku", 6));
    settingsMode = { rows: 6, cols: 6, type: "sudoku" };
    document.getElementById("auto-solve").checked = false;
    window.settingsReads = 0;
    const { Scanner } = await import("./scanner.js");
    Scanner.prototype.read = async (_photo, _corners, type, rows, cols) => {
      settingsReads++;
      const rectified = document.createElement("canvas"); rectified.width = rectified.height = 600;
      return { puzzle: settingsModel.makePuzzle(type, rows, cols), uncertain: [], cageUncertain: [],
        needsReview: true, notes: [], rectified };
    };
  });
  await page.locator("#layout-settings").evaluate(el => { el.open = true; });
  for (const type of ["latinsquare", "futoshiki", "numbrix", "hidato", "kenken", "kakuro", "slitherlink", "str8ts"]) {
    await page.selectOption("#puzzle-type", "sudoku");
    await photograph(page, image, `hidden-boxes-${type}`);
    await page.fill("#box-rows", ""); await page.fill("#box-cols", "");
    await page.selectOption("#puzzle-type", type);
    assert.equal(await page.locator("#box-fields").isHidden(), true);
    await page.click("#read-photo");
    await page.waitForFunction(() => document.getElementById("status-text").textContent === "Puzzle read.");
    assert.equal(await page.evaluate(() => settingsApp.getState().puzzle.type), type);
  }
  assert.equal(await page.evaluate(() => settingsReads), 8);
  for (const type of ["sudoku", "killersudoku"]) {
    await page.selectOption("#puzzle-type", type);
    await photograph(page, image, `invalid-boxes-${type}`);
    await page.fill("#box-rows", ""); await page.fill("#box-cols", "");
    await page.click("#read-photo");
    await page.waitForFunction(() => /Board dimensions/.test(document.getElementById("status-text").textContent));
  }
  assert.equal(await page.evaluate(() => settingsReads), 8, "boxed-family preflight must still reject invalid settings");
  return image;
}
async function run() {
  const server = await serve({ pages: true });
  try {
    await engines("scanner-settings.json", async (page, report, name) => {
      const image = await exercise(page, server.base);
      report.detection = await require("./detect_benchmark_regressions.cjs")(name, image);
      report.hiddenBoxes = "passed";
      console.log(`${name}: scanner settings, correction, undo and solver regressions passed`);
    });
  } finally {
    server.close();
  }
}
module.exports = { run };
main(module, run);
