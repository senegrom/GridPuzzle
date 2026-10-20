import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const { runDetectionBenchmark, items: discover, parseOptions } = createRequire(import.meta.url)("../../corpus/detect_benchmark.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, faults = {}, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-detection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = path.join(dir, "sudoku", "fixture"); fs.mkdirSync(folder, { recursive: true });
  const corners = [[0,0],[99,0],[99,99],[0,99]];
  const target = { puzzle: { type: "sudoku", rows: 9, cols: 9 }, corners };
  for (let n = 0; n < 3; n++) {
    fs.writeFileSync(path.join(folder, `${n}.png`), "PNG bytes");
    fs.writeFileSync(path.join(folder, `${n}.json`), JSON.stringify(target));
  }
  const options = parseOptions(["--corpus", dir, "--out", path.join(dir, "report.json"), ...args]);
  let calls = 0, connected = true;
  const closed = [], payloads = [], controller = new AbortController();
  const page = { setDefaultTimeout() {}, async goto() { if (faults.startup) throw Error("navigation failed"); },
    async waitForSelector() {}, isClosed: () => !connected,
    async evaluate(_fn, data) {
      assert.deepEqual(data.scales, [640, 1600]); assert.equal(data.rows, 9);
      assert.deepEqual(data.corners, corners); calls++; payloads.push(data);
      if (calls === 2) {
        const checkpoint = JSON.parse(fs.readFileSync(options.out));
        assert.equal(checkpoint.status, "running"); assert.ok(checkpoint.results.length >= 1);
        assert.ok(checkpoint.results[0].at640);
        if (faults.hang) return new Promise(() => {});
        if (faults.crash) { connected = false; throw Error("browser crashed"); }
        if (faults.decode) throw Error("image decode rejected");
      }
      const measurement = { ms: 12, confidence: .94, rows: 9, cols: 9, error: 1, sizeOk: true };
      // The live camera's quick path finds the quad but no lattice.
      const quick = { ms: 5, confidence: .45, rows: 0, cols: 0, error: 2, sizeOk: false };
      return { 640: measurement, 1600: measurement, ...(data.live ? { live: quick } : {}) };
    } };
  const context = { async newPage() { return page; }, async close() {
    closed.push("context"); if (faults.cleanup) throw Error("context cleanup failed");
  } };
  const browser = { async newContext() { return context; }, isConnected: () => connected,
    async close() { closed.push("browser"); } };
  const server = new EventEmitter(); server.kill = () => { closed.push("server"); };
  const dependencies = { startServer: () => server, async waitForServer() {}, async launch() { return browser; }, log() {} };
  return { folder, options, controller, closed, payloads, dependencies, get calls() { return calls; },
    run: () => runDetectionBenchmark({ items: discover(options), options, signal: controller.signal }, dependencies),
    saved: () => JSON.parse(fs.readFileSync(options.out)) };
}

