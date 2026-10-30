import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { findGrid } from "../geometry.js";
const require = createRequire(import.meta.url);
const { runDetectionBenchmark, items: discover, parseOptions, LIVE } = require("../../corpus/detect_benchmark.cjs");
// The scanner_settings gate's picture; loading the gate needs no Playwright.
const { dotLattice } = require("../../scripts/detect_benchmark_regressions.cjs");
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
  // The browser, its context and page emit what Playwright's emit as they
  // open, so that the runner's watch() hears the page.
  const page = Object.assign(new EventEmitter(), {
    setDefaultTimeout() {}, async goto() { if (faults.startup) throw Error("navigation failed"); },
    async waitForSelector() {}, isClosed: () => !connected, url: () => "http://127.0.0.1:8782/", context: () => context,
    async close() {},
    async evaluate(_fn, data) {
      assert.deepEqual(data.scales, [640, 1600]); assert.equal(data.rows, 9);
      assert.deepEqual(data.corners, corners); calls++; payloads.push(data);
      if (calls === 2 && faults.thrown) page.emit("pageerror", Error("thrown in the page"));
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
    } });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [], async newPage() { this.emit("page", page); return page; },
    async close() { closed.push("context"); if (faults.cleanup) throw Error("context cleanup failed"); },
  });
  const browser = Object.assign(new EventEmitter(), {
    contexts: () => [], async newContext() { this.emit("context", context); return context; }, isConnected: () => connected,
    async close() { closed.push("browser"); },
  });
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
  assert.deepEqual(r.notRun, [{ family: "sudoku", set: "fixture", name: "2.png" }]);
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
test("a page that throws is listed in the detection report's pageErrors, and the run stays complete", async t => {
  const healthy = await harness(t).run(), h = harness(t, { thrown: true }), r = await h.run();
  assert.deepEqual(healthy.pageErrors, []); assert.deepEqual(r.pageErrors, ["thrown in the page"]);
  assert.equal(r.status, "complete"); assert.equal(r.failure, null);
  assert.deepEqual([r.notRun, r.summary, r.results], [healthy.notRun, healthy.summary, healthy.results]);
  assert.deepEqual(h.saved(), r);
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
test("--live measures at the size and in the way web/live-camera.js detects a frame", () => {
  // locate(): a copy of the frame at most LIVE.scale pixels on its long side,
  // detected with { thorough: false }. Change both together.
  const camera = fs.readFileSync(new URL("../live-camera.js", import.meta.url), "utf8");
  assert.deepEqual(LIVE, { scale: 640, thorough: false });
  assert.match(camera, new RegExp(`scale = Math\\.min\\(1, ${LIVE.scale} / Math\\.max\\(image\\.width, image\\.height\\)\\)`));
  assert.match(camera, /detector\.detect\(small, \{ thorough: false\b/);
});
test("the gate's lattice of dots is a PNG the photograph's path reads and the live camera's does not", () => {
  // Decoded here as a browser would: chunks with valid CRCs, one IDAT of
  // unfiltered greyscale rows.
  const png = dotLattice(), chunks = new Map();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString("latin1", at + 4, at + 8);
    assert.equal(png.readUInt32BE(at + 8 + length), zlib.crc32(png.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    chunks.set(type, png.subarray(at + 8, at + 8 + length)); at += 12 + length;
  }
  assert.deepEqual([...chunks.keys()], ["IHDR", "IDAT", "IEND"]);
  const header = chunks.get("IHDR"), width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  assert.deepEqual([width, height, ...header.subarray(8)], [640, 640, 8, 0, 0, 0, 0]);
  const rows = zlib.inflateSync(chunks.get("IDAT")), data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * (width + 1)], 0);
    for (let x = 0; x < width; x++) data.fill(rows[y * (width + 1) + 1 + x], (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const image = { width, height, data }, photograph = findGrid(image), live = findGrid(image, { thorough: LIVE.thorough });
  assert.equal(photograph.confidence, .94); assert.deepEqual([photograph.rows, photograph.cols], [10, 10]);
  assert.deepEqual(photograph.corners.map(p => [Math.round(p.x), Math.round(p.y)]), [[70, 70], [510, 70], [510, 510], [70, 510]]);
  assert.ok(live.confidence < .9, `the live camera's path has no dot lattice: ${live.confidence}`);
});
test("--live is a flag without a value, off by default", () => {
  assert.equal(parseOptions([]).live, false);
  assert.equal(parseOptions(["--live"]).live, true);
  const options = parseOptions(["--live", "--set", "slitherlink", "--limit", "5"]);
  assert.equal(options.live, true); assert.equal(options.set, "slitherlink"); assert.equal(options.limit, 5);
});
