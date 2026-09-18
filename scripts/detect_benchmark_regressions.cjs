/* Real browsers and HTTP server: one corrupt image must not discard the valid
   images before/after it. Invoked by the permanent scanner-settings gate. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { items, parseOptions, runDetectionBenchmark } = require("../corpus/detect_benchmark.cjs");
const { writeReport } = require("../corpus/benchmark-runner.cjs");
module.exports = async function detectionFailure(engineName, png) {
  const engine = require("playwright")[engineName];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-real-detection-"));
  let browser, server;
  try {
    const folder = path.join(root, "sudoku", "decode-failure"); fs.mkdirSync(folder, { recursive: true });
    const target = { puzzle: { type: "sudoku", rows: 6, cols: 6 }, corners: [[0,0],[599,0],[599,599],[0,599]] };
    for (let n = 0; n < 3; n++) {
      fs.writeFileSync(path.join(folder, `${n}.png`), n === 1 ? Buffer.from("not a PNG") : Buffer.from(png, "base64"));
      fs.writeFileSync(path.join(folder, `${n}.json`), JSON.stringify(target));
    }
    const options = parseOptions(["--corpus", root, "--engine", engineName,
      "--out", `browser-artifacts/${engineName}-detection-failure.json`]);
    const checkpoints = [];
    const report = await runDetectionBenchmark({ items: items(options), options }, {
      async launch() { browser = await engine.launch({ headless: true }); return browser; },
      startServer() {
        server = spawn("python", ["-m", "http.server", "8782", "--bind", "127.0.0.1", "--directory", "_site"], { stdio: "ignore" });
        return server;
      },
      writeReport(file, value) { checkpoints.push(value.completedImages); writeReport(file, value); },
      log() {},
    });
    assert.equal(report.status, "complete"); assert.equal(report.completedImages, 3);
    assert.ok(report.results[0].at640); assert.ok(report.results[1].error); assert.ok(report.results[2].at1600);
    assert.ok(report.summary.every(s => s.failed === 1)); assert.deepEqual(report.cleanupErrors, []);
    assert.deepEqual(checkpoints, [0,1,2,3,3]);
    assert.deepEqual(JSON.parse(fs.readFileSync(options.out)), report);
    assert.equal(browser.isConnected(), false);
    if (server.exitCode === null && server.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("benchmark server did not stop")), 5000);
        server.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    return { checkpoints, completed: 3, decodeFailures: 1, browserClosed: true, serverStopped: true };
  } finally {
    if (browser?.isConnected()) await browser.close();
    if (server && server.exitCode === null && server.signalCode === null) server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
};
