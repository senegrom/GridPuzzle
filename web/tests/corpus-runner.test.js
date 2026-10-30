import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { runBenchmark, writeReport } = createRequire(import.meta.url)("../../corpus/benchmark-runner.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, faults = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-benchmark-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const puzzle = { type: "latinsquare", rows: 2, cols: 2, cells: [1, 2, 2, 1] };
  const items = Array.from({ length: 3 }, (_, n) => {
    const file = path.join(dir, `${n}.png`), target = path.join(dir, `${n}.json`);
    fs.writeFileSync(file, "image bytes"); fs.writeFileSync(target, JSON.stringify({ puzzle, corners: [[0, 0], [9, 0], [9, 9], [0, 9]] }));
    return { file, target, name: `${n}.png`, mime: "image/png", family: "latinsquare", set: "fixture" };
  });
  let calls = 0, connected = true, crashed = false;
  const events = [], controller = new AbortController(), output = path.join(dir, "report.json");
  // The browser, its context and page emit what Playwright's emit as they
  // open, so that the runner's watch() hears the page. A crashed page stays
  // open to Playwright in a connected browser, and every later call on it
  // fails with "Target crashed", in WebKit too. `faults.thrown` lists when the
  // page throws an uncaught error: "goto", "close" or the number of a read.
  const throwAt = when => { if (faults.thrown?.includes(when)) page.emit("pageerror", Error(`thrown at ${when}`)); };
  const page = Object.assign(new EventEmitter(), {
    setDefaultTimeout() {}, async goto() { throwAt("goto"); if (faults.goto) throw Error("navigation failed"); },
    async waitForSelector() {}, isClosed: () => !connected, url: () => "http://127.0.0.1:8780/", context: () => context,
    async close() {},
    async evaluate(_scan, input) {
      // Count first: a failed assertion below must not leave the stalled-scan
      // test waiting for a second call for ever.
      calls++;
      throwAt(calls);
      if (crashed) throw Error("page.evaluate: Target crashed");
      assert.deepEqual(Object.keys(input.puzzle).sort(), ["cols", "rows", "type"]);
      assert.deepEqual(input.corners, input.useTrue ? [[0, 0], [9, 0], [9, 9], [0, 9]] : null, "reference corners are opt-in");
      if (calls === 2 && faults.checkpoint) {
        const saved = JSON.parse(fs.readFileSync(output));
        assert.equal(saved.status, "running"); assert.equal(saved.results.length, 1);
      }
      if (calls === 2 && faults.hang) return new Promise(() => {});
      // Interrupted by the stalled read itself: a run that stopped sooner then
      // fails its test, instead of leaving it waiting for this read for ever.
      if (calls === 2 && faults.interrupt) { controller.abort(Error("test interrupt")); return new Promise(() => {}); }
      if (calls === 2 && faults.disconnect) { connected = false; throw Error("browser crashed"); }
      if (calls === 2 && faults.decode) throw Error("image decode rejected");
      // Chromium reports a crash before the call it interrupts fails; WebKit
      // can fail the call first, with a lost browser's words.
      if (calls === 2 && faults.crash === "chromium") {
        page.emit("crash", page); crashed = true; throw Error("page.evaluate: Target crashed");
      }
      if (calls === 2 && faults.crash === "webkit") {
        setTimeout(() => page.emit("crash", page), 20);
        crashed = true; throw Error("page.evaluate: Target page, context or browser has been closed");
      }
      // A crash between two reads: the second read succeeds, and the crash is
      // reported before the runner reads the third image, so no read fails.
      if (calls === 2 && faults.crash === "between") { page.emit("crash", page); crashed = true; }
      return { read: { ...puzzle, black: [], cages: [], clues: [], inequalities: [] },
        uncertain: [], total: 12, detected: 1, grid: true, geometrySource: "detected" };
    },
  });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [], async newPage() { this.emit("page", page); return page; },
    async close() { throwAt("close"); events.push("context closed"); if (faults.close) throw Error("context cleanup failed"); },
  });
  const browser = Object.assign(new EventEmitter(), {
    contexts: () => [], async newContext() { this.emit("context", context); return context; }, isConnected: () => connected,
    async close() { events.push("browser closed"); if (faults.close) throw Error("browser cleanup failed"); },
  });
  const server = new EventEmitter(); server.kill = () => { events.push("server killed"); };
  const deps = { startServer() { events.push("server started"); if (faults.spawn) throw Error("spawn failed"); return server; },
    async waitForServer() { if (faults.server) throw Error("server unavailable"); },
    async launch() { if (faults.launch) throw Error("launch failed"); return browser; }, log() {} };
  const run = (options = {}) => runBenchmark({ items, options: { engine: "chromium", ...options }, scan() {}, output, signal: controller.signal }, deps);
  return { items, output, events, controller, deps, run, get calls() { return calls; },
    saved: () => JSON.parse(fs.readFileSync(output)) };
}

