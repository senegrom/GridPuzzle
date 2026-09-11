/* Additional real-browser scanner and input-boundary regressions. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8766/GridPuzzle/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle"))
  fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn(
  "python",
  [
    "-m",
    "http.server",
    "8766",
    "--bind",
    "127.0.0.1",
    "--directory",
    "_preview",
  ],
  { stdio: "ignore" },
);
const reports = [];

// Draw known clues without reading any production OCR output. The perspective
// fixture is a projective transform of the entire image, not just a CSS tilt.
async function fixture(options) {
  const { demo } = await import("./model.js");
  const { homography, project } = await import("./geometry.js");
  const small = options.small || options.path,
    n = small ? 4 : 9,
    boxRows = small ? 2 : 3,
    boxCols = small ? 2 : 3;
  const cells = options.path
    ? [1, null, null, 4, 8, null, 6, null, null, 10, null, 12, 16, null, null, null]
    : small
    ? [1, null, 3, 4, 3, 4, null, 2, 2, 1, 4, null, null, 3, 2, 1]
    : demo().cells;
  const c = document.createElement("canvas");
  c.width = c.height = 660;
  const ctx = c.getContext("2d"),
    cw = 576 / n;
  ctx.fillStyle = "white";
  if (!options.transparent) ctx.fillRect(0, 0, 660, 660);
  ctx.strokeStyle = "black";
  for (let i = 0; i <= n; i++) {
    ctx.lineWidth = i % boxCols === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(42 + i * cw, 42);
    ctx.lineTo(42 + i * cw, 618);
    ctx.stroke();
    ctx.lineWidth = i % boxRows === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(42, 42 + i * cw);
    ctx.lineTo(618, 42 + i * cw);
    ctx.stroke();
  }
  ctx.font = `${small ? 70 : 38}px ${options.font || "Arial"}`;
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  cells.forEach((v, i) => {
    if (v !== null)
      ctx.fillText(
        String(v),
        42 + ((i % n) + 0.5) * cw + (options.shiftX || 0),
        42 + (Math.floor(i / n) + 0.5) * cw + 1 + (options.shiftY || 0),
      );
  });
  let output = c;
  if (options.perspective) {
    output = document.createElement("canvas");
    output.width = output.height = 760;
    const out = output.getContext("2d"),
      image = out.createImageData(760, 760),
      source = ctx.getImageData(0, 0, 660, 660);
    const m = homography([
      { x: 52, y: 95 },
      { x: 660, y: 30 },
      { x: 724, y: 659 },
      { x: 19, y: 712 },
    ]);
    const [a, b, k, d, e, f, g, h] = m,
      I = a * e - b * d;
    const inverse = [
      e - f * h,
      k * h - b,
      b * f - k * e,
      f * g - d,
      a - k * g,
      k * d - a * f,
      d * h - e * g,
      b * g - a * h,
    ].map((x) => x / I);
    for (let y = 0; y < 760; y++)
      for (let x = 0; x < 760; x++) {
        const p = project(inverse, x, y),
          at = (y * 760 + x) * 4;
        const value =
          p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1
            ? 255
            : source.data[
                (Math.round(p.y * 659) * 660 + Math.round(p.x * 659)) * 4
              ];
        const shaded = value * (0.6 + (0.4 * x) / 759);
        image.data[at] = image.data[at + 1] = image.data[at + 2] = shaded;
        image.data[at + 3] = 255;
      }
    out.putImageData(image, 0, 0);
  }
  if (options.binary) {
    // Match the production rectification size exactly so interpolation cannot
    // hide a threshold-zero regression by introducing intermediate greys.
    output = document.createElement("canvas");
    output.width = output.height = n * 100;
    const out = output.getContext("2d");
    out.fillStyle = "white";
    out.fillRect(0, 0, output.width, output.height);
    out.fillStyle = "black";
    for (let i = 0; i <= n; i++) {
      const at = Math.min(output.width - 1, i * 100);
      out.fillRect(at, 0, 2, output.height);
      out.fillRect(0, at, output.width, 2);
    }
    out.font = "52px Arial";
    out.textAlign = "center";
    out.textBaseline = "middle";
    cells.forEach((v, i) => {
      if (v !== null) out.fillText(String(v), (i % n + 0.5) * 100, (Math.floor(i / n) + 0.5) * 100);
    });
    const pixels = out.getImageData(0, 0, output.width, output.height);
    for (let i = 0; i < pixels.data.length; i += 4)
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = pixels.data[i] < 128 ? 0 : 255;
    out.putImageData(pixels, 0, 0);
  }
  return { image: output.toDataURL("image/png").split(",")[1], cells, n, type: options.path ? "numbrix" : "sudoku" };
}
async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async () => {
    window.testState = (await import("./app.js")).getState;
  });
}
async function scan(page, name, options) {
  const f = await page.evaluate(fixture, options);
  await page.evaluate(async () => {
    const app = await import("./app.js"),
      { makePuzzle } = await import("./model.js");
    app.loadPuzzle(makePuzzle());
  });
  await page.selectOption("#puzzle-type", f.type === "sudoku" ? "auto" : f.type);
  await page.locator("#auto-solve").evaluate((el) => {
    el.checked = false;
  });
  const start = Date.now();
  if (options.fallback)
    await page.evaluate(() => {
      window.testImageBitmap = window.createImageBitmap;
      window.createImageBitmap = undefined;
    });
  try {
    await page.setInputFiles("#photo-file", {
      name: `${name}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(f.image, "base64"),
    });
    await page.waitForFunction(
      () =>
        /^(Grid found\.|Set the four crop corners\.)$/.test(
          document.querySelector("#status-text").textContent,
        ),
      null,
      { timeout: 20000 },
    );
  } finally {
    if (options.fallback)
      await page.evaluate(() => {
        window.createImageBitmap = window.testImageBitmap;
        delete window.testImageBitmap;
      });
  }
  assert.equal(
    Number(await page.inputValue("#rows")),
    f.n,
    `${name}: detected rows`,
  );
  assert.equal(
    Number(await page.inputValue("#cols")),
    f.n,
    `${name}: detected columns`,
  );
  if (options.layout) {
    await page.click("#clean-view");
    await page.selectOption("#edit-tool", "value");
    assert.equal(await page.inputValue("#rows"), "4", "Board preserves detected rows");
    assert.equal(await page.inputValue("#cols"), "4", "Board preserves detected columns");
    assert.equal(await page.inputValue("#box-rows"), "2", "Board preserves detected boxes");
    if (!await page.locator("#rows").isVisible())
      await page.getByText("Grid size & settings", { exact: true }).click();
    await page.fill("#rows", "");
    await page.fill("#box-rows", "1");
    await page.fill("#box-cols", "4");
    await page.click("#clean-view");
    assert.equal(await page.inputValue("#rows"), "", "incomplete layout input remains editable");
    assert.equal(await page.inputValue("#box-rows"), "1");
    assert.equal(await page.inputValue("#box-cols"), "4");
    await page.fill("#rows", "4");
  }
  await page.click("#read-photo");
  await page.waitForFunction(() => !window.testState().busy, null, {
    timeout: 120000,
  });
  const s = await page.evaluate(() => window.testState());
  assert.equal(s.puzzle.type, f.type, `${name}: unexpected puzzle type`);
  const wrong = f.cells.flatMap((v, i) => (v !== s.puzzle.cells[i] ? [i] : []));
  const unsafe = wrong.filter((i) => !s.uncertain.includes(i));
  const given = f.cells.filter(Number.isInteger).length,
    correct = f.cells.filter(
      (v, i) => v !== null && v === s.puzzle.cells[i],
    ).length;
  const result = {
    name,
    givens: given,
    correct,
    discrepancies: wrong,
    unsafe,
    flagged: s.uncertain.length,
    elapsedMs: Date.now() - start,
  };
  console.log(JSON.stringify(result));
  assert.deepEqual(unsafe, [], `${name}: wrong/missing clue not flagged`);
  assert.ok(
    correct >= given - 2,
    `${name}: ${correct}/${given} clues read correctly`,
  );
  if (["baseline", "binary", "multi-digit", "transparent", "transparent-fallback", "layout-draft"].includes(name))
    assert.deepEqual(
      wrong,
      [],
      `${name} must read every clue, not solve a weaker transcription`,
    );
  if (options.layout) {
    assert.equal(s.puzzle.rows, 4);
    assert.equal(s.puzzle.cols, 4);
    assert.equal(s.puzzle.boxRows, 1);
    assert.equal(s.puzzle.boxCols, 4);
    await page.click("#undo");
    assert.equal((await page.evaluate(() => window.testState())).puzzle.rows, 9);
    assert.equal(await page.inputValue("#rows"), "4", "Undo preserves the pending photo layout");
    assert.equal(await page.inputValue("#box-rows"), "1");
    assert.equal(await page.inputValue("#box-cols"), "4");
  }
  return result;
}
async function layoutAndKeyboardRegressions(page, report) {
  await page.selectOption("#puzzle-type", "futoshiki");
  await page.click("#example");
  if (!await page.locator("#rows").isVisible())
    await page.getByText("Grid size & settings", { exact: true }).click();
  const original = await page.evaluate(() => window.testState().puzzle);
  assert.equal(await page.locator("#box-fields").isVisible(), false);
  await page.selectOption("#puzzle-type", "sudoku");
  assert.equal(await page.locator("#box-fields").isVisible(), true);
  await page.fill("#rows", "9");
  await page.fill("#cols", "9");
  await page.fill("#box-rows", "3");
  await page.fill("#box-cols", "3");
  for (const [type, visible] of [["kenken", false], ["killersudoku", true], ["auto", true], ["sudoku", true]]) {
    await page.selectOption("#puzzle-type", type);
    await page.click("#clean-view");
    assert.equal(await page.locator("#box-fields").isVisible(), visible, `${type}: next-scan box controls`);
    assert.equal(await page.inputValue("#box-rows"), "3");
    assert.equal(await page.inputValue("#box-cols"), "3");
    assert.deepEqual(await page.evaluate(() => window.testState().puzzle), original,
      "selecting the next scan type leaves the current board intact");
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#apply-layout");
  const applied = await page.evaluate(() => window.testState().puzzle);
  assert.deepEqual([applied.type, applied.rows, applied.cols, applied.boxRows, applied.boxCols],
    ["sudoku", 9, 9, 3, 3]);
  await page.click("#undo");
  assert.deepEqual(await page.evaluate(() => window.testState().puzzle), original);
  assert.equal(await page.locator("#box-fields").isVisible(), true,
    "Undo refreshes controls for the selected scan type, not the restored board type");
  report.checks.push("scan-type changes expose box settings and preserve layout drafts through apply and Undo");

  const focusedCell = () => page.evaluate(() => document.activeElement?.getAttribute("data-cell"));
  const selectedCells = () => page.locator(".board-cell.selected").evaluateAll(
    (cells) => cells.map((cell) => Number(cell.dataset.cell)));
  for (const [type, tool] of [["futoshiki", "inequality"], ["kenken", "cage"]]) {
    await page.selectOption("#puzzle-type", type);
    await page.click("#example");
    await page.selectOption("#edit-tool", tool);
    await page.locator('[data-cell="4"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await focusedCell(), "4", `${tool}: Enter keeps focus on the selected cell`);
    assert.equal(await page.locator('[data-cell="4"]').getAttribute("tabindex"), "0");
    await page.keyboard.press("ArrowRight");
    assert.equal(await focusedCell(), "5");
    await page.keyboard.press("Space");
    assert.deepEqual(await selectedCells(), [4, 5]);
    assert.equal(await focusedCell(), "5", `${tool}: Space keeps focus after extending selection`);
    await page.keyboard.press("Space");
    assert.deepEqual(await selectedCells(), [4]);
    assert.equal(await focusedCell(), "5", `${tool}: deselection also keeps focus`);
    await page.keyboard.press("Enter");
    if (tool === "inequality") {
      await page.click("#save-inequality");
      const puzzle = await page.evaluate(() => window.testState().puzzle);
      assert.ok(puzzle.inequalities.some((q) => q.less === 4 && q.greater === 5));
    } else {
      await page.fill("#cage-target", "7");
      await page.selectOption("#cage-op", "+");
      await page.click("#save-cage");
      const puzzle = await page.evaluate(() => window.testState().puzzle);
      assert.deepEqual(puzzle.cages.find((cage) => cage.cells.includes(4)),
        { cells: [4, 5], target: 7, op: "+" });
    }
    assert.deepEqual(await selectedCells(), []);
  }
  report.checks.push("keyboard Enter/Space selection, arrows, deselection and saving work for cages and inequalities");

  await page.selectOption("#puzzle-type", "sudoku");
  await page.click("#example");
  await page.selectOption("#edit-tool", "value");
  await page.locator('[data-cell="10"]').focus();
  await page.keyboard.press("Enter");
  await page.fill("#cell-value", "2");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#cell-dialog").isVisible(), false);
  assert.equal((await page.evaluate(() => window.testState().puzzle)).cells[10], 2);
  assert.equal(await focusedCell(), "10", "saving a clue restores focus to its rendered cell");
  await page.keyboard.press("ArrowRight");
  assert.equal(await focusedCell(), "11", "arrows continue navigating after saving a clue");
  await page.keyboard.press("Enter");
  await page.click("#clear-cell");
  assert.equal(await page.locator("#cell-dialog").isVisible(), false);
  assert.equal(await focusedCell(), "11", "clearing a clue restores focus to its rendered cell");
  await page.keyboard.press("ArrowDown");
  assert.equal(await focusedCell(), "20", "arrows continue navigating after clearing a clue");
  report.checks.push("saving and clearing clues return keyboard focus to the board");
}
async function importedBoardTypeRegressions(page, report) {
  for (const [size, boxes, expected] of [
    [4, null, [2, 2]],
    [6, null, [2, 3]],
    [4, [3, 3], [2, 2]], // Old autosaves supplied these defaults to every family.
    [6, [3, 2], [3, 2]],
  ]) {
    const before = await page.evaluate(async ({ size, boxes }) => {
      const { loadPuzzle } = await import("./app.js");
      const { makePuzzle } = await import("./model.js");
      const puzzle = makePuzzle("latinsquare", size);
      puzzle.cells[0] = size;
      delete puzzle.boxRows;
      delete puzzle.boxCols;
      if (boxes) [puzzle.boxRows, puzzle.boxCols] = boxes;
      loadPuzzle(puzzle);
      return window.testState().puzzle;
    }, { size, boxes });
    await page.selectOption("#puzzle-type", "sudoku");
    await page.click("#use-type");
    const after = await page.evaluate(() => window.testState().puzzle);
    assert.equal(after.type, "sudoku", `${size}x${size}: imported board changes rules`);
    assert.deepEqual([after.boxRows, after.boxCols], expected);
    assert.deepEqual(after.cells, before.cells, "changing rules keeps every printed clue");
    assert.equal(await page.inputValue("#box-rows"), String(expected[0]));
    assert.equal(await page.inputValue("#box-cols"), String(expected[1]));
    await page.click("#undo");
    assert.deepEqual(await page.evaluate(() => window.testState().puzzle), before);
  }
  report.checks.push("imported and legacy non-9x9 boards change to Sudoku with compatible boxes and intact clues");
}
async function editorRegressions(page, report) {
  await page.evaluate(async () => {
    const { makePuzzle } = await import("./model.js");
    const puzzle = makePuzzle("killersudoku", 4);
    puzzle.cells[0] = 1;
    puzzle.cells[2] = 3;
    localStorage.setItem("gridpuzzle-session-v1", JSON.stringify({
      puzzle, uncertain: [0, 1, 2, 3], cellUncertain: [0, 2],
      cageUncertain: [0, 1, 2, 3], needsReview: true, notes: [],
    }));
  });
  await page.reload();
  await ready(page);
  await page.selectOption("#edit-tool", "cage");
  await page.click('[data-cell="0"]');
  await page.click('[data-cell="1"]');
  await page.fill("#cage-target", "3");
  await page.click("#save-cage");
  let review = await page.evaluate(() => window.testState());
  assert.deepEqual(review.cellUncertain, [0, 2], "saving a cage must not confirm its digits");
  assert.deepEqual(review.cageUncertain, [2, 3]);
  assert.match(await page.locator('[data-cell="0"]').getAttribute("aria-label"), /check reading/);
  await page.click("#undo");
  review = await page.evaluate(() => window.testState());
  assert.deepEqual(review.cageUncertain, [0, 1, 2, 3], "undo restores cage warnings");
  await page.selectOption("#edit-tool", "value");
  await page.click("#review-clues");
  await page.click("#save-next");
  assert.equal(await page.locator("#cell-title").innerText(), "Row 1 · Column 3");
  await page.click("#close-cell");
  review = await page.evaluate(() => window.testState());
  assert.deepEqual(review.cellUncertain, [2]);
  assert.deepEqual(review.cageUncertain, [0, 1, 2, 3], "saving a digit must not confirm its cage");
  await page.reload();
  await ready(page);
  review = await page.evaluate(() => window.testState());
  assert.deepEqual(review.cellUncertain, [2]);
  assert.deepEqual(review.cageUncertain, [0, 1, 2, 3]);
  report.checks.push("independent cell/cage review survives editing, undo and reload");

  await page.selectOption("#puzzle-type", "sudoku");
  await page.click("#example");
  await page.click("#data-editor > summary");
  const draft = JSON.parse(await page.inputValue("#json-data"));
  draft.cells[2] = 4;
  const text = JSON.stringify(draft);
  await page.fill("#json-data", text);
  await page.click("#clean-view");
  assert.equal(await page.inputValue("#json-data"), text, "a view change preserves the JSON draft");
  await page.click("#solve");
  await page.waitForFunction(() => window.testState().result?.status === "unique", null, { timeout: 180000 });
  assert.equal(await page.inputValue("#json-data"), text, "a solver result preserves the JSON draft");
  assert.equal(await page.locator('[data-cell="2"] text').textContent(), "4");
  assert.equal(await page.locator('[data-cell="2"]').getAttribute("aria-label"), "Row 1, column 3: solution 4");
  assert.equal(await page.locator('[data-cell="0"]').getAttribute("aria-label"), "Row 1, column 1: 5");
  await page.click("#apply-json");
  assert.equal((await page.evaluate(() => window.testState().puzzle)).cells[2], 4);
  assert.equal(await page.locator('[data-cell="2"]').getAttribute("aria-label"), "Row 1, column 3: 4");
  await page.fill("#json-data", "{unfinished");
  await page.click("#clean-view");
  await page.click("#apply-json");
  assert.equal(await page.inputValue("#json-data"), "{unfinished", "invalid drafts remain editable");
  await page.click("#example");
  assert.equal(JSON.parse(await page.inputValue("#json-data")).cells[2], null, "explicit loading starts a fresh draft");
  report.checks.push("JSON drafts survive view/solver refreshes and apply explicitly");
  report.checks.push("solved cells expose answers and distinguish printed clues");

  await page.selectOption("#puzzle-type", "kakuro");
  await page.click("#example");
  for (const clue of await page.evaluate(() => window.testState().puzzle.clues)) {
    const label = await page.locator(`[data-cell="${clue.cell}"]`).getAttribute("aria-label");
    for (const direction of ["across", "down"])
      if (clue[direction] != null) assert.ok(label.includes(`${direction} ${clue[direction]}`));
  }
  report.checks.push("Kakuro black-cell labels include their across/down targets");
  await page.selectOption("#puzzle-type", "sudoku");
  await page.click("#example");

  // Delay the actual file-reading handler so a later UI action supersedes it.
  await page.evaluate(() => {
    const input = document.querySelector("#json-file");
    const pending = window.pendingImport = { text: File.prototype.text, handler: input.onchange };
    File.prototype.text = () => new Promise((resolve) => { pending.release = resolve; });
    input.onchange = (event) => { pending.completed = pending.handler(event); };
  });
  try {
    await page.setInputFiles("#json-file", { name: "old.json", mimeType: "application/json", buffer: Buffer.from("{invalid") });
    await page.waitForFunction(() => Boolean(window.pendingImport.release));
    await page.click("#example");
    const status = await page.locator("#status").innerText();
    await page.evaluate(async () => {
      window.pendingImport.release("{invalid");
      await window.pendingImport.completed;
    });
    assert.equal(await page.locator("#status").innerText(), status, "a superseded import cannot replace the current status");
  } finally {
    await page.evaluate(() => {
      File.prototype.text = window.pendingImport.text;
      document.querySelector("#json-file").onchange = window.pendingImport.handler;
      delete window.pendingImport;
    });
  }
  report.checks.push("superseded JSON import errors are ignored");
}
async function installControlledCamera(page) {
  // Controlled media and queued timers exercise the real application's task
  // wiring in both engines, without depending on CI camera hardware.
  await page.evaluate(() => {
    // Some WebKit ports (Windows) expose no media capture at all; give
    // them the same stub surface so the lifecycle check still runs.
    const installedMedia = !navigator.mediaDevices;
    if (installedMedia)
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    const video = document.querySelector("#video"), media = navigator.mediaDevices;
    const original = Object.getOwnPropertyDescriptor(media, "getUserMedia");
    const timeout = window.setTimeout;
    const camera = window.cameraTest = { stopped: 0, queued: [] };
    Object.defineProperty(media, "getUserMedia", { configurable: true, value: async () => ({
      getTracks: () => [{ stop() { camera.stopped++; } }],
    }) });
    Object.defineProperty(video, "srcObject", { configurable: true, writable: true, value: null });
    Object.defineProperty(video, "play", { configurable: true, value: async () => {} });
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 800 || ms === 900 || (ms === 100 && fn.name === "tick")) { camera.queued.push(fn); return -1; }
      return timeout(fn, ms, ...args);
    };
    camera.restore = () => {
      window.setTimeout = timeout;
      delete video.srcObject;
      delete video.play;
      if (original) Object.defineProperty(media, "getUserMedia", original);
      else delete media.getUserMedia;
      if (installedMedia) delete navigator.mediaDevices;
      delete window.cameraTest;
    };
  });
}
async function cameraOwnershipRegressions(page, report) {
  await page.selectOption("#puzzle-type", "sudoku");
  await page.click("#example");
  const before = await page.evaluate(() => window.testState().puzzle);
  await installControlledCamera(page);
  try {
    for (const action of ["edit", "solve"]) {
      await page.click("#camera");
      await page.waitForFunction(() => document.querySelector("#status-text").textContent === "Camera ready.");
      // The live view is now full-screen. Invoke the actual editor handlers
      // without a pointer hit-test through that overlay; the streamed-camera
      // suite covers the user's visible Close/Review controls separately.
      if (action === "edit") await page.dispatchEvent('[data-cell="0"]', "click");
      else await page.dispatchEvent("#solve", "click");
      assert.equal(await page.locator("#camera-panel").isHidden(), true, `${action} closes the camera`);
      assert.equal(await page.evaluate(() => window.cameraTest.stopped), action === "edit" ? 1 : 2);
      await page.evaluate(async () => {
        const pending = window.cameraTest.queued.splice(0);
        for (const fn of pending) await fn();
      });
      assert.deepEqual(await page.evaluate(() => window.testState().puzzle), before);
      assert.equal(await page.evaluate(() => window.cameraTest.queued.length), 0, "cancelled capture never restarts");
      if (action === "edit") await page.click("#close-cell");
      else {
        await page.waitForFunction(() => window.testState().result?.status === "unique", null, { timeout: 180000 });
      }
    }
  } finally {
    await page.evaluate(() => window.cameraTest.restore());
  }
  report.checks.push("editing and solving stop live capture, including already queued detection callbacks");
}
async function confirmationRegressions(page, report) {
  await page.evaluate(async () => {
    const { demo } = await import("./model.js");
    localStorage.setItem("gridpuzzle-session-v1", JSON.stringify({
      puzzle: demo(), cellUncertain: [0], needsReview: true, notes: [],
    }));
  });
  await page.reload();
  await ready(page);
  const before = await page.evaluate(() => window.testState());
  await installControlledCamera(page);
  try {
    let stopped = 0;
    for (const action of ["back", "escape", "confirm"]) {
      await page.click("#camera");
      await page.waitForFunction(() => document.querySelector("#status-text").textContent === "Camera ready.");
      await page.dispatchEvent("#solve", "click");
      assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
      assert.equal(await page.locator("#camera-panel").isHidden(), true,
        "capture must stop before confirmation, not after accepting it");
      assert.equal(await page.evaluate(() => window.cameraTest.stopped), ++stopped);
      await page.evaluate(async () => {
        const pending = window.cameraTest.queued.splice(0);
        for (const fn of pending) await fn();
      });
      assert.equal(await page.evaluate(() => window.cameraTest.queued.length), 0);
      assert.deepEqual(await page.evaluate(() => window.testState()), before,
        "opening confirmation preserves the board and its review flags");
      if (action === "back") await page.click("#confirm-back");
      else if (action === "escape") await page.keyboard.press("Escape");
      else await page.click("#confirm-solve");
    }
    await page.waitForFunction(() => window.testState().result?.status === "unique", null, { timeout: 180000 });
    assert.deepEqual(await page.evaluate(() => window.testState().puzzle), before.puzzle);
  } finally {
    await page.evaluate(() => window.cameraTest.restore());
  }
  // A replacement board invalidates the modal. An old confirmation must not
  // implicitly accept a transcription that was never shown in that dialog.
  await page.evaluate((puzzle) => {
    localStorage.setItem("gridpuzzle-session-v1", JSON.stringify({
      puzzle, cellUncertain: [0], needsReview: true, notes: [],
    }));
  }, before.puzzle);
  await page.reload();
  await ready(page);
  await page.click("#solve");
  const replacement = await page.evaluate(async () => {
    const { loadPuzzle } = await import("./app.js");
    const { demo } = await import("./model.js");
    loadPuzzle(demo("str8ts"));
    return window.testState().puzzle;
  });
  await page.click("#confirm-solve");
  const stale = await page.evaluate(() => window.testState());
  assert.equal(stale.busy, false);
  assert.equal(stale.result, null);
  assert.deepEqual(stale.puzzle, replacement);
  assert.match(await page.locator("#status-text").innerText(), /Puzzle changed/);
  await page.click("#solve");
  await page.waitForFunction(() => window.testState().result?.status === "unique", null, { timeout: 180000 });
  report.checks.push("confirmation stops capture, preserves unchecked clues on dismissal, and rejects a replaced puzzle");
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
    const report = {
      browser: name,
      version: browser.version(),
      scans: [],
      checks: [],
      errors: [],
    };
    reports.push(report);
    page.on("pageerror", (e) => report.errors.push(e.message));
    try {
      await page.goto(BASE);
      await ready(page);
      // Exercise the real import handler, not just the pure validator. A tiny
      // positive box increment used to hang render/conflict loops.
      await page.click("#example");
      const before = await page.evaluate(() => window.testState().puzzle);
      const invalid = { ...before, boxRows: 1e-12 };
      await page.setInputFiles("#json-file", {
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(invalid)),
      });
      await page.waitForFunction(() =>
        document.querySelector("#status").classList.contains("error"),
      );
      assert.deepEqual(
        await page.evaluate(() => window.testState().puzzle),
        before,
      );
      report.checks.push(
        "malformed imports rejected without modifying the board",
      );
      // Seed saved review metadata through the documented data-only local store.
      await page.evaluate(
        (p) =>
          localStorage.setItem(
            "gridpuzzle-session-v1",
            JSON.stringify({
              puzzle: p,
              uncertain: [0, 1],
              needsReview: true,
              notes: [],
            }),
          ),
        before,
      );
      await page.reload();
      await ready(page);
      await page.click("#review-clues");
      assert.equal(
        await page.locator("#cell-title").innerText(),
        "Row 1 · Column 1",
      );
      await page.click("#save-next");
      assert.equal(
        await page.locator("#cell-title").innerText(),
        "Row 1 · Column 2",
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "cell-value",
        "Save & next keeps focus in the next clue editor",
      );
      assert.deepEqual(
        (await page.evaluate(() => window.testState())).uncertain,
        [1],
      );
      await page.click("#save-next");
      assert.deepEqual(
        (await page.evaluate(() => window.testState())).uncertain,
        [],
      );
      assert.equal(
        (await page.evaluate(() => window.testState())).needsReview,
        true,
      );
      assert.equal(await page.locator("#cell-dialog").isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-cell")),
        "1",
        "finishing guided review restores focus to the last edited cell",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-cell")),
        "2",
        "arrows continue navigating after guided review",
      );
      report.checks.push("save-and-next confirms only the edited cell");
      await layoutAndKeyboardRegressions(page, report);
      await importedBoardTypeRegressions(page, report);
      await editorRegressions(page, report);
      await cameraOwnershipRegressions(page, report);
      await confirmationRegressions(page, report);
      // No OCR call should be needed to reject a blank photograph.
      const blank = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = c.height = 400;
        const x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 400, 400);
        return c.toDataURL().split(",")[1];
      });
      await page.setInputFiles("#photo-file", {
        name: "blank.png",
        mimeType: "image/png",
        buffer: Buffer.from(blank, "base64"),
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#status-text").textContent ===
          "Set the four crop corners.",
      );
      await page.click("#read-photo");
      await page.waitForFunction(() => !window.testState().busy);
      assert.match(
        await page.locator("#status-text").innerText(),
        /No printed clues/,
      );
      report.checks.push("blank photo rejected without inventing clues");
      for (const [label, options] of [
        ["baseline", {}],
        ["serif", { font: "Georgia" }],
        ["shifted", { shiftX: 4, shiftY: -4 }],
        ["perspective-shadow", { perspective: true }],
        ["four-by-four", { small: true }],
        ["layout-draft", { small: true, layout: true }],
        ["transparent", { small: true, transparent: true }],
        ["transparent-fallback", { small: true, transparent: true, fallback: true }],
        ["binary", { small: true, binary: true }],
        ["multi-digit", { path: true }],
      ])
        report.scans.push(await scan(page, label, options));
      await page.screenshot({
        path: `browser-artifacts/${name}-scanner-improved.png`,
        fullPage: true,
      });
      assert.deepEqual(report.errors, []);
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.failure = error.stack;
      console.error(name, error);
      try {
        report.status = await page.locator("#status").innerText();
        await page.screenshot({
          path: `browser-artifacts/${name}-regression-failure.png`,
          fullPage: true,
        });
      } catch {}
    } finally {
      await browser.close();
      fs.writeFileSync(
        "browser-artifacts/recognition-regressions.json",
        JSON.stringify(reports, null, 2),
      );
    }
  }
  if (reports.some((r) => !r.ok)) process.exitCode = 1;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.kill());
