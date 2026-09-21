/* Play mode against the real solver: answers, conflicts, checking, hints, completion, reload. */
const assert = require("node:assert/strict");
const { SMALL_PHONE, serve, engines, main } = require("./harness.cjs");

async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async () => {
    window.testState = (await import("./app.js")).getState;
  });
}
const statusText = (page) => page.locator("#status-text").innerText();
const cellClass = (page, i) => page.locator(`[data-cell="${i}"]`).getAttribute("class");
async function enter(page, cell, value) {
  await page.click(`[data-cell="${cell}"]`);
  await page.waitForSelector("#cell-dialog[open]");
  await page.fill("#cell-value", value === null ? "" : String(value));
  await page.click("#cell-form button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#cell-dialog").open);
}

async function run() {
  const server = await serve({ pages: true });
  try {
    await engines("play-regressions.json", async (page, report) => {
      report.checks = [];
      await page.goto(server.base);
      await ready(page);
      await page.click("#example");
      // Loading a puzzle warms the Python runtime before Solve is pressed.
      await page.waitForFunction(() => window.testState().solverWarm, null, { timeout: 180000 });
      report.checks.push("the solver runtime warms up after a puzzle loads");

      await page.selectOption("#edit-tool", "play");
      assert.equal(await page.locator("#check-play").isVisible(), true);
      assert.equal(await page.locator("#hint-play").isVisible(), true);
      assert.equal(await page.locator("#solve-label").innerText(), "Reveal solution");
      await page.click('[data-cell="0"]');
      assert.match(await statusText(page), /printed clue/);
      await page.click('[data-cell="2"]');
      await page.waitForSelector("#cell-dialog[open]");
      assert.equal(await page.locator("#cell-value-label").innerText(), "Your answer");
      assert.equal(await page.locator("#save-cell").innerText(), "Save answer");
      await page.click("#close-cell");
      await page.selectOption("#edit-tool", "value");
      await page.click('[data-cell="2"]');
      await page.waitForSelector("#cell-dialog[open]");
      assert.equal(await page.locator("#cell-value-label").innerText(), "Printed value");
      await page.click("#close-cell");
      await page.selectOption("#edit-tool", "play");
      assert.equal(await page.locator("#cell-dialog").getAttribute("open"), null);
      report.checks.push("play mode refuses printed clues and offers check, hint and reveal");

      await enter(page, 2, 3); // duplicates the printed 3 in row 1
      let s = await page.evaluate(() => window.testState());
      assert.equal(s.play[2], 3);
      assert.match(await cellClass(page, 2), /entry/);
      assert.match(await cellClass(page, 2), /conflict/);
      assert.match(await cellClass(page, 1), /conflict/);
      assert.match(await statusText(page), /1 of 51/);
      report.checks.push("answers render distinctly and conflicts with printed clues are marked");

      await enter(page, 2, 4);
      assert.doesNotMatch(await cellClass(page, 2), /conflict/);
      await enter(page, 3, 1); // solution has 6
      const t0 = Date.now();
      await page.click("#check-play");
      await page.waitForFunction(() => /right/.test(document.querySelector("#status-text").textContent), null, { timeout: 180000 });
      report.checkMs = Date.now() - t0;
      assert.ok(report.checkMs < 15000, `warm check took ${report.checkMs} ms`);
      assert.match(await statusText(page), /^1 right · 1 wrong · 49 to go$/);
      s = await page.evaluate(() => window.testState());
      assert.deepEqual(s.playWrong, [3]);
      assert.match(await cellClass(page, 3), /wrong/);
      assert.equal(s.result, null, "checking must not reveal the solution on the board");
      assert.match(await cellClass(page, 2), /entry/);
      report.checks.push("checking marks wrong answers against the real solution without revealing it");

      await page.click("#hint-play");
      await page.waitForFunction(() => /^Hint/.test(document.querySelector("#status-text").textContent));
      s = await page.evaluate(() => window.testState());
      assert.equal(s.play[3], 6, "the hint corrects the wrong cell first");
      assert.deepEqual(s.hints, [3]);
      assert.match(await cellClass(page, 3), /hint/);
      assert.doesNotMatch(await cellClass(page, 3), /wrong/);
      report.checks.push("hints correct the first wrong cell");

      await page.reload();
      await ready(page);
      s = await page.evaluate(() => window.testState());
      assert.equal(s.play[2], 4);
      assert.equal(s.play[3], 6);
      assert.deepEqual(s.hints, [3]);
      assert.equal(await page.locator("#edit-tool").inputValue(), "play");
      report.checks.push("answers, hints and play mode survive a reload");

      for (let i = 0; i < 60; i++) {
        const state = await page.evaluate(() => window.testState());
        if (state.play.filter(Number.isInteger).length >= 51) break;
        await page.click("#hint-play");
        await page.waitForFunction((n) => window.testState().play.filter(Number.isInteger).length === n, i + 3);
      }
      await page.waitForFunction(() => /complete/i.test(document.querySelector("#status-text").textContent), null, { timeout: 180000 });
      s = await page.evaluate(() => window.testState());
      assert.equal(s.play.filter(Number.isInteger).length, 51);
      assert.deepEqual(s.playWrong, []);
      report.checks.push("filling the last cell checks automatically and reports completion");

      await page.click("#solve");
      await page.waitForFunction(() => { const st = window.testState(); return !st.busy && st.result !== null; }, null, { timeout: 180000 });
      assert.equal(await page.locator("#edit-tool").inputValue(), "value", "reveal leaves play mode");
      assert.match(await cellClass(page, 2), /answer/);
      report.checks.push("reveal shows the solver's solution and leaves play mode");

      await page.evaluate(async () => {
        const app = await import("./app.js"), model = await import("./model.js");
        app.loadPuzzle(model.demo("slitherlink"));
      });
      assert.deepEqual(
        await page.evaluate(() => [
          document.querySelector('#edit-tool option[value="play"]').disabled,
          document.querySelector("#edit-tool").value,
          document.querySelector("#check-play").hidden,
        ]),
        [true, "value", true],
      );
      report.checks.push("families without cell answers disable play mode");
    }, { context: SMALL_PHONE, timeout: 30000 });
  } finally {
    server.close();
  }
}
module.exports = { run };
main(module, run);
