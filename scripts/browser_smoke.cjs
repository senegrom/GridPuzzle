/* Real-browser tests on /GridPuzzle/, with actual Python and OCR WASM. */
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE = "http://127.0.0.1:8765/GridPuzzle/",
  SOLUTION =
    "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
const reports = [];
fs.mkdirSync("browser-artifacts", { recursive: true });
fs.mkdirSync("_preview", { recursive: true });
if (!fs.existsSync("_preview/GridPuzzle"))
  fs.symlinkSync(path.resolve("_site"), "_preview/GridPuzzle", "dir");
let server;
async function startServer() {
  server = spawn(
    "python",
    [
      "-m",
      "http.server",
      "8765",
      "--bind",
      "127.0.0.1",
      "--directory",
      "_preview",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await sleep(200);
  }
  throw Error("The preview server did not start.");
}
async function stopServer() {
  if (server) {
    const child = server;
    server = null;
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill();
    });
  }
  await assert.rejects(
    fetch(BASE, { signal: AbortSignal.timeout(2000) }),
    "The origin must actually be unreachable during offline testing.",
  );
}
async function ready(page) {
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(async () => {
    window.__gridpuzzleTestState = (await import("./app.js")).getState;
  });
}
async function reloadPage(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: 60000 }),
    page.evaluate(() => {
      setTimeout(() => location.reload(), 0);
    }),
  ]);
  await ready(page);
}
async function result(page) {
  await page.waitForFunction(
    () => {
      const s = window.__gridpuzzleTestState();
      return !s.busy && s.result !== null;
    },
    null,
    { timeout: 150000 },
  );
  return page.evaluate(() => window.__gridpuzzleTestState().result);
}
async function load(page, kind) {
  await page.evaluate(async (type) => {
    const app = await import("./app.js"),
      model = await import("./model.js");
    app.loadPuzzle(model.demo(type));
  }, kind);
}
async function uploadFixture(page, image) {
  await page.evaluate(async () => {
    const app = await import("./app.js"),
      model = await import("./model.js");
    app.loadPuzzle(model.makePuzzle());
  });
  await page.selectOption("#puzzle-type", "auto");
  await page.setInputFiles("#photo-file", {
    name: "printed-sudoku.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.waitForFunction(
    () => document.querySelector("#status-text").textContent === "Grid found.",
  );
  assert.equal(await page.inputValue("#rows"), "9");
  assert.equal(await page.inputValue("#cols"), "9");
  await page.click("#read-photo");
  await page.waitForFunction(() => !window.__gridpuzzleTestState().busy, null, {
    timeout: 150000,
  });
}
async function checkTranscription(page) {
  return page.evaluate(async () => {
    const model = await import("./model.js"),
      s = window.__gridpuzzleTestState(),
      reference = model.demo().cells;
    return {
      type: s.puzzle.type,
      recognized: s.puzzle.cells.filter(Number.isInteger).length,
      correct: s.puzzle.cells.filter((v, i) => v !== null && v === reference[i])
        .length,
      unsafe: s.puzzle.cells.flatMap((v, i) =>
        v !== reference[i] && !s.uncertain.includes(i) ? [i] : [],
      ),
      corrections: s.puzzle.cells.flatMap((v, i) =>
        v !== reference[i] ? [{ cell: i, value: reference[i] }] : [],
      ),
      uncertain: s.uncertain,
      cells: s.puzzle.cells,
    };
  });
}
async function checkStartupCancellation(browser, image, report) {
  const context = await browser.newContext({ serviceWorkers: "block" }),
    page = await context.newPage();
  let release, seen;
  const gate = new Promise((resolve) => (release = resolve)),
    requested = new Promise((resolve) => (seen = resolve));
  await context.route("**/vendor/tessdata/**", async (route) => {
    seen();
    await gate;
    try {
      await route.abort();
    } catch {}
  });
  try {
    await page.goto(BASE);
    await ready(page);
    await page.selectOption("#puzzle-type", "sudoku");
    await page.setInputFiles("#photo-file", {
      name: "startup.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#status-text").textContent === "Grid found.",
    );
    const beforeInvalid = await page.evaluate(() => ({
      puzzle: JSON.stringify(window.__gridpuzzleTestState().puzzle),
      saved: localStorage.getItem("gridpuzzle-session-v1"),
    }));
    await page.evaluate(
      () => (document.querySelector("#box-rows").value = "0"),
    );
    await page.click("#read-photo");
    assert.equal(
      (await page.evaluate(() => window.__gridpuzzleTestState())).busy,
      false,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        puzzle: JSON.stringify(window.__gridpuzzleTestState().puzzle),
        saved: localStorage.getItem("gridpuzzle-session-v1"),
      })),
      beforeInvalid,
    );
    await page.evaluate(
      () => (document.querySelector("#box-rows").value = "3"),
    );
    report.checks.push(
      "invalid scan box settings rejected before OCR and persistence",
    );
    await page.click("#read-photo");
    let timeout;
    try {
      await Promise.race([
        requested,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(Error("OCR language initialization was not observed")),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    await page.click("#stop");
    assert.equal(
      (await page.evaluate(() => window.__gridpuzzleTestState())).busy,
      false,
    );
    await sleep(250);
    assert.equal(
      page
        .workers()
        .filter((w) => /ocr-host-worker|tesseract.*worker/.test(w.url()))
        .length,
      0,
      "OCR initialization worker leaked after Stop",
    );
    await context.unroute("**/vendor/tessdata/**");
    release();
    await uploadFixture(page, image);
    assert.ok(
      (await checkTranscription(page)).correct >= 24,
      "Fresh scan after startup cancellation failed",
    );
    report.checks.push(
      "cancel during actual OCR language initialization; workers stop; fresh scan succeeds",
    );
  } finally {
    release();
    await context.close();
  }
}
(async () => {
  await startServer();
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // A Content Security Policy violation only logs; surface it as a failure.
    // Playwright itself injects a stylesheet while capturing screenshots
    // (WebKit reports it), so violations are ignored during our own captures.
    let capturing = false;
    page.on("console", (m) => {
      if (
        !capturing &&
        m.type() === "error" &&
        /Content.Security.Policy/i.test(m.text())
      )
        errors.push(m.text());
    });
    const screenshot = async (options) => {
      capturing = true;
      try {
        await page.screenshot(options);
      } finally {
        capturing = false;
      }
    };
    context.on("request", (r) => {
      if (
        !r.url().startsWith("http://127.0.0.1:8765/") &&
        !r.url().startsWith("blob:") &&
        !r.url().startsWith("data:")
      )
        external.push(r.url());
    });
    const report = {
      browser: name,
      version: browser.version(),
      checks: [],
      errors,
      external,
    };
    reports.push(report);
    try {
      await page.goto(BASE);
      await ready(page);
      await page.evaluate(async () => {
        const app = await import("./app.js"),
          model = await import("./model.js");
        const before = JSON.stringify(app.getState().puzzle),
          saved = localStorage.getItem("gridpuzzle-session-v1");
        for (const value of [1e-12, 1.5, 0, -1, "2", null]) {
          const p = model.makePuzzle("sudoku", 4);
          p.boxRows = value;
          let threw = false;
          try {
            app.loadPuzzle(p);
          } catch {
            threw = true;
          }
          if (
            !threw ||
            JSON.stringify(app.getState().puzzle) !== before ||
            localStorage.getItem("gridpuzzle-session-v1") !== saved
          )
            throw Error("Unsafe import committed state");
        }
        const p = model.makePuzzle("sudoku", 4);
        p.boxRows = 1e-12;
        localStorage.setItem(
          "gridpuzzle-session-v1",
          JSON.stringify({ puzzle: p }),
        );
      });
      await reloadPage(page);
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).puzzle.rows,
        9,
      );
      report.checks.push(
        "invalid imports rejected atomically; poisoned saved session recovers",
      );

      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Phone layout overflows horizontally",
      );
      report.checks.push("390px phone layout");
      await page.click("#example");
      await page.click("#solve");
      let solved = await result(page);
      assert.equal(solved.status, "unique", JSON.stringify(solved));
      assert.equal(solved.solutions[0].cells.join(""), SOLUTION);
      report.checks.push("actual Python 3.14 WASM Sudoku solution");
      await screenshot({
        path: `browser-artifacts/${name}-phone.png`,
        fullPage: true,
      });
      for (const kind of [
        "killersudoku",
        "futoshiki",
        "kenken",
        "latinsquare",
        "diagonallatinsquare",
        "pandiagonallatinsquare",
        "hidato",
        "numbrix",
        "kakuro",
        "slitherlink",
      ]) {
        await load(page, kind);
        await page.click("#solve");
        const r = await result(page);
        assert.ok(
          ["unique", "multiple"].includes(r.status),
          `${kind}: ${JSON.stringify(r)}`,
        );
        report.checks.push(`browser solver: ${kind}`);
      }
      console.log(name, "all eleven solver families passed");
      await load(page, "sudoku");
      await page.click("#solve");
      await result(page);
      await page.click('[data-cell="0"]');
      await page.fill("#cell-value", "9");
      await page.click("#cell-form button[type=submit]");
      const edited = await page.evaluate(() => window.__gridpuzzleTestState());
      assert.equal(edited.puzzle.cells[0], 9);
      assert.equal(edited.result, null);
      assert.notEqual(
        await page.locator("#status").getAttribute("data-result"),
        "unique",
      );
      await page.click("#undo");
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).puzzle
          .cells[0],
        5,
      );
      report.checks.push("cell editing, stale-result invalidation and undo");
      const beforeType = (
        await page.evaluate(() => window.__gridpuzzleTestState())
      ).puzzle.cells;
      await page.selectOption("#puzzle-type", "latinsquare");
      await page.click("#use-type");
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).puzzle.type,
        "latinsquare",
      );
      assert.deepEqual(
        (await page.evaluate(() => window.__gridpuzzleTestState())).puzzle
          .cells,
        beforeType,
      );
      report.checks.push("type override preserves transcription");
      await page.evaluate(async () => {
        const app = await import("./app.js"),
          model = await import("./model.js");
        app.loadPuzzle(model.makePuzzle("sudoku", 25));
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Large board must scroll inside its own container",
      );
      await page.click("#solve");
      await page.click("#stop");
      await sleep(250);
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).busy,
        false,
      );
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).result,
        null,
      );
      await load(page, "sudoku");
      await page.click("#solve");
      assert.equal((await result(page)).status, "unique");
      report.checks.push("worker cancellation and clean restart");
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        ),
      );
      await load(page, "sudoku");
      await page.click("#solve");
      assert.equal((await result(page)).status, "unique");
      report.checks.push(
        "pagehide terminates and resets the interpreter reference",
      );
      await page.evaluate(async () => {
        const model = await import("./model.js");
        localStorage.setItem(
          "gridpuzzle-session-v1",
          JSON.stringify({
            puzzle: model.demo(),
            uncertain: [0],
            needsReview: true,
            notes: ["Check this reading"],
          }),
        );
      });
      await reloadPage(page);
      assert.deepEqual(
        (await page.evaluate(() => window.__gridpuzzleTestState())).uncertain,
        [0],
      );
      assert.equal(
        (await page.evaluate(() => window.__gridpuzzleTestState())).needsReview,
        true,
      );
      await page.click("#solve");
      assert.ok(await page.locator("#confirm-dialog").isVisible());
      await page.click("#confirm-back");
      report.checks.push("reload retains unconfirmed recognition flags");
      await page.evaluate(() => {
        // Some WebKit ports (Windows) expose no media capture at all; the
        // app must offer the same fallback for a missing or denied camera.
        if (!navigator.mediaDevices)
          Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {},
          });
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: async () => {
            throw new DOMException(
              "Denied in acceptance test",
              "NotAllowedError",
            );
          },
        });
      });
      await page.click("#camera");
      await page.waitForSelector("#native-camera:not([hidden])");
      report.checks.push("camera permission fallback");
      const image = await page.evaluate(async () => {
        const p = (await import("./model.js")).demo(),
          c = document.createElement("canvas");
        c.width = c.height = 660;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 660, 660);
        ctx.strokeStyle = "black";
        for (let i = 0; i <= 9; i++) {
          ctx.lineWidth = i % 3 === 0 ? 5 : 2;
          ctx.beginPath();
          ctx.moveTo(42 + i * 64, 42);
          ctx.lineTo(42 + i * 64, 618);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(42, 42 + i * 64);
          ctx.lineTo(618, 42 + i * 64);
          ctx.stroke();
        }
        ctx.font = "38px Arial";
        ctx.fillStyle = "black";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        p.cells.forEach((v, i) => {
          if (v !== null)
            ctx.fillText(
              String(v),
              42 + ((i % 9) + 0.5) * 64,
              42 + (Math.floor(i / 9) + 0.5) * 64 + 1,
            );
        });
        return c.toDataURL("image/png").split(",")[1];
      });
      await checkStartupCancellation(browser, image, report);
      await uploadFixture(page, image);
      const scan = await checkTranscription(page);
      report.scan = scan;
      console.log(name, "raw scan", JSON.stringify(scan));
      assert.equal(scan.type, "sudoku");
      assert.ok(
        scan.correct >= 24,
        `Only ${scan.correct}/30 printed clues recognized`,
      );
      assert.deepEqual(
        scan.unsafe,
        [],
        "A wrong or missed clue was not flagged for review",
      );
      report.checks.push(
        "real printed-photo OCR, auto grid size, confidence handling",
      );
      // Simulate the human review path through the real editor. Never silently
      // substitute reference clues in production or report corrected OCR as raw.
      for (const correction of scan.corrections) {
        await page.click(`[data-cell="${correction.cell}"]`);
        assert.ok(await page.locator("#clue-crop").isVisible());
        await page.fill(
          "#cell-value",
          correction.value === null ? "" : String(correction.value),
        );
        await page.click("#cell-form button[type=submit]");
      }
      report.manualCorrections = scan.corrections.length;
      if (
        (await page.evaluate(() => window.__gridpuzzleTestState())).result ===
        null
      ) {
        await page.click("#solve");
        if (await page.locator("#confirm-dialog").isVisible())
          await page.click("#confirm-solve");
        await result(page);
      }
      const photoResult = await page.evaluate(
        () => window.__gridpuzzleTestState().result,
      );
      assert.equal(photoResult.status, "unique");
      assert.equal(photoResult.solutions[0].cells.join(""), SOLUTION);
      assert.ok(
        await page.locator("#photo-view").isEnabled(),
        "The confirmed photo transcription must produce an overlay",
      );
      await page.click("#photo-view");
      assert.ok(await page.locator("#solution-photo").isVisible());
      await screenshot({
        path: `browser-artifacts/${name}-overlay.png`,
        fullPage: true,
      });
      report.checks.push("photo review, exact solution and overlay");
      await page.click("#show-crop");
      await page.focus("#crop-canvas");
      await page.keyboard.press("ArrowRight");
      assert.ok(await page.locator("#photo-view").isDisabled());
      assert.ok(await page.locator("#save-photo").isHidden());
      assert.ok(await page.locator("#solution-photo").isHidden());
      report.checks.push("adjusted crop invalidates old photo overlay");
      await page.locator("#prepare-offline").evaluate((el) => {
        el.closest("details").open = true;
      });
      await page.click("#prepare-offline");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#offline-state")
            .textContent.startsWith("Offline assets are ready"),
        null,
        { timeout: 120000 },
      );
      assert.ok(
        await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        "The service worker must control the document.",
      );
      const repaired = await page.evaluate(async () => {
        // Assets are content-addressed: find model.js by its manifest digest
        // in whichever GridPuzzle cache under this scope holds it.
        const registration = await navigator.serviceWorker.ready;
        const manifest = await (
          await fetch("./assets.json", { cache: "no-store" })
        ).json();
        const entry = manifest.assets.find((a) => a.path === "model.js"),
          asset = new URL(
            `.gridpuzzle-cache/${entry.sha256}`,
            registration.scope,
          ).href;
        let cache = null;
        for (const name of await caches.keys()) {
          if (!name.startsWith(`gridpuzzle:${registration.scope}:`)) continue;
          const candidate = await caches.open(name);
          if (await candidate.match(asset)) cache = candidate;
        }
        if (!cache) throw Error("model.js is not in any GridPuzzle cache");
        const original = await (await cache.match(asset)).text();
        await cache.put(asset, new Response("wrong-version bytes"));
        const message = (type) =>
          new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = ({ data }) => {
              if (data.done || data.error) {
                channel.port1.close();
                data.error ? reject(Error(data.error)) : resolve(data);
              }
            };
            registration.active.postMessage({ type }, [channel.port2]);
          });
        // The startup status is a presence check, so poisoned bytes still
        // report ready; explicit preparation re-hashes, evicts and refetches.
        const before = await message("OFFLINE_STATUS");
        await message("PREPARE_OFFLINE");
        const after = await message("OFFLINE_STATUS");
        return (
          before.ready &&
          after.ready &&
          (await (await cache.match(asset)).text()) === original
        );
      });
      assert.ok(
        repaired,
        "Bad cached asset did not recover through the real service worker",
      );
      report.checks.push(
        "explicit offline preparation repairs poisoned content-addressed bytes",
      );

      report.offlineMethod =
        "Origin server stopped and verified unreachable; cache:no-store fetch proves service-worker cache use.";
      // Stop the real server instead of relying on WebKit's synthetic offline
      // switch, which rejected even cached document navigation in prior runs.
      // No origin can supply a missing file while this test is running.
      await stopServer();
      assert.ok(
        await page.evaluate(async () => {
          const r = await fetch("./model.js", { cache: "no-store" });
          return r.ok && (await r.text()).includes("export const TYPES");
        }),
      );
      await reloadPage(page);
      await load(page, "sudoku");
      await page.click("#solve");
      assert.equal((await result(page)).status, "unique");
      report.checks.push("origin-offline reload and Python solve");
      await page.goto(`${BASE}?share=1`, { waitUntil: "load" });
      await ready(page);
      assert.equal(await page.evaluate(() => location.search), "?share=1");
      report.checks.push("origin-offline root navigation with a query string");
      await uploadFixture(page, image);
      const offlineScan = await checkTranscription(page);
      assert.ok(offlineScan.correct >= 24);
      assert.deepEqual(offlineScan.unsafe, []);
      report.checks.push("origin-offline photo recognition");
      await startServer();
      assert.deepEqual(external, [], "App made an external runtime request");
      assert.deepEqual(errors, [], "Browser raised uncaught errors");
      report.ok = true;
      console.log(name, JSON.stringify(report));
    } catch (error) {
      report.ok = false;
      report.failure = error.stack;
      console.error(name, error);
      try {
        await screenshot({
          path: `browser-artifacts/${name}-failure.png`,
          fullPage: true,
        });
        report.status = await page.locator("#status").innerText();
        report.state = await page.evaluate(() =>
          window.__gridpuzzleTestState(),
        );
      } catch {}
    } finally {
      await browser.close();
      fs.writeFileSync(
        "browser-artifacts/results.json",
        JSON.stringify(reports, null, 2),
      );
      if (!server) await startServer();
    }
  }
  if (reports.some((r) => !r.ok)) process.exitCode = 1;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
  });
