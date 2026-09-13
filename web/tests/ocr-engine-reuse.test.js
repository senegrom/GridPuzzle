// The reusable OCR engine: one host per scanner, cooperative cancellation,
// exact-image caching, geometry worker reuse and provisional live readings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createOCRRuntime } from "../ocr-runtime.js";
import { Scanner } from "../scanner.js";
import { createLiveSession } from "../live-session.js";
import { makePuzzle } from "../model.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function runtime(t) {
  const workers = [], timers = new Map(); let serial = 0;
  const api = createOCRRuntime({ makeWorker() {
    const worker = { messages: [], postMessage(data) { this.messages.push(data); }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  }, setTimer(fn, ms) { timers.set(++serial, { fn, ms }); return serial; }, clearTimer(id) { timers.delete(id); } });
  const message = (data, worker = workers.at(-1)) => worker.onmessage?.({ data });
  t.after(() => { api.dispose(); for (const w of workers) w.onmessage?.({ data: { cancelled: true } }); });
  return { api, workers, timers, message };
}

test("warming and consecutive OCR requests reuse one host and ignore unrelated replies", async (t) => {
  const h = runtime(t); h.api.prepare(); h.api.prepare();
  assert.equal(h.workers.length, 1); h.message({ type: "ready" });
  const one = h.api.recognize({ png: "a" });
  h.message({ id: 99, result: { wrong: true } }); h.message({ id: 1, result: { text: "1" } });
  assert.deepEqual(await one, { text: "1" });
  const two = h.api.recognize({ png: "b" }); h.message({ id: 2, result: { text: "2" } });
  assert.deepEqual(await two, { text: "2" }); assert.equal(h.workers.length, 1); assert.equal(h.timers.size, 0);
});
test("superseded OCR rejects promptly, suppresses partials and queues only the newest frame", async (t) => {
  const h = runtime(t), previews = [], progress = [];
  const one = h.api.recognize({ png: "old" }, (m) => progress.push(m), (m) => previews.push(m));
  const rejected = assert.rejects(one, { name: "AbortError" });
  const two = h.api.recognize({ png: "new" }); await rejected;
  h.message({ id: 1, type: "progress", message: "stale" }); h.message({ id: 1, type: "atlas", result: {} });
  assert.deepEqual(previews, []); assert.deepEqual(progress, []);
  assert.equal(h.workers[0].messages.filter((m) => m.png).length, 1);
  h.message({ id: 1, cancelled: true });
  assert.equal(h.workers[0].messages.at(-1).png, "new");
  h.message({ id: 1, result: { stale: true } }); h.message({ id: 2, result: { fresh: true } });
  assert.deepEqual(await two, { fresh: true }); assert.equal(h.workers.length, 1);
});
test("cancellation of a stuck atomic OCR call replaces it without dropping the latest queued frame", async (t) => {
  const h = runtime(t), one = h.api.recognize({ png: "old" });
  const rejected = assert.rejects(one, { name: "AbortError" });
  const two = h.api.recognize({ png: "new" }); await rejected;
  [...h.timers.values()].find((timer) => timer.ms === 2000).fn();
  assert.equal(h.workers.length, 2); h.message({ id: 2, result: { text: "new" } });
  assert.deepEqual(await two, { text: "new" });
  h.message({ cancelled: true }, h.workers[0]); assert.equal(h.workers[0].terminated, true);
});
test("disposing a warm OCR host releases its child and loading deadline", (t) => {
  const h = runtime(t); h.api.prepare(); h.api.dispose(); h.message({ cancelled: true });
  assert.equal(h.workers[0].terminated, true); assert.equal(h.timers.size, 0);
});
test("OCR decoding errors reject the owned operation and allow a clean retry", async (t) => {
  const h = runtime(t), one = h.api.recognize({ png: "a" });
  const rejected = assert.rejects(one, /receive/); h.workers[0].onmessageerror(); await rejected;
  h.message({ cancelled: true }, h.workers[0]);
  const two = h.api.recognize({ png: "b" }); h.message({ id: 2, result: {} });
  await two; assert.equal(h.workers.length, 2);
});

