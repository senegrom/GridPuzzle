/* Real browsers and HTTP server: one corrupt image must not discard the valid
   images before/after it, and --live measures the live camera's quick path,
   not the photograph's: on a lattice of dots, which only the photograph's
   path reads, its column finds no grid. Invoked by the permanent
   scanner-settings gate. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const { items, parseOptions, runDetectionBenchmark } = require("../corpus/detect_benchmark.cjs");
const { writeReport } = require("../corpus/benchmark-runner.cjs");
const { watch } = require("./harness.cjs");

// An 8-bit greyscale PNG of `width` x `height` pixels.
function greyPng(width, height, pixel) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13), rows = Buffer.alloc((width + 1) * height);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; // depth 8, colour type 0, no interlace
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = pixel(x, y);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
// A Slitherlink grid of 10 x 10 cells of 44 pixels, drawn only as 5-pixel dots
// at its lattice points: the lattice web/tests/grid-lines.test.js finds,
// without its clue strokes and caption.
const DOTS = { side: 640, cell: 44, origin: 70, cells: 10 };
function dotLattice({ side, cell, origin, cells } = DOTS) {
  return greyPng(side, side, (x, y) => {
    const dx = (x - origin + cell * 2) % cell, dy = (y - origin + cell * 2) % cell,
      near = (d) => Math.min(d, cell - d), inside = (v) => v >= origin - 2 && v <= origin + cells * cell + 2;
    return inside(x) && inside(y) && near(dx) ** 2 + near(dy) ** 2 <= 5 ? 30 : 246;
  });
}

module.exports = async function detectionFailure(engineName, png) {
  const engine = require("playwright")[engineName];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-real-detection-"));
  let browser, server, watched;
  try {
    const folder = path.join(root, "sudoku", "decode-failure"); fs.mkdirSync(folder, { recursive: true });
    const target = { puzzle: { type: "sudoku", rows: 6, cols: 6 }, corners: [[0,0],[599,0],[599,599],[0,599]] };
    for (let n = 0; n < 3; n++) {
      fs.writeFileSync(path.join(folder, `${n}.png`), n === 1 ? Buffer.from("not a PNG") : Buffer.from(png, "base64"));
      fs.writeFileSync(path.join(folder, `${n}.json`), JSON.stringify(target));
    }
    const dots = path.join(root, "slitherlink", "dot-lattice"), end = DOTS.origin + DOTS.cells * DOTS.cell;
    fs.mkdirSync(dots, { recursive: true });
    fs.writeFileSync(path.join(dots, "0.png"), dotLattice());
    fs.writeFileSync(path.join(dots, "0.json"), JSON.stringify({ puzzle: { type: "slitherlink", rows: DOTS.cells, cols: DOTS.cells },
      corners: [[DOTS.origin, DOTS.origin], [end, DOTS.origin], [end, end], [DOTS.origin, end]] }));
    const options = parseOptions(["--corpus", root, "--engine", engineName, "--live",
      "--out", `browser-artifacts/${engineName}-detection-failure.json`]);
    const checkpoints = [];
    const report = await runDetectionBenchmark({ items: items(options), options }, {
      async launch() { browser = await engine.launch({ headless: true }); watched = watch(browser); return browser; },
      startServer() {
        server = spawn("python", ["-m", "http.server", "8782", "--bind", "127.0.0.1", "--directory", "_site"], { stdio: "ignore" });
        return server;
      },
      writeReport(file, value) { checkpoints.push(value.completedImages); writeReport(file, value); },
      log() {},
    });
    // The page's uncaught errors first, as watch() collects them: one that
    // broke the run explains what fails after it.
    assert.deepEqual(watched?.errors ?? [], [], `${engineName}: uncaught page errors in the detection check`);
    assert.equal(report.status, "complete"); assert.equal(report.completedImages, 4);
    assert.deepEqual(report.live, { scale: 640, thorough: false });
    const row = (set, name) => report.results.find(r => r.set === set && r.name === name);
    const summary = set => report.summary.filter(s => s.set === set);
    // The corrupt image fails alone, in every column.
    assert.ok(row("decode-failure", "0.png").at640); assert.ok(row("decode-failure", "1.png").error);
    assert.ok(row("decode-failure", "2.png").at1600); assert.ok(row("decode-failure", "2.png").live);
    assert.deepEqual(summary("sudoku/decode-failure").map(s => [s.scale, s.thorough, s.images, s.failed]),
      [[640, undefined, 3, 1], [1600, undefined, 3, 1], [640, false, 3, 1]]);
    // The dots are a grid to the photograph's path at both scales and none to
    // the live camera's, which has no dot lattice.
    const lattice = row("dot-lattice", "0.png");
    for (const at of [lattice.at640, lattice.at1600])
      assert.ok(at.confidence >= .9 && at.sizeOk && at.error <= 3, `the photograph's path reads the dots: ${JSON.stringify(at)}`);
    assert.ok(lattice.live.confidence < .9 && !lattice.live.sizeOk, `the live camera's path reads no dots: ${JSON.stringify(lattice.live)}`);
    assert.deepEqual(summary("slitherlink/dot-lattice").map(s => [s.scale, s.thorough, s.good]),
      [[640, undefined, 1], [1600, undefined, 1], [640, false, 0]]);
    assert.deepEqual(report.cleanupErrors, []);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(checkpoints, [0,1,2,3,4,4]);
    assert.deepEqual(JSON.parse(fs.readFileSync(options.out)), report);
    assert.equal(browser.isConnected(), false);
    if (server.exitCode === null && server.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("benchmark server did not stop")), 5000);
        server.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    watched.check(engineName);
    return { checkpoints, completed: 4, decodeFailures: 1, browserClosed: true, serverStopped: true,
      dotLattice: { at640: lattice.at640, live: lattice.live } };
  } catch (error) {
    throw watched ? await watched.lead(error) : error;
  } finally {
    // Only after a failure: the runner closes the browser, or gives up on it
    // for its report, and the checks above fail when it is still connected.
    if (browser?.isConnected()) await watched.close(engineName);
    if (server && server.exitCode === null && server.signalCode === null) server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
};
module.exports.dotLattice = dotLattice;
