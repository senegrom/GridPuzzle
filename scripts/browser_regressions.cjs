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
  ctx.fillRect(0, 0, 660, 660);
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
  if (["baseline", "binary", "multi-digit"].includes(name))
    assert.deepEqual(
      wrong,
      [],
      `${name} must read every clue, not solve a weaker transcription`,
    );
  return result;
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
      report.checks.push("save-and-next confirms only the edited cell");
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
