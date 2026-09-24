import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const SIZE = 700, GRID = 440, CELLS = 4;

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of a SIZE x SIZE frame.
function scene(x, y) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  const rect = (left, top, w, h, value) => {
    for (let yy = Math.max(0, top); yy < Math.min(SIZE, top + h); yy++)
      for (let xx = Math.max(0, left); xx < Math.min(SIZE, left + w); xx++) {
        const at = 4 * (yy * SIZE + xx); data[at] = data[at + 1] = data[at + 2] = value;
      }
  };
  const cell = GRID / CELLS;
  for (let i = 0; i <= CELLS; i++) { rect(x + i * cell - 1, y - 1, 3, GRID + 3, 20); rect(x - 1, y + i * cell - 1, GRID + 3, 3, 20); }
  for (let r = 0; r < CELLS; r++) for (let c = 0; c < CELLS; c++) {
    const left = x + c * cell + 38, top = y + r * cell + 30;
    rect(left, top, 8, 50, 30); rect(left, top, 30, 8, 30);
    if ((r + c) % 2) rect(left + 22, top + 21, 8, 29, 30);
    if (r % 2) rect(left, top + 42, 30, 8, 30);
  }
  return { width: SIZE, height: SIZE, data };
}
const cornersAt = (x, y) => [{ x, y }, { x: x + GRID, y }, { x: x + GRID, y: y + GRID }, { x, y: y + GRID }];

test("an anchor re-locks after a jump once a detection of the moved grid has matched it", () => {
  const core = createTrackingCore();
  const first = core.run({ op: "anchor", image: scene(120, 110), corners: cornersAt(120, 110), rows: 4, cols: 4, anchors: [] }).anchor.id;
  assert.ok(core.run({ op: "verify", image: scene(122, 111), anchors: [first] }).proofs[first], "tracked before the jump");
  // 42 px across and 28 px down: outside the registration's search window.
  const moved = scene(164, 139);
  assert.equal(core.run({ op: "verify", image: moved, anchors: [first] }).proofs[first], null, "the jump loses the lock");
  const detection = core.run({ op: "anchor", image: moved, corners: cornersAt(164, 139), rows: 4, cols: 4, anchors: [first] });
  assert.equal(detection.anchor.matches[first], true, "the moved grid is the same print");
  const proof = core.run({ op: "verify", image: scene(165, 139), anchors: [first] }).proofs[first];
  assert.ok(proof, "verification searches where the detection matched it");
  assert.ok(Math.hypot(proof.corners[0].x - 165, proof.corners[0].y - 139) < 1.5, JSON.stringify(proof.corners[0]));
});

test("a detection from an older frame does not pull a tracked anchor's search back", () => {
  const core = createTrackingCore();
  const first = core.run({ op: "anchor", image: scene(120, 110), corners: cornersAt(120, 110), rows: 4, cols: 4, anchors: [] }).anchor.id;
  // The grid moves steadily; verification follows it.
  for (const [x, y] of [[124, 112], [128, 114], [132, 116]])
    assert.ok(core.run({ op: "verify", image: scene(x, y), anchors: [first] }).proofs[first], `tracked at ${x},${y}`);
  // A detection started on an earlier frame finishes only now.
  const late = core.run({ op: "anchor", image: scene(122, 111), corners: cornersAt(122, 111), rows: 4, cols: 4, anchors: [first] });
  assert.equal(late.anchor.matches[first], true);
  // 14 px from the old detection, 6 px from where verification last found it.
  assert.ok(core.run({ op: "verify", image: scene(136, 118), anchors: [first] }).proofs[first], "the anchor keeps tracking");
});