function host() {
  const messages = [], calls = [], parameters = []; let constructed = 0;
  const worker = { async setParameters(p) { parameters.push(p); }, async recognize(image) {
    calls.push(image); return { data: { text: "11", confidence: 96 } };
  }, async terminate() {} };
  const self = { Worker: class { terminate() {} }, location: { href: "https://example.test/ocr-host-worker.js" }, postMessage(m) { messages.push(m); }, close() {} };
  vm.runInNewContext(fs.readFileSync(new URL("../ocr-host-worker.js", import.meta.url), "utf8"), {
    self, URL, Uint8Array, importScripts() { self.Tesseract = { async createWorker() { constructed++; return worker; } }; },
  });
  return { self, worker, messages, calls, parameters, get constructed() { return constructed; } };
}
test("OCR host reuses exact sample evidence without reusing cell indices or fuzzy matches", async () => {
  const h = host(); await h.self.onmessage({ data: { type: "warm" } });
  const png = new ArrayBuffer(0), singles = [{ index: 0, kind: "binary", psm: "7", png: "same pixels" }];
  await h.self.onmessage({ data: { id: 1, keepAlive: true, png, singles } });
  await h.self.onmessage({ data: { id: 2, keepAlive: true, png, singles: [{ ...singles[0], index: 8 }] } });
  const result = h.messages.find((m) => m.id === 2 && m.result && !m.type).result;
  assert.equal(h.constructed, 1); assert.equal(result.singles[0].index, 8);
  assert.equal(result.ocrStats.cacheHits, 1); assert.equal(h.calls.length, 3, "two atlases and one isolated crop");
  await h.self.onmessage({ data: { id: 3, keepAlive: true, png, singles: [{ ...singles[0], png: "changed pixels" }] } });
  assert.equal(h.calls.length, 5, "a different image is never a cache hit");
  assert.ok(h.messages.some((m) => m.type === "atlas"));
  await h.self.onmessage({ data: { cancel: true } });
});
test("cooperative cancellation finishes one atomic call, keeps the engine, and emits no stale result", async () => {
  const h = host(), pause = deferred(); let once = true;
  const recognize = h.worker.recognize;
  h.worker.recognize = async (...args) => { if (once) { once = false; await pause.promise; } return recognize(...args); };
  const old = h.self.onmessage({ data: { id: 1, keepAlive: true, png: new ArrayBuffer(0), singles: [] } });
  await tick(); await h.self.onmessage({ data: { cancel: 1 } }); pause.resolve(); await old;
  assert.ok(h.messages.some((m) => m.id === 1 && m.cancelled));
  assert.ok(!h.messages.some((m) => m.id === 1 && m.result));
  await h.self.onmessage({ data: { id: 2, keepAlive: true, png: new ArrayBuffer(0), singles: [] } });
  assert.equal(h.constructed, 1); assert.ok(h.messages.some((m) => m.id === 2 && m.result));
  await h.self.onmessage({ data: { cancel: true } });
});
test("a one-shot request without keepAlive still releases the engine afterwards", async () => {
  const h = host();
  await h.self.onmessage({ data: { id: 1, png: new ArrayBuffer(0), singles: [] } });
  assert.ok(h.messages.some((m) => m.id === 1 && m.result));
  await h.self.onmessage({ data: { id: 2, png: new ArrayBuffer(0), singles: [] } });
  assert.equal(h.constructed, 2, "without keepAlive each request builds its own engine, as before");
});

test("geometry success reuses the worker and transfers only the fresh input buffer", async (t) => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage(data, transfer) { this.transfer = transfer; this.data = data; } terminate() { this.terminated = true; } };
  t.after(() => { globalThis.Worker = previous; });
  const scanner = new Scanner();
  for (let i = 0; i < 2; i++) {
    const image = { data: new Uint8ClampedArray(16), width: 2, height: 2 }, pending = scanner.geometry("detect", { image });
    assert.equal(workers.length, 1); assert.deepEqual(workers[0].transfer, [image.data.buffer]);
    workers[0].onmessage({ data: { result: { rows: 2 } } }); await pending;
    assert.ok(!workers[0].terminated);
  }
  scanner.cancel(); assert.ok(workers[0].terminated);
});
test("a cancelled geometry request discards its busy worker instead of reusing it", async (t) => {
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class { constructor() { workers.push(this); } postMessage() {} terminate() { this.terminated = true; } };
  t.after(() => { globalThis.Worker = previous; });
  const scanner = new Scanner();
  const pending = scanner.geometry("detect", { image: { data: new Uint8ClampedArray(16), width: 2, height: 2 } });
  scanner.cancel({ keepEngine: true });
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(workers[0].terminated);
  const later = scanner.geometry("detect", { image: { data: new Uint8ClampedArray(16), width: 2, height: 2 } });
  assert.equal(workers.length, 2, "the next request gets a fresh worker");
  scanner.cancel();
  await assert.rejects(later, { name: "AbortError" });
});

test("partial OCR displays readings but never launches the solver before refinement", async () => {
  const request = deferred(), reads = [], solves = [];
  const puzzle = makePuzzle("latinsquare", 2); puzzle.cells[0] = 1;
  const found = { puzzle, markedCells: [0], cellUncertain: [], notes: [] };
  const session = createLiveSession({ read(frame, progress, partial) { reads.push(partial); return request.promise; },
    solve(p) { solves.push(p); return Promise.resolve(null); }, cancelRead() {}, cancelSolve() {}, onChange() {}, onStatus() {} });
  const frame = { signature: new Uint8Array(4096), key: "2", corners: [{ x: 0, y: 0 }], width: 200, sharpness: 100 };
  session.start(); session.observe(frame); session.observe(frame);
  reads[0]({ ...found, refining: true }); assert.equal(session.preview.found.refining, true); assert.equal(solves.length, 0);
  request.resolve(found); await tick(); assert.equal(solves.length, 1); session.stop();
});
test("a late partial is ignored after the scene changed", async () => {
  const request = deferred(); let partial;
  const session = createLiveSession({ read(frame, progress, callback) { partial = callback; return request.promise; }, solve: async () => null,
    cancelRead() {}, cancelSolve() {}, onChange() {}, onStatus() {} });
  const frame = { signature: new Uint8Array(4096), key: "2", corners: [{ x: 0, y: 0 }], width: 200, sharpness: 100 };
  session.start(); session.observe(frame); session.observe(frame); session.motion(new Uint8Array(4096).fill(200));
  const found = { puzzle: makePuzzle("latinsquare", 2), cellUncertain: [], notes: [] };
  partial(found); assert.equal(session.preview, null); request.resolve(found); await tick(); assert.equal(session.preview, null); session.stop();
});
