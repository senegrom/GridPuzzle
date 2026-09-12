import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveSolver } from "../live-solver.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness(t, solver = { solve: async () => null, cancel() {} }) {
  let time = 0, serial = 0, cancellations = 0;
  const timers = new Map(), detections = [], readings = [], nodes = new Map();
  const previous = globalThis.document;
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(180) }) };
  const canvas = () => ({ width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} });
  globalThis.document = { createElement: canvas };
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  const settings = { type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true };
  const camera = createLiveCamera({ $, video: { videoWidth: 700, videoHeight: 700 }, canvas: canvas(),
    getSettings: () => ({ ...settings }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() { cancellations++; } },
    reader: { read() { const job = deferred(); readings.push(job); return job.promise; }, cancel() {} },
    solver, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; },
    clearTimer(id) { timers.delete(id); },
  });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; time = job.at; timers.delete(id); job.fn(); await flush();
    }
    time = end; await flush();
  }
  function result(job = detections.at(-1)) {
    job.resolve({ confidence: .99, rows: 2, cols: 2, sharpness: 200,
      corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
    return flush();
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, timers, detections, readings, settings, advance, result, $, get cancellations() { return cancellations; } };
}

test("changing live settings immediately replaces a pending grid detection", async (t) => {
  const h = harness(t); await h.advance(100);
  assert.equal(h.detections.length, 1);
  const before = h.cancellations;
  h.settings.type = "sudoku"; await h.advance(100);
  assert.equal(h.detections.length, 2);
  assert.ok(h.cancellations > before);
  const text = h.$("camera-help").textContent;
  h.detections[0].reject(Error("obsolete detection")); await flush();
  assert.equal(h.$("camera-help").textContent, text);
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1, "the replacement detector must continue into OCR");
});

test("a stalled detector is bounded and retries without closing the camera", async (t) => {
  const h = harness(t); await h.advance(9000);
  assert.ok(h.detections.length >= 2, "grid detection must not stay locked indefinitely");
  h.detections[0].reject(Error("late timeout result")); await flush();
  assert.doesNotMatch(h.$("camera-help").textContent, /late timeout result/);
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
});

test("restarting the same camera object retires unfinished detection and resets its cadence", async (t) => {
  const h = harness(t); await h.advance(100); h.camera.stop();
  assert.equal(h.timers.size, 0);
  h.camera.start(); await h.advance(100);
  assert.equal(h.detections.length, 2);
  h.detections[0].resolve({ confidence: 0 }); await flush();
  await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
});

test("repeated starts do not create parallel preview timers", async (t) => {
  const h = harness(t); h.camera.start();
  assert.equal(h.timers.size, 1);
  h.camera.stop(); assert.equal(h.timers.size, 0);
});

test("retired detector cleanup cannot unlock another in-flight detection", async (t) => {
  const h = harness(t); await h.advance(100);
  h.settings.enabled = false; await h.advance(100);
  assert.equal(h.detections.length, 2);
  await h.result(h.detections[0]); await h.advance(1500);
  assert.equal(h.detections.length, 2, "obsolete completion must not clear the current detector's ownership");
});

test("a delayed error from an obsolete solver cannot cancel a replacement solve", async () => {
  const workers = [], timers = new Map(); let serial = 0;
  const solver = createLiveSolver({
    makeWorker() { const worker = { postMessage(m) { this.message = m; }, terminate() { this.terminated = true; } }; workers.push(worker); return worker; },
    setTimer(fn) { timers.set(++serial, fn); return serial; }, clearTimer(id) { timers.delete(id); },
  });
  const first = solver.solve({}), obsolete = workers[0].onerror;
  solver.cancel(); assert.equal(await first, null);
  const second = solver.solve({}); obsolete({ message: "old runtime failed" });
  assert.notEqual(workers[1].terminated, true);
  const result = { status: "unique", complete: true, solutions: [{ cells: [1] }] };
  workers[1].onmessage({ data: { type: "result", id: workers[1].message.id, result } });
  assert.equal(await second, result); assert.equal(timers.size, 0); solver.cancel();
});

test("starting the live camera warms the preview runtime once", async (t) => {
  let prepared = 0;
  const h = harness(t, { solve: async () => null, cancel() {}, prepare() { prepared++; } });
  assert.equal(prepared, 1);
  h.camera.start(); assert.equal(prepared, 1, "a repeated start must not warm again");
  h.camera.stop(); h.camera.start(); assert.equal(prepared, 2);
});