test("normal runs score all images, checkpoint and close every resource", async t => {
  const h = harness(t, { checkpoint: true }); const report = await h.run();
  assert.equal(report.status, "complete"); assert.equal(report.summary[0].perfect, 3);
  assert.deepEqual([report.notRun, report.ended, report.pageErrors, report.failure], [[], [], [], null]);
  assert.equal(report.scoreVersion, 6);
  assert.deepEqual(report.recognition, { type: "reference", dimensions: "reference",
    corners: "detected-or-full-frame", clueValues: "not-supplied" });
  assert.deepEqual(h.saved().recognition, report.recognition);
  assert.equal(report.results[0].geometrySource, "detected");
  const { flaggedCorrect, emptyCells, flaggedEmpty } = report.summary[0];
  assert.deepEqual([flaggedCorrect, emptyCells, flaggedEmpty], [0, 0, 0]);
  assert.equal(report.completedImages, 3); assert.equal(h.saved().results.length, 3);
  assert.deepEqual(h.events, ["server started", "context closed", "browser closed", "server killed"]);
});

test("malformed target is a per-image error and preserves earlier and later scores", async t => {
  const h = harness(t); fs.writeFileSync(h.items[1].target, "{malformed");
  const report = await h.run();
  assert.equal(report.status, "complete"); assert.equal(report.results.length, 3);
  assert.ok(report.results[1].error); assert.equal(report.summary[0].perfect, 2);
  assert.equal(report.summary[0].failed, 1); assert.equal(h.calls, 2);
  assert.equal(h.saved().completedImages, 3); assert.equal(h.events.at(-1), "server killed");
});

test("image decode rejection does not lose completed work or skip cleanup", async t => {
  const h = harness(t, { decode: true }); const report = await h.run();
  assert.equal(report.status, "complete"); assert.match(report.results[1].error, /decode/);
  assert.equal(h.saved().summary[0].perfect, 2);
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});

test("browser crash writes a partial report and stops rather than inventing scan failures", async t => {
  const h = harness(t, { disconnect: true }); const report = await h.run();
  assert.equal(report.status, "failed"); assert.match(report.failure, /browser crashed/);
  assert.equal(h.calls, 2); assert.equal(h.saved().results.length, 2);
  assert.equal(report.totalImages, 3); assert.equal(report.summary[0].perfect, 1);
  assert.deepEqual(report.notRun, [{ family: "latinsquare", set: "fixture", name: "2.png" }]);
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});

// A crashed page is neither closed to Playwright nor in a disconnected
// browser: the runner hears the crash, or takes the read's failure that its
// target is gone, and stops instead of failing every later image on its own.
for (const engine of ["chromium", "webkit"])
  test(`a page that crashes (${engine}) stops the run: the image being read fails, the rest are not run, and the failure says why once`, async t => {
    const h = harness(t, { crash: engine }); const report = await h.run();
    const interrupted = engine === "chromium" ? "page.evaluate: Target crashed"
      : "page.evaluate: Target page, context or browser has been closed";
    assert.equal(report.status, "failed"); assert.equal(h.calls, 2, "the third image is not read");
    assert.deepEqual(report.results.map(row => row.error ?? null), [null, interrupted]);
    assert.deepEqual(report.notRun, [{ family: "latinsquare", set: "fixture", name: "2.png" }]);
    assert.deepEqual([report.completedImages, report.totalImages], [2, 3]);
    assert.deepEqual([report.summary[0].images, report.summary[0].failed, report.summary[0].perfect], [2, 1, 1]);
    assert.deepEqual(report.ended.map(({ event, url }) => [event, url]), [["page crashed", "http://127.0.0.1:8780/"]]);
    const [{ seconds }] = report.ended;
    assert.equal(report.failure, `page crashed ${seconds} s after launch (http://127.0.0.1:8780/)\n${interrupted}`);
    assert.deepEqual(h.saved(), JSON.parse(JSON.stringify(report)), "the report on disk says the same");
    assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
  });

