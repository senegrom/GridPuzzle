// The live camera samples the video only for the pipeline's own work: a
// snapshot to verify a candidate, the guide or a reading, and one per
// detection. While it aims at nothing, no tracking pixels are read back,
// detection gets the snapshot itself, and with nothing ever found the help
// line carries only the detector's guidance. The production camera, tracker
// and tracking core run on a fake clock, and every canvas records what is
// drawn into it, what is read back from it and every assignment of its size.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const GRID = 440, CELLS = 4;
const AIMING = "Hold the grid steady. Recognition and solution appear here automatically.";
const GUIDANCE = "Keep the whole grid in view, in even light.";
const STALLED = "Waiting for a new camera frame. Old readings are hidden; capture to review.";

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of a W x H frame (as in live-overlay-view.test.js).
function scene(W, H, x, y) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (left, top, w, h, value) => {
    for (let yy = Math.max(0, top); yy < Math.min(H, top + h); yy++)
      for (let xx = Math.max(0, left); xx < Math.min(W, left + w); xx++) {
        const at = 4 * (yy * W + xx); data[at] = data[at + 1] = data[at + 2] = value;
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
  return { width: W, height: H, data };
}
const cornersAt = (x, y) => [{ x, y }, { x: x + GRID, y }, { x: x + GRID, y: y + GRID }, { x, y: y + GRID }];

// The production camera on a W x H video. `grid` is where the printed grid
// is, or null for a camera aimed at no grid, where the frames are blank paper
// and the detector finds none; aim() changes it while the camera runs. The
// grid's pixels are read back only at the frame's own size (frames of at
// most 1280 px, which tracking reads unscaled). `settings` are merged into
// the scanner's settings (automatic solving is off).
function simulation(t, { frame: [W, H] = [700, 700], grid = [120, 110], settings = {} } = {}) {
  let time = 0, serial = 0, frozenTime = null, failing = false, rejectAll = false;
  const timers = new Map(), nodes = new Map(), ops = [], created = [], posts = [], detections = [], reads = [];
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  // A canvas element starts at 300 x 150. Assigning its width or height, even
  // to the same value, reallocates and clears its bitmap: each assignment is
  // recorded, as are draws, clears and readbacks.
  function canvas() {
    let width = 300, height = 150;
    const c = { dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const record = (op, extra = {}) => ops.push({ target: c, op, at: time, ...extra });
    Object.defineProperties(c, {
      width: { get: () => width, set(value) { record("width", { value }); width = value; } },
      height: { get: () => height, set(value) { record("height", { value }); height = value; } },
    });
    const ctx = { canvas: c, drawImage(source) { record("drawImage", { source }); }, clearRect() { record("clearRect"); },
      fillText() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      save() {}, restore() {}, translate() {}, rotate() {},
      getImageData(_x, _y, w, h) {
        record("getImageData", { w, h });
        return grid && w === W && h === H ? scene(W, H, grid[0], grid[1]) : { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
      } };
    c.getContext = () => ctx;
    return c;
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => { const c = canvas(); created.push({ canvas: c, at: time }); return c; } };
  const element = () => ({ textContent: "", hidden: true, attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; } });
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  // The help line is a polite live region: every write is announced.
  const writes = []; let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        posts.push({ op: message.op, at: time, width: message.image.width, height: message.image.height });
        setTimer(() => {
          if (worker.dead) return;
          let data;
          try {
            if (failing) throw Error("injected worker failure");
            // rejectVerify(true): the worker answers, but no anchor matches.
            const result = rejectAll && message.op === "verify"
              ? { proofs: Object.fromEntries(message.anchors.map((id) => [id, null])),
                rejections: Object.fromEntries(message.anchors.map((id) => [id, { reason: "cell-content", region: 0 }])) }
              : core.run(message);
            data = { id: message.id, result, milliseconds: 20 };
          } catch (error) { data = { id: message.id, error: error.message }; }
          worker.onmessage?.({ data });
        }, 20);
      },
      terminate() { worker.dead = true; },
    };
    return worker;
  } });
  const diagnostics = createScanDiagnostics({ now: () => time });
  diagnostics.begin("live", { type: "latinsquare", rows: 4, cols: 4 });
  const video = { videoWidth: W, videoHeight: H, get currentTime() { return (frozenTime ?? time) / 1000; } };
  const reading = () => {
    const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
    return { puzzle, cellUncertain: [], markedCells: [], notes: [] };
  };
  const camera = createLiveCamera({ tracker, $, canvas: view, diagnostics, video,
    getSettings: () => ({ type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true, autoSolve: false, ...settings }),
    detector: { detect(input) {
      // The camera hands detection its frame scaled to at most 640 pixels.
      detections.push({ input, at: time });
      const sx = (input.width - 1) / (W - 1), sy = (input.height - 1) / (H - 1), at = grid;
      return new Promise((resolve) => setTimer(() => resolve(at
        ? { confidence: .99, rows: 4, cols: 4, sharpness: 200, corners: cornersAt(...at).map((p) => ({ x: p.x * sx, y: p.y * sy })) }
        : { confidence: .2, rows: 0, cols: 0, sharpness: 10, corners: null }), 50));
    }, cancel() {} },
    reader: { read: () => { reads.push(time); return new Promise((resolve) => setTimer(() => resolve(reading()), 500)); }, cancel() {} },
    solver: { solve: () => new Promise(() => {}), cancel() {}, invalidate() {} },
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
  async function until(predicate, limit = 10000, step = 10) {
    for (let waited = 0; !predicate() && waited < limit; waited += step) await advance(step);
    return predicate();
  }
  const on = (target, op) => ops.filter((o) => o.target === target && (!op || o.op === op));
  const drawnFrom = (target) => on(target, "drawImage").map((o) => o.source);
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, view, video, ops, created, posts, detections, reads, writes, diagnostics, advance, until, on, drawnFrom,
    // The camera's scratch canvases, made at construction: the tracking
    // pixels, then the detection input.
    contentCanvas: created[0].canvas, detectCanvas: created[1].canvas,
    // Snapshots: canvases drawn from the video.
    snapshots: () => created.filter(({ canvas: c }) => drawnFrom(c).includes(video)),
    // The frame each detection was handed: the canvas drawn into its input.
    detected: () => drawnFrom(created[1].canvas),
    get now() { return time; }, get help() { return help; },
    aim(value) { grid = value; }, stall() { frozenTime = time; }, unstall() { frozenTime = null; }, fail(value) { failing = value; },
    rejectVerify(value) { rejectAll = value; },
    reasons: () => diagnostics.snapshot().events.map((e) => e.reason) };
}

test("aiming at no grid for ten seconds writes only the detector's guidance to the help line", async (t) => {
  const h = simulation(t, { grid: null });
  await h.advance(10000);
  assert.equal(h.writes[0], AIMING);
  const later = h.writes.slice(1);
  assert.ok(later.length >= 30, `${later.length} writes, one per detection`);
  assert.deepEqual([...new Set(later)], [GUIDANCE], "no Aligning…, no Grid lost");
  assert.equal(h.reasons().includes("grid-lost"), false, "no grid-lost reset");
});