test("detection success checkpoints each image and reports both scales", async t => {
  const h = harness(t), r = await h.run();
  assert.equal(r.status, "complete"); assert.equal(r.formatVersion, 1); assert.equal(r.benchmark, "grid-detection");
  assert.equal(r.completedImages, 3); assert.equal(r.summary.length, 2);
  assert.ok(r.summary.every(s => s.good === 3 && s.failed === 0 && s.medianMs === 12));
  assert.deepEqual(h.saved(), r); assert.deepEqual(h.closed, ["context", "browser", "server"]);
});
test("without --live the report keeps its fields: the photograph's path at both scales, nothing of the live camera's", async t => {
  const h = harness(t), r = await h.run();
  assert.equal(r.options.live, false); assert.deepEqual(r.scales, [640, 1600]); assert.equal("live" in r, false);
  assert.ok(h.payloads.every(data => !("live" in data)), "the page is not asked for the live camera's detection");
  for (const row of r.results)
    assert.deepEqual(Object.keys(row), ["family", "set", "name", "key", "rows", "cols", "at640", "at1600"]);
  assert.deepEqual(r.summary.map(s => s.scale), [640, 1600]);
  for (const s of r.summary)
    assert.deepEqual(Object.keys(s), ["set", "scale", "images", "failed", "good", "found", "quad", "none", "medianCornerError", "medianMs"]);
});
test("--live also measures the live camera's detection: thorough: false at 640 pixels", async t => {
  const h = harness(t, {}, ["--live"]), r = await h.run();
  assert.equal(r.status, "complete"); assert.equal(r.formatVersion, 1); assert.equal(r.options.live, true);
  assert.deepEqual(r.live, { scale: 640, thorough: false }); assert.deepEqual(r.scales, [640, 1600]);
  assert.equal(h.payloads.length, 3);
  assert.ok(h.payloads.every(data => data.live.scale === 640 && data.live.thorough === false));
  for (const row of r.results) {
    assert.equal(row.at640.confidence, .94); assert.equal(row.at1600.confidence, .94);
    assert.deepEqual(row.live, { ms: 5, confidence: .45, rows: 0, cols: 0, error: 2, sizeOk: false });
  }
  // The photograph's rows as before, then one row per set for the live camera.
  assert.deepEqual(r.summary.map(s => [s.scale, s.thorough]), [[640, undefined], [1600, undefined], [640, false]]);
  assert.deepEqual(r.summary[2], { set: "sudoku/fixture", scale: 640, thorough: false, images: 3, failed: 0, good: 0,
    found: 0, quad: 3, none: 0, medianCornerError: null, medianMs: 5 });
  assert.ok(r.summary.slice(0, 2).every(s => s.good === 3 && !("thorough" in s)));
  assert.deepEqual(h.saved(), r); assert.deepEqual(h.closed, ["context", "browser", "server"]);
});
test("--live: a failed image counts as failed in the live camera's row too", async t => {
  const h = harness(t, { decode: true }, ["--live"]), r = await h.run();
  assert.equal(r.status, "complete"); assert.ok(r.results[1].error); assert.equal("live" in r.results[1], false);
  assert.ok(r.results[0].live && r.results[2].live);
  assert.equal(r.summary.length, 3);
  assert.ok(r.summary.every(s => s.images === 3 && s.failed === 1));
  assert.deepEqual(r.summary.map(s => s.good), [2, 2, 0]); assert.equal(r.summary[2].quad, 2);
});
for (const fault of ["decode", "malformed", "target-shape"])
  test(`${fault}: a later detection input failure preserves earlier and later measurements`, async t => {
    const h = harness(t, { decode: fault === "decode" });
    if (fault === "malformed") fs.writeFileSync(path.join(h.folder, "1.json"), "{invalid");
    if (fault === "target-shape") fs.writeFileSync(path.join(h.folder, "1.json"), JSON.stringify({ corners: [], puzzle: {} }));
    const r = await h.run();
    assert.equal(r.status, "complete"); assert.equal(r.results.length, 3); assert.ok(r.results[1].error);
    assert.ok(r.results[0].at640); assert.ok(r.results[2].at1600);
    assert.ok(r.summary.every(s => s.good === 2 && s.failed === 1));
    assert.deepEqual(h.saved(), r); assert.deepEqual(h.closed, ["context", "browser", "server"]);
  });
test("a browser crash saves a failed partial detection report instead of fabricating remaining failures", async t => {
  const h = harness(t, { crash: true, cleanup: true }), r = await h.run();
  assert.equal(r.status, "failed"); assert.match(r.failure, /browser crashed/);
  assert.equal(r.totalImages, 3); assert.equal(r.completedImages, 2); assert.equal(h.calls, 2);
  assert.ok(r.results[0].at640); assert.equal(r.cleanupErrors.length, 1);
  assert.deepEqual(h.saved(), r); assert.deepEqual(h.closed, ["context", "browser", "server"]);
});
test("an interrupted pending detection saves completed work and closes resources", async t => {
  const h = harness(t, { hang: true }), pending = h.run();
  while (h.calls < 2) await tick();
  h.controller.abort(Error("test interrupt"));
  const r = await pending;
  assert.equal(r.status, "interrupted"); assert.match(r.failure, /test interrupt/);
  assert.equal(r.completedImages, 2); assert.ok(r.results[0].at640); assert.deepEqual(h.saved(), r);
  assert.deepEqual(h.closed, ["context", "browser", "server"]);
});
test("detection startup failure leaves a diagnostic report", async t => {
  const h = harness(t, { startup: true }), r = await h.run();
  assert.equal(r.status, "failed"); assert.match(r.failure, /navigation/); assert.equal(r.completedImages, 0);
  assert.deepEqual(h.saved(), r); assert.deepEqual(h.closed, ["context", "browser", "server"]);
});
test("detection selection retains its per-set limit and intentionally excludes targets without corners", t => {
  const h = harness(t);
  fs.writeFileSync(path.join(h.folder, "0.json"), JSON.stringify({ puzzle: {} }));
  assert.deepEqual(discover(h.options).map(i => i.name), ["1.png", "2.png"]);
  h.options.limit = 1; assert.deepEqual(discover(h.options).map(i => i.name), ["1.png"]);
  h.options.set = "other"; assert.deepEqual(discover(h.options), []);
});
test("invalid detection command options fail explicitly", () => {
  for (const args of [["--limit", "-1"], ["--limit", "1.2"], ["--engine", "unknown"], ["--out"], ["--unknown", "1"],
    ["--live", "true"], ["--set", "--live"], ["live"]])
    assert.throws(() => parseOptions(args));
});
test("--live is a flag without a value, off by default", () => {
  assert.equal(parseOptions([]).live, false);
  assert.equal(parseOptions(["--live"]).live, true);
  const options = parseOptions(["--live", "--set", "slitherlink", "--limit", "5"]);
  assert.equal(options.live, true); assert.equal(options.set, "slitherlink"); assert.equal(options.limit, 5);
});