// A crash between two reads fails no read (real WebKit reported one right
// after a read that succeeded, before the runner's next read): only what
// watch() heard stops the run, before the next image is read.
test("a page that crashes between two reads stops the run before the next: no image fails, the rest are not run, and the failure says why once", async t => {
  const h = harness(t, { crash: "between" }); const report = await h.run();
  assert.equal(report.status, "failed"); assert.equal(h.calls, 2, "the third image is not read");
  assert.deepEqual(report.results.map(row => row.error ?? null), [null, null]);
  assert.deepEqual(report.notRun, [{ family: "latinsquare", set: "fixture", name: "2.png" }]);
  assert.deepEqual([report.completedImages, report.totalImages], [2, 3]);
  assert.deepEqual([report.summary[0].images, report.summary[0].failed, report.summary[0].perfect], [2, 0, 2]);
  assert.deepEqual(report.ended.map(({ event, url }) => [event, url]), [["page crashed", "http://127.0.0.1:8780/"]]);
  const [{ seconds }] = report.ended;
  assert.equal(report.failure, `page crashed ${seconds} s after launch (http://127.0.0.1:8780/)\nThe benchmark's page or browser is gone`);
  assert.deepEqual(h.saved(), JSON.parse(JSON.stringify(report)), "the report on disk says the same");
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});

for (const phase of ["goto", "launch", "server", "spawn"]) {
  test(`${phase} failure retains a diagnostic report and closes allocated resources`, async t => {
    const h = harness(t, { [phase]: true }); const report = await h.run();
    assert.equal(report.status, "failed"); assert.equal(report.results.length, 0);
    assert.deepEqual(report.notRun.map(item => item.name), ["0.png", "1.png", "2.png"]);
    assert.ok(h.saved().failure); assert.equal(h.calls, 0);
    assert.deepEqual(h.saved().pageErrors, [], "no page, no errors, and the list is there all the same");
    if (phase !== "spawn") assert.equal(h.events.at(-1), "server killed");
    if (phase === "goto") assert.ok(h.events.includes("browser closed"));
  });
}

// What the file holds after each save: after a hard kill, or to someone checking
// on a run, the last checkpoint is all there is.
function keepSaves(h) {
  const saves = [];
  h.deps.writeReport = (file, report) => { writeReport(file, report); saves.push(JSON.parse(fs.readFileSync(file))); };
  return saves;
}

// A benchmark measures recognition and is not a gate: an uncaught error in its
// page is recorded, and the run is the run it would have been without it.
test("what a page throws is listed in pageErrors, the checkpoints hold it, and the run stays complete", async t => {
  const healthy = await harness(t).run(), h = harness(t, { thrown: [2, 3] }), saves = keepSaves(h), report = await h.run();
  const both = ["thrown at 2", "thrown at 3"];
  assert.equal(report.status, "complete"); assert.deepEqual(report.pageErrors, both);
  assert.deepEqual({ ...report, pageErrors: [] }, healthy, "status, failure, notRun, summary and results do not change");
  assert.deepEqual(h.saved(), JSON.parse(JSON.stringify(report)), "the report on disk says the same");
  // Before start-up, after each of the three images, and after clean-up.
  assert.deepEqual(saves.map(({ pageErrors }) => pageErrors), [[], [], both.slice(0, 1), both, both]);
  assert.deepEqual(saves.map(({ status }) => status), ["running", "running", "running", "running", "complete"]);
});

test("an error thrown after the last checkpoint, as the page closes, reaches the final save", async t => {
  const h = harness(t, { thrown: ["close"] }), saves = keepSaves(h), report = await h.run();
  assert.equal(report.status, "complete"); assert.deepEqual(report.pageErrors, ["thrown at close"]);
  assert.deepEqual(h.saved().pageErrors, ["thrown at close"]);
  assert.deepEqual(saves.map(({ pageErrors }) => pageErrors), [[], [], [], [], ["thrown at close"]]);
});