// The production camera, tracker and tracking core on a fake clock with a
// moving printed grid; detection is stubbed to find it where it is.
function simulation(t) {
  let time = 0, serial = 0, x = 120, y = 110;
  const timers = new Map(), nodes = new Map(), verified = [];
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (_x, _y, width, height) => width === SIZE && height === SIZE ? scene(x, y)
      : { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } };
  const canvas = () => ({ width: SIZE, height: SIZE, dataset: {}, attributes: {}, getContext: () => context, setAttribute(name, value) { this.attributes[name] = value; } });
  const previous = globalThis.document;
  globalThis.document = { createElement: canvas };
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  const writes = []; let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const counts = { reads: 0, failures: 0 };
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        if (message.op === "verify") verified.push(message.anchors.length);
        setTimer(() => {
          if (worker.dead) return;
          let data;
          try { data = { id: message.id, result: core.run(message), milliseconds: 20 }; } catch (error) { data = { id: message.id, error: error.message }; }
          worker.onmessage?.({ data });
        }, 20);
      },
      terminate() { worker.dead = true; },
    };
    return worker;
  } });
  // The camera hands detection a copy scaled to at most 640 pixels.
  const small = (p) => ({ x: p.x * 639 / (SIZE - 1), y: p.y * 639 / (SIZE - 1) });
  const camera = createLiveCamera({ tracker, $, canvas: view,
    diagnostics: { event(e) { if (e.reason === "worker-error") counts.failures++; }, configure() {}, geometry() {}, scheduling() {}, rendering() {}, tracking() {} },
    video: { videoWidth: SIZE, videoHeight: SIZE, get currentTime() { return time / 1000; } },
    getSettings: () => ({ type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true }),
    detector: { detect: () => new Promise((resolve) => setTimer(() => resolve({ confidence: .99, rows: 4, cols: 4, sharpness: 200,
      corners: cornersAt(x, y).map(small) }), 50)), cancel() {} },
    reader: { read() {
      counts.reads++;
      return new Promise((resolve) => setTimer(() => {
        const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
        resolve({ puzzle, cellUncertain: [], markedCells: [] });
      }, 500));
    }, cancel() {} },
    solver: { solve: async () => ({ status: "unique", complete: true,
      solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] }), cancel() {}, invalidate() {} },
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
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, counts, advance, writes, verified, view, move(dx, dy) { x += dx; y += dy; } };
}

test("a reading follows its grid through a jump instead of being lost and read again", async (t) => {
  const s = simulation(t);
  await s.advance(4000);
  assert.equal(s.counts.reads, 1);
  assert.ok(s.camera.diagnosticSource().verified, "the reading is tracked");
  assert.equal(s.view.dataset.solution, "12", "the solved preview is shown");
  s.move(45, 30);
  const states = [];
  for (let elapsed = 0; elapsed < 3000; elapsed += 100) {
    await s.advance(100);
    states.push(s.camera.diagnosticSource().verified);
  }
  assert.ok(states.includes(false), "the jump is too far for the search window");
  assert.equal(states.at(-1), true, "the next detection re-locks the reading");
  assert.equal(s.view.dataset.solution, "12", "and its preview returns");
  await s.advance(6000);
  assert.equal(s.writes.filter((text) => /Grid lost/.test(text)).length, 0);
  assert.equal(s.counts.reads, 1, "the same reading is kept, not read again");
  assert.equal(s.counts.failures, 0);
});

test("a settled reading verifies only its own anchor on each frame", async (t) => {
  const s = simulation(t);
  await s.advance(4000);
  assert.equal(s.view.dataset.solution, "12");
  const from = s.verified.length;
  await s.advance(3000);
  const sizes = s.verified.slice(from);
  // The reference and the best frame are still retained, but their proofs
  // are never read once a reading is shown; each would cost a full content
  // comparison on every frame. Only a new detection's candidate joins the
  // reading's own anchor, until its verdict.
  assert.ok(sizes.length > 5, JSON.stringify(sizes));
  assert.ok(Math.max(...sizes) <= 2 && sizes.filter((n) => n === 1).length > sizes.length / 2, JSON.stringify(sizes));
});
