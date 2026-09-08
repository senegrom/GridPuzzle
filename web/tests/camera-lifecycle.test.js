import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { createTaskController } from "../task-controller.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function camera(t, { permission = false, playback = false } = {}) {
  const nodes = new Map(), timers = new Map(), statuses = [];
  const acquired = deferred(), played = deferred(), detected = deferred();
  let serial = 0, stopped = 0, captures = 0;
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, hidden: true, setAttribute() {}, scrollIntoView() {} });
    return nodes.get(id);
  };
  for (const key of ["document", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: () => acquired.promise },
  } });
  globalThis.document = {
    addEventListener() {},
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  };
  globalThis.setTimeout = (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.setInterval = () => ++serial;
  globalThis.clearInterval = () => {};
  Object.assign($("video"), { videoWidth: 640, videoHeight: 640, play: () => played.promise });
  $("auto-capture").checked = true;
  const scanner = { cancel() {}, detect: () => detected.promise };
  const tasks = createTaskController({ $, scanner, status() {}, onStop: () => flow.stopCamera() });
  const flow = setupPhotoFlow({
    $, state: {}, scanner, stopTask: tasks.stop,
    status: (text) => statuses.push(text),
    invalidate: () => { captures++; }, fail: (error) => { throw error; },
  });
  if (!permission) acquired.resolve(stream);
  if (!playback) played.resolve();
  return {
    $, tasks, statuses,
    get stopped() { return stopped; }, get captures() { return captures; },
    open: () => $("camera").onclick(),
    allow: () => acquired.resolve(stream), play: () => played.resolve(),
    detect: () => detected.resolve({ corners: [], rows: 4, cols: 4, confidence: .99, sharpness: 200 }),
    async tick() {
      const next = [...timers].find(([, timer]) => [800, 900].includes(timer.ms));
      if (!next) return;
      timers.delete(next[0]);
      await next[1].fn();
    },
    get pending() { return timers.size; },
  };
}
test("cancelling while camera permission is pending stops the acquired stream", async (t) => {
  const h = camera(t, { permission: true }), open = h.open();
  h.tasks.stop();
  h.allow();
  await open;
  assert.equal(h.stopped, 1);
  assert.equal(h.$("camera-panel").hidden, true);
  assert.equal(h.statuses.includes("Camera ready."), false);
});
test("late playback cannot announce camera readiness after editing takes over", async (t) => {
  const h = camera(t, { playback: true }), open = h.open();
  await Promise.resolve();
  h.tasks.stop();
  h.play();
  await open;
  assert.equal(h.statuses.includes("Camera ready."), false);
  assert.equal(h.pending, 0);
});
test("a queued camera loop cannot capture after a solve begins", async (t) => {
  const h = camera(t);
  await h.open();
  const id = h.tasks.begin();
  await h.tick();
  assert.equal(h.stopped, 1);
  assert.equal(h.captures, 0);
  assert.equal(h.tasks.id, id);
  assert.equal(h.tasks.busy, true);
  assert.equal(h.pending, 0);
  h.tasks.finish();
});
test("a late camera detector cannot continue capture after cancellation", async (t) => {
  const h = camera(t);
  await h.open();
  const detection = h.tick();
  h.tasks.stop();
  h.detect();
  await detection;
  assert.equal(h.captures, 0);
  assert.equal(h.pending, 0);
});
