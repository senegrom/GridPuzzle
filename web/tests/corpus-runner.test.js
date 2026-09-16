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
    fs.writeFileSync(file, "image bytes"); fs.writeFileSync(target, JSON.stringify({ puzzle }));
    return { file, target, name: `${n}.png`, mime: "image/png", family: "latinsquare", set: "fixture" };
  });
  let calls = 0, connected = true;
  const events = [], controller = new AbortController(), output = path.join(dir, "report.json");
  const page = {
    setDefaultTimeout() {}, async goto() { if (faults.goto) throw Error("navigation failed"); },
    async waitForSelector() {}, isClosed: () => !connected,
    async evaluate() {
      calls++;
      if (calls === 2 && faults.checkpoint) {
        const saved = JSON.parse(fs.readFileSync(output));
        assert.equal(saved.status, "running"); assert.equal(saved.results.length, 1);
      }
      if (calls === 2 && faults.hang) return new Promise(() => {});
      if (calls === 2 && faults.disconnect) { connected = false; throw Error("browser crashed"); }
      if (calls === 2 && faults.decode) throw Error("image decode rejected");
      return { read: { ...puzzle, black: [], cages: [], clues: [], inequalities: [] },
        uncertain: [], total: 12, detected: 1, grid: true };
    },
  };
  const context = { async newPage() { return page; }, async close() {
    events.push("context closed"); if (faults.close) throw Error("context cleanup failed");
  } };
  const browser = { async newContext() { return context; }, isConnected: () => connected,
    async close() { events.push("browser closed"); if (faults.close) throw Error("browser cleanup failed"); } };
  const server = new EventEmitter(); server.kill = () => { events.push("server killed"); };
  const deps = { startServer() { events.push("server started"); if (faults.spawn) throw Error("spawn failed"); return server; },
    async waitForServer() { if (faults.server) throw Error("server unavailable"); },
    async launch() { if (faults.launch) throw Error("launch failed"); return browser; }, log() {} };
  const run = () => runBenchmark({ items, options: { engine: "chromium" }, scan() {}, output, signal: controller.signal }, deps);
  return { items, output, events, controller, deps, run, get calls() { return calls; },
    saved: () => JSON.parse(fs.readFileSync(output)) };
}

test("normal runs score all images, checkpoint and close every resource", async t => {
  const h = harness(t, { checkpoint: true }); const report = await h.run();
  assert.equal(report.status, "complete"); assert.equal(report.summary[0].perfect, 3);
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
  assert.deepEqual(h.events.slice(1), ["context closed", "browser closed", "server killed"]);
});

for (const phase of ["goto", "launch", "server", "spawn"]) {
  test(`${phase} failure retains a diagnostic report and closes allocated resources`, async t => {
    const h = harness(t, { [phase]: true }); const report = await h.run();
    assert.equal(report.status, "failed"); assert.equal(report.results.length, 0);
    assert.ok(h.saved().failure); assert.equal(h.calls, 0);
    if (phase !== "spawn") assert.equal(h.events.at(-1), "server killed");
    if (phase === "goto") assert.ok(h.events.includes("browser closed"));
  });
}

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

test("unwritable initial report allocates no browser or server", async t => {
  const h = harness(t); h.deps.writeReport = () => { throw Error("output denied"); };
  await assert.rejects(h.run(), /output denied/); assert.deepEqual(h.events, []);
});
