/* Real Play dialogs and Pyodide; delayed callbacks are controlled explicitly. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BASE = "http://127.0.0.1:8771/GridPuzzle/";
fs.mkdirSync("_preview", { recursive: true });
fs.mkdirSync("browser-artifacts", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle")) fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
const server = spawn("python", ["-m", "http.server", "8771", "--bind", "127.0.0.1", "--directory", "_preview"], { stdio: "ignore" });
const reports = [];
async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async () => { window.playApp = await import("./app.js"); });
}
async function seed(page, { review = true, play = [null, 1, null, null], blank = false } = {}) {
  await page.evaluate(async ({ review, play, blank }) => {
    const { makePuzzle } = await import("./model.js"), puzzle = makePuzzle("latinsquare", 2);
    if (!blank) puzzle.cells[0] = 1;
    localStorage.setItem("gridpuzzle-session-v1", JSON.stringify({
      puzzle, play, needsReview: review, cellUncertain: review ? [1] : [], cageUncertain: [], notes: [],
    }));
    localStorage.setItem("gridpuzzle-settings-v2", JSON.stringify({ editing: "play", type: "auto", limit: "30" }));
  }, { review, play, blank });
  await page.reload(); await ready(page);
}
const state = (page) => page.evaluate(() => playApp.getState());
const text = (page) => page.textContent("#status-text");
async function done(page, pattern) {
  await page.waitForFunction((pattern) => !playApp.getState().busy && new RegExp(pattern).test(document.getElementById("status-text").textContent), pattern, { timeout: 180000 });
}
async function enter(page, index, value) {
  await page.click(`[data-cell="${index}"]`);
  await page.fill("#cell-value", String(value)); await page.click("#save-cell");
  await page.waitForFunction(() => !document.getElementById("cell-dialog").open);
}
async function exercise(page, report) {
  await page.addInitScript(() => {
    window.playRequests = 0; window.heldPlay = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.puzzle) {
        window.playRequests++;
        if (window.holdPlay) {
          window.heldPlay.push({ message, handler: this.onmessage });
          return;
        }
      }
      return post.call(this, message, ...rest);
    };
  });
  await page.goto(BASE); await ready(page); await seed(page);
  const before = await state(page);
  await page.click("#check-play");
  assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
  assert.match(await page.textContent("#confirm-solve"), /check answers/);
  assert.equal(await page.evaluate(() => playRequests), 0);
  await page.click("#confirm-back");
  assert.deepEqual(await state(page), before);
  await page.click("#hint-play"); await page.keyboard.press("Escape");
  assert.deepEqual(await state(page), before);
  assert.equal(await page.evaluate(() => playRequests), 0);
  report.checks.push("Check and Hint require scan confirmation; Back and Escape preserve uncertainty and answers");

  await page.click("#hint-play");
  assert.match(await page.textContent("#confirm-solve"), /one hint/);
  await page.click("#confirm-solve"); await done(page, "^Hint:");
  let s = await state(page);
  assert.equal(s.play[1], 2); assert.deepEqual(s.hints, [1]);
  assert.equal(s.result, null); assert.equal(s.playing, true);
  assert.equal(s.needsReview, false); assert.deepEqual(s.cellUncertain, []);
  assert.deepEqual(s.puzzle, before.puzzle);
  await page.click("#check-play"); await done(page, "^1 right · 0 wrong · 2 to go$");
  report.checks.push("confirmed Hint uses the real unique solution privately and later Check stays private");

  await seed(page); await page.click("#check-play"); await page.click("#confirm-solve");
  await done(page, "^0 right · 1 wrong · 2 to go$");
  s = await state(page); assert.deepEqual(s.playWrong, [1]); assert.equal(s.result, null); assert.equal(s.playing, true);
  report.checks.push("confirmed Check resumes checking, not Reveal");

  await seed(page, { play: [null, 2, 2, null] }); await enter(page, 3, 1);
  assert.equal(await page.locator("#confirm-dialog").isVisible(), true);
  assert.equal(await page.evaluate(() => playRequests), 0);
  await page.click("#confirm-solve"); await done(page, "^Puzzle complete");
  assert.equal((await state(page)).result, null);
  report.checks.push("automatic final-cell checking cannot bypass scan confirmation");

  await seed(page); await page.click("#hint-play");
  await page.evaluate(async () => playApp.loadPuzzle((await import("./model.js")).makePuzzle("latinsquare", 3)));
  const replacement = await state(page);
  await page.click("#confirm-solve");
  assert.match(await text(page), /Puzzle changed/);
  assert.deepEqual((await state(page)).play, replacement.play);
  assert.equal(await page.evaluate(() => playRequests), 0);
  report.checks.push("a replacement board invalidates the pending Play action");

  for (const play of [[1, 2, 2, 1], [2, 1, 1, 2]]) {
    await seed(page, { review: false, blank: true, play });
    for (const action of ["check", "hint"]) {
      await page.click(`#${action}-play`); await done(page, "^Multiple solutions:");
      s = await state(page);
      assert.deepEqual(s.play, play); assert.deepEqual(s.hints, []); assert.deepEqual(s.playWrong, []);
      assert.equal(s.result, null); assert.equal(s.playing, true);
      assert.equal(await page.locator("#board .wrong").count(), 0);
    }
  }
  await page.click("#solve"); await done(page, "More than one solution");
  assert.equal((await state(page)).result.solutions.length, 2);
  report.checks.push("both valid 2x2 Latin solutions are preserved, never marked wrong or overwritten by arbitrary hints; Reveal still works");

  // Controlled result delivery supplements the real-runtime checks above.
  await seed(page, { review: false });
  await page.evaluate(() => { window.holdPlay = true; });
  await page.click("#hint-play");
  assert.equal((await state(page)).busy, true);
  await page.click("#stop");
  const stopped = await state(page);
  await page.evaluate(() => {
    const { handler, message } = heldPlay.shift();
    handler({ data: { type: "result", id: message.id, result: {
      status: "unique", complete: true, solutions: [{ cells: [1, 2, 2, 1] }],
    } } });
  });
  assert.deepEqual((await state(page)).play, stopped.play);
  assert.match(await text(page), /^Stopped/);
  await page.evaluate(() => { window.holdPlay = false; });
  await page.click("#check-play"); await done(page, "1 wrong");
  report.checks.push("Stop ignores a delayed Hint result and the next real Check works");

  await page.evaluate(() => { window.holdPlay = true; });
  // Invalidate the cached checking solution before testing mode cancellation.
  await page.evaluate(async () => playApp.loadPuzzle((await import("./model.js")).demo()));
  await page.selectOption("#edit-tool", "play"); await page.click("#hint-play");
  await page.selectOption("#edit-tool", "value");
  await page.evaluate(() => {
    const { handler, message } = heldPlay.shift();
    handler({ data: { type: "result", id: message.id, result: {
      status: "unique", complete: true, solutions: [{ cells: Array(81).fill(1) }],
    } } });
  });
  assert.equal((await state(page)).play.some(Number.isInteger), false);
  assert.equal((await state(page)).busy, false);
  report.checks.push("changing editing mode cancels a pending Hint");

  await seed(page, { review: false });
  assert.ok(await page.locator("#board .conflict").count() > 0);
  await page.click("#solve"); await done(page, "Solved · unique");
  assert.equal(await page.locator("#board .conflict").count(), 0);
  assert.equal((await state(page)).play[1], 1, "Reveal keeps, but does not display, the user's old answer");
  report.checks.push("Reveal does not inherit conflict marks from hidden Play answers");
}
(async () => {
  try {
    let available = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE)).ok) { available = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(available, "Static server did not start");
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
      const page = await context.newPage(), report = { browser: name, version: browser.version(), checks: [], errors: [] };
      reports.push(report); page.setDefaultTimeout(30000);
      page.on("pageerror", (e) => report.errors.push(e.message));
      try {
        await exercise(page, report); assert.deepEqual(report.errors, []); report.status = "passed";
        console.log(`${name}: Play safety regressions passed`);
      } catch (e) {
        report.status = "failed"; report.failure = e.stack;
        await page.screenshot({ path: `browser-artifacts/${name}-play-safety-failure.png`, fullPage: true }).catch(() => {});
        throw e;
      } finally { await browser.close(); }
    }
  } finally {
    fs.writeFileSync("browser-artifacts/play-safety.json", JSON.stringify(reports, null, 2) + "\n");
    server.kill();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