// However a run ends, what its page threw before that and as it closes is in
// the report, and the end stays what it would have been.
for (const [end, faults, status, failure] of [
  ["a failed navigation", { thrown: ["goto", "close"], goto: true }, "failed", /^navigation failed$/],
  ["a lost browser", { thrown: [1, "close"], disconnect: true }, "failed", /^browser crashed$/],
  ["a page crash in Chromium", { thrown: [1, "close"], crash: "chromium" }, "failed", /^page crashed .*\npage\.evaluate: Target crashed$/],
  ["a page crash in WebKit", { thrown: [1, "close"], crash: "webkit" }, "failed", /^page crashed .*\npage\.evaluate: Target page, context or browser has been closed$/],
  ["a page crash between two reads", { thrown: [1, "close"], crash: "between" }, "failed", /^page crashed .*\nThe benchmark's page or browser is gone$/],
  ["an interrupt", { thrown: [1, "close"], interrupt: true }, "interrupted", /^test interrupt$/],
])
  test(`${end} keeps what the page threw, and what ended the run stays the failure`, async t => {
    const h = harness(t, faults), report = await h.run();
    assert.equal(report.status, status); assert.match(report.failure, failure);
    assert.deepEqual(report.pageErrors, faults.thrown.map(when => `thrown at ${when}`));
    assert.deepEqual(h.saved(), JSON.parse(JSON.stringify(report)), "the report on disk says the same");
  });

test("cleanup failures do not hide the original browser error or prevent other cleanup", async t => {
  const h = harness(t, { disconnect: true, close: true }); const report = await h.run();
  assert.match(report.failure, /browser crashed/); assert.equal(report.cleanupErrors.length, 2);
  assert.equal(h.saved().cleanupErrors.length, 2); assert.equal(h.events.at(-1), "server killed");
});

test("interruption during a stalled scan checkpoints and closes without awaiting the scan", async t => {
  const h = harness(t, { hang: true }); const pending = h.run();
  while (h.calls < 2) await tick();
  h.controller.abort(Error("test interrupt"));
  const report = await pending;
  assert.equal(report.status, "interrupted"); assert.match(report.failure, /test interrupt/);
  assert.deepEqual(report.notRun.map(item => item.name), ["2.png"]);
  assert.equal(report.summary[0].perfect, 1); assert.equal(h.saved().completedImages, 2);
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});

test("checkpoint write errors still trigger cleanup and a final diagnostic write", async t => {
  const h = harness(t); let writes = 0;
  h.deps.writeReport = (file, report) => {
    if (++writes === 2) throw Error("checkpoint disk failure");
    writeReport(file, report);
  };
  const report = await h.run();
  assert.equal(report.status, "failed"); assert.match(report.failure, /disk failure/);
  assert.equal(h.saved().results.length, 1); assert.equal(h.events.at(-1), "server killed");
});

// On Windows a reader holding the report open (a progress check, an editor)
// makes the replacing rename fail with EPERM until it closes. That must cost a
// checkpoint at most, never the run.
const busy = (code = "EPERM") => Object.assign(Error(`${code}: operation not permitted, rename`), { code });
test("a checkpoint the report's reader blocks is skipped, and the run goes on", async t => {
  const h = harness(t); let writes = 0; const logged = [];
  h.deps.log = line => logged.push(line);
  h.deps.writeReport = (file, report) => {
    if (++writes === 3) throw busy();
    writeReport(file, report);
  };
  const report = await h.run();
  assert.equal(report.status, "complete"); assert.equal(report.failure, null);
  assert.equal(h.calls, 3); assert.equal(h.saved().completedImages, 3); assert.equal(h.saved().summary[0].perfect, 3);
  const warnings = logged.filter(line => line.includes("checkpoint"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /checkpoint after image 2 not saved, the report is held open \(EPERM/);
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});
test("the report's rename is retried while the file is held open, then reported", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-report-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "report.json");
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    let calls = 0;
    writeReport(file, { code }, { wait: 1, rename(from, to) { if (++calls < 3) throw busy(code); fs.renameSync(from, to); } });
    assert.equal(calls, 3); assert.deepEqual(JSON.parse(fs.readFileSync(file)), { code });
  }
  let calls = 0;
  const kept = `${file}.${process.pid}.tmp`;
  assert.throws(() => writeReport(file, { lost: false }, { attempts: 4, wait: 1, rename() { calls++; throw busy(); } }),
    { message: `EPERM: operation not permitted, rename; the report is kept as ${kept}` });
  assert.equal(calls, 4); assert.deepEqual(JSON.parse(fs.readFileSync(file)), { code: "EBUSY" });
  // Held throughout, the new report is kept beside the old one rather than lost.
  assert.deepEqual(JSON.parse(fs.readFileSync(kept)), { lost: false });
  // Any other failure is not retried.
  calls = 0;
  assert.throws(() => writeReport(file, {}, { wait: 1, rename() { calls++; throw Object.assign(Error("no space"), { code: "ENOSPC" }); } }), /no space/);
  assert.equal(calls, 1);
  assert.deepEqual(fs.readdirSync(dir), ["report.json"], "no temporary file is left behind");
});

test("unwritable initial report allocates no browser or server", async t => {
  const h = harness(t); h.deps.writeReport = () => { throw Error("output denied"); };
  await assert.rejects(h.run(), /output denied/); assert.deepEqual(h.events, []);
});


test("reference-corner benchmark mode declares its supplied geometry without passing clue values", async t => {
  const h = harness(t), report = await h.run({ trueCorners: true });
  assert.equal(report.status, "complete"); assert.equal(h.calls, 3);
  assert.equal(report.recognition.corners, "reference-when-available");
  assert.equal(report.recognition.clueValues, "not-supplied");
});
