import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker, ANCHOR_DEADLINE, VERIFY_DEADLINE } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The production camera and tracker on a fake clock, with a fake worker that
// runs the real tracking core and answers each operation after delay(op)
// milliseconds, or never when delay(op) is null. Readings never finish unless
// readMs is given; then each finishes after readMs and solves at once.
function simulation(t, delay, { readMs = null } = {}) {
  let time = 0, serial = 0;
  const timers = new Map(), nodes = new Map();
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(180) }) };
  const canvas = () => ({ width: 700, height: 700, dataset: {}, attributes: {}, getContext: () => context, setAttribute(name, value) { this.attributes[name] = value; } });
  const previous = globalThis.document;
  globalThis.document = { createElement: canvas };
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  // The help line is a polite live region: every write is announced.
  const writes = []; let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const counts = { replies: 0, adopted: 0, failures: 0, reads: 0 };
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        const ms = delay(message.op);
        if (ms !== null) setTimer(() => {
          if (worker.dead) return;
          let data;
          try { data = { id: message.id, result: core.run(message), milliseconds: ms }; } catch (error) { data = { id: message.id, error: error.message }; }
          if (message.op === "verify") counts.replies++;
          worker.onmessage?.({ data });
        }, ms);
      },
      terminate() { worker.dead = true; },
    };
    return worker;
  } });
  const found = { confidence: .99, rows: 2, cols: 2, sharpness: 200, corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] };
  const camera = createLiveCamera({ tracker, $, canvas: view,
    diagnostics: { event(e) { if (e.reason === "worker-error") counts.failures++; }, configure() {}, geometry() {}, scheduling() {}, rendering() {},
      tracking(_stats, info) { if ("stale" in info) counts.adopted++; } },
    video: { videoWidth: 700, videoHeight: 700, get currentTime() { return time / 1000; } },
    getSettings: () => ({ type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true }),
    // A quick detector; by default readings never finish, since only the display is measured.
    detector: { detect: () => new Promise((resolve) => setTimer(() => resolve(structuredClone(found)), 50)), cancel() {} },
    reader: { read() {
      counts.reads++;
      if (readMs === null) return new Promise(() => {});
      return new Promise((resolve) => setTimer(() => {
        const puzzle = makePuzzle("latinsquare", 2, 2); puzzle.cells = [1, null, null, null];
        resolve({ puzzle, cellUncertain: [], markedCells: [] });
      }, readMs));
    }, cancel() {} },
    solver: readMs === null ? { solve: async () => null, cancel() {} }
      : { solve: async () => ({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 2, 1] }] }), cancel() {}, invalidate() {} },
    now: () => time, setTimer, clearTimer });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; time = job.at; timers.delete(id); job.fn(); await flush();
    }
    time = end; await flush();
  }
  // The view every 50 ms: unverified, live or delayed.
  async function observe(ms) {
    const states = [];
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      await advance(50);
      states.push(!camera.diagnosticSource().verified ? "unverified" : view.dataset.delayed === "1" ? "delayed" : "live");
    }
    return states;
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, counts, advance, observe, $, writes };
}
const changes = (states) => states.filter((state, i) => i && state !== states[i - 1]).length;
const share = (states, state) => states.filter((s) => s === state).length / states.length;

test("prompt replies keep a steady live view", async (t) => {
  const s = simulation(t, (op) => op === "anchor" ? 20 : 100);
  await s.advance(3000);
  const states = await s.observe(8000);
  assert.equal(share(states, "live"), 1); assert.equal(s.counts.reads, 1);
});

for (const ms of [300, 350, 400])
  test(`steady ${ms} ms replies hold the delayed tier instead of flipping on every reply`, async (t) => {
    const s = simulation(t, (op) => op === "anchor" ? 20 : ms);
    await s.advance(3000);
    const states = await s.observe(10000);
    assert.equal(changes(states), 0, "the tier label, data-delayed and the aria-label must not flap");
    assert.equal(share(states, "delayed"), 1, "a view 0.3-1 s behind the camera is marked DELAYED");
    assert.equal(s.counts.reads, 1, "reading starts on the delayed tier: candidates are verified, not replaced");
  });

