import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSolver } from "../live-solver.js";
import { createLiveCamera } from "../live-camera.js";
import { setupPhotoFlow } from "../photo-flow.js";

// The page runs one Python interpreter: the camera's previews take over the
// page's idle one, and closing the camera hands an idle one back, so Solve
// after live scanning does not download and start Python again.

function fakeWorker(name) {
  return { name, messages: [], terminated: false,
    postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
}
function solverHarness() {
  const made = [], timers = new Map();
  let serial = 0;
  const solver = createLiveSolver({
    makeWorker() { const worker = fakeWorker(`made-${made.length}`); made.push(worker); return worker; },
    setTimer(fn) { timers.set(++serial, fn); return serial; },
    clearTimer(id) { timers.delete(id); },
  });
  return { solver, made, timers };
}

test("an adopted interpreter serves the previews without a second start-up", async () => {
  const { solver, made } = solverHarness(), page = fakeWorker("page");
  solver.adopt(page);
  assert.deepEqual(page.messages, [{ type: "warm" }], "asks the shared load to report readiness");
  solver.prepare();
  const pending = solver.solve({ cells: [] });
  assert.equal(made.length, 0, "no second interpreter");
  const request = page.messages.at(-1);
  page.onmessage({ data: { type: "result", id: request.id, result: "solved" } });
  assert.equal(await pending, "solved");
});

test("a solver that already has an interpreter retires the offered one", () => {
  const { solver, made } = solverHarness(), offered = fakeWorker("offered");
  solver.prepare();
  solver.adopt(offered);
  assert.equal(offered.terminated, true);
  assert.equal(made[0].terminated, false);
});

test("an idle or warming interpreter is released intact and detached", () => {
  const { solver, made, timers } = solverHarness();
  solver.prepare();
  const released = solver.release();
  assert.equal(released, made[0]);
  assert.equal(released.terminated, false);
  assert.equal(released.onmessage, null);
  assert.equal(released.onerror, null);
  assert.equal(timers.size, 0, "the warm-up deadline goes with it");
  assert.equal(solver.release(), null);
  solver.prepare();
  assert.equal(made.length, 2, "the next preview loads its own");
});

test("a running preview search is terminated, not handed on", async () => {
  const { solver, made } = solverHarness();
  const pending = solver.solve({ cells: [] });
  assert.equal(solver.release(), null);
  assert.equal(made[0].terminated, true);
  assert.equal(await pending, null);
});

function camera(t, options) {
  const previous = globalThis.document;
  const context = { drawImage() {}, clearRect() {}, fillRect() {}, fillText() {}, save() {}, restore() {},
    translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) };
  const canvas = () => ({ width: 64, height: 64, dataset: {}, getContext: () => context, setAttribute() {} });
  globalThis.document = { createElement: canvas };
  t.after(() => { globalThis.document = previous; });
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: true }); return nodes.get(id); };
  return createLiveCamera({ $, video: { videoWidth: 64, videoHeight: 64, currentTime: 0 }, canvas: canvas(),
    getSettings: () => ({ type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true }),
    detector: { detect: () => new Promise(() => {}), cancel() {} },
    reader: { read: () => new Promise(() => {}), cancel() {} },
    tracker: { anchor: () => new Promise(() => {}), verify: () => new Promise(() => {}), reset() {} },
    setTimer: () => 0, clearTimer() {}, now: () => 0, ...options });
}

test("closing the camera hands its idle interpreter back to the page", (t) => {
  const { solver, made } = solverHarness(), page = fakeWorker("page"), returned = [];
  const live = camera(t, { solver, solverWorker: page, onSolverReleased: (worker) => returned.push(worker) });
  live.start();
  assert.equal(made.length, 0, "warming the previews reuses the page's interpreter");
  live.stop();
  assert.deepEqual(returned, [page]);
  assert.equal(page.terminated, false);
});

test("closing the camera during a preview search terminates it instead", (t) => {
  const { solver } = solverHarness(), page = fakeWorker("page"), returned = [];
  const live = camera(t, { solver, solverWorker: page, onSolverReleased: (worker) => returned.push(worker) });
  live.start();
  void solver.solve({ cells: [] });
  live.stop();
  assert.deepEqual(returned, []);
  assert.equal(page.terminated, true);
});

test("an idle interpreter nobody takes is terminated when the camera closes", (t) => {
  const { solver } = solverHarness(), page = fakeWorker("page");
  const live = camera(t, { solver, solverWorker: page });
  live.start();
  live.stop();
  assert.equal(page.terminated, true);
});

function flow(t, { mediaDevices, autoSolve = true } = {}) {
  const nodes = new Map(), handed = [], returned = [], factories = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: true, setAttribute() {}, scrollIntoView() {}, focus() {} });
    return nodes.get(id);
  };
  for (const key of ["document", "navigator", "setTimeout", "clearTimeout"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices } });
  globalThis.document = { addEventListener() {}, createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  Object.assign($("video"), { videoWidth: 64, videoHeight: 64, play: async () => {} });
  $("auto-solve").checked = autoSolve;
  const page = fakeWorker("page");
  const photo = setupPhotoFlow({
    $, state: {}, scanner: { cancel() {} }, stopTask() {}, status() {}, invalidate() {}, fail(error) { throw error; },
    releaseSolver: (handOff) => { handed.push(handOff); return handOff ? page : null; },
    adoptSolver: (worker) => returned.push(worker),
    liveFactory: (options) => { factories.push(options); return { start() {}, stop() {} }; },
  });
  return { $, page, handed, returned, factories, photo };
}

test("the camera's previews take over the page's interpreter when they will solve", async (t) => {
  const stream = { getTracks: () => [] };
  const h = flow(t, { mediaDevices: { getUserMedia: async () => stream } });
  await h.$("camera").onclick();
  assert.deepEqual(h.handed, [true]);
  assert.equal(h.factories.length, 1);
  assert.equal(h.factories[0].solverWorker, h.page);
  assert.equal(typeof h.factories[0].onSolverReleased, "function");
  h.photo.stopCamera();
  assert.deepEqual(h.returned, [], "the camera, not the parking slot, now owns it");
});

test("the page keeps its interpreter when the camera never starts", async (t) => {
  const h = flow(t, { mediaDevices: undefined });
  await h.$("camera").onclick();
  assert.deepEqual(h.handed, [true]);
  assert.equal(h.factories.length, 0);
  assert.deepEqual(h.returned, [h.page]);
});

test("without automatic solving the camera takes no interpreter", async (t) => {
  const stream = { getTracks: () => [] };
  const h = flow(t, { mediaDevices: { getUserMedia: async () => stream }, autoSolve: false });
  await h.$("camera").onclick();
  assert.deepEqual(h.handed, [false]);
  assert.equal(h.factories[0].solverWorker, null);
});