test("after a fallback, replies whose snapshots are within the stale limit are still adopted", async (t) => {
  for (const [ms, verified] of [[1300, .35], [1600, .12]]) {
    const s = simulation(t, (op) => op === "anchor" ? 20 : ms);
    await s.advance(3000);
    const replies = s.counts.replies, adopted = s.counts.adopted, states = await s.observe(15000);
    assert.equal(s.counts.adopted - adopted, s.counts.replies - replies, `${ms} ms: no reply within the limit is fenced out`);
    assert.ok(1 - share(states, "unverified") >= verified, `${ms} ms: the delayed overlay is shown between fallbacks`);
    assert.equal(share(states, "live"), 0); assert.equal(s.counts.failures, 0);
    s.camera.stop();
  }
});

test("a slow anchor within its own deadline succeeds instead of failing the worker", async (t) => {
  const slow = 5 * VERIFY_DEADLINE / 2;
  assert.ok(slow > VERIFY_DEADLINE && slow < ANCHOR_DEADLINE);
  const s = simulation(t, (op) => op === "anchor" ? slow : 100);
  await s.advance(3 * slow);
  assert.equal(s.counts.failures, 0); assert.equal(s.camera.stats.recovery.failures, 0);
  assert.equal(s.counts.reads, 1, "two slow anchors are enough to start reading");
  const states = await s.observe(10000);
  assert.ok(share(states, "unverified") < 1, "verified views are shown between anchors");
  assert.equal(s.counts.failures, 0);
});

// No verification runs while an anchor is built, so an anchor longer than the
// two-second stale limit plus the five-second loss limit used to reset the
// reference on every attempt: reading never started and "Grid lost" repeated.
for (const slow of [8000, 15000])
  test(`a ${slow / 1000} s anchor still starts reading without a grid-lost reset`, async (t) => {
    assert.ok(slow < ANCHOR_DEADLINE);
    const s = simulation(t, (op) => op === "anchor" ? slow : 100);
    await s.advance(2 * slow + 3000);
    assert.equal(s.counts.reads, 1, "two anchors are enough to start reading");
    assert.equal(s.writes.filter((text) => /Grid lost/.test(text)).length, 0, "building an anchor is not a lost grid");
    assert.equal(s.counts.failures, 0);
    const states = await s.observe(10000);
    assert.ok(share(states, "unverified") < .5, "the reading is tracked between anchors");
  });

test("one-second anchors leave a tracked preview live most of the time", async (t) => {
  const s = simulation(t, (op) => op === "anchor" ? 1000 : 30, { readMs: 1000 });
  await s.advance(8000);
  assert.equal(s.counts.reads, 1);
  const states = await s.observe(30000);
  // Each anchor pauses verification for a second and the delayed tier then
  // holds for two more; re-detecting every second kept the view DELAYED.
  assert.ok(share(states, "live") >= .6, `live ${share(states, "live")}`);
  assert.equal(share(states, "unverified"), 0);
});

test("slow verifications do not alternate the help line", async (t) => {
  for (const ms of [1000, 1300, 1600]) {
    const s = simulation(t, (op) => op === "anchor" ? 20 : ms);
    await s.advance(10000);
    assert.equal(s.counts.reads, 1);
    const before = s.writes.length, states = await s.observe(15000);
    assert.ok(share(states, "unverified") > 0 || ms === 1000, `${ms} ms: the view does fall back between replies`);
    // Each fallback used to announce "Aligning the grid" and each reply the
    // status again: six to nine announcements every five seconds.
    assert.ok(s.writes.length - before <= 1, `${ms} ms: ${s.writes.slice(before).join(" | ")}`);
    s.camera.stop();
  }
});

test("a worker that never answers an anchor still reaches backoff and Restart", async (t) => {
  const s = simulation(t, () => null);
  await s.advance(ANCHOR_DEADLINE + 200);
  assert.equal(s.camera.stats.recovery.failures, 1, "the anchor deadline fails closed");
  assert.equal(s.$("restart-live").hidden, true);
  await s.advance(2 * ANCHOR_DEADLINE + 8000);
  assert.equal(s.camera.stats.recovery.blocked, true); assert.equal(s.counts.failures, 3);
  assert.equal(s.$("restart-live").hidden, false); assert.match(s.$("camera-help").textContent, /Restart live scanning/);
});

test("a worker that stops answering verifications fails at the verify deadline", async (t) => {
  const s = simulation(t, (op) => op === "anchor" ? 20 : null);
  await s.advance(VERIFY_DEADLINE + 400);
  assert.equal(s.camera.stats.recovery.failures, 1, "the verify deadline is not lengthened");
  await s.advance(4 * VERIFY_DEADLINE + 6000);
  assert.equal(s.camera.stats.recovery.blocked, true); assert.equal(s.$("restart-live").hidden, false);
});
