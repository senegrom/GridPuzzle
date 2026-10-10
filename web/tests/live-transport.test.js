// The camera with the bitmap transport (live-tracker.js, SPEC 4.4): the
// snapshot reaches the worker as a transferred bitmap, which the worker draws
// and reads back, so the main thread reads back no tracking pixels. Every
// bitmap is transferred or closed, whatever retires its frame; a bitmap
// failure restarts acquisition on the camera's own readback without counting
// a failure. The production camera, tracker and tracking core run on a fake
// clock; the fake worker answers the handshake's probe and reads a bitmap
// back as the camera's own readback would (the scene where the grid was when
// the bitmap was made), and every bitmap records whether it was closed or
// transferred.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker, PROBE, HANDSHAKE_WAIT, VERIFY_DEADLINE } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const GRID = 440, CELLS = 4;

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of a W x H frame (as in live-sampling.test.js).
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
const blank = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });

// `transport`: "bitmap" (the probe reads back right), "imagedata" (no bitmaps
// on this thread) or "silent" (the worker never answers the probe).
function simulation(t, { frame: [W, H] = [700, 700], grid = [120, 110], settings = {}, transport = "bitmap",
  startMs = 10, solve = null } = {}) {
  let time = 0, serial = 0, frozenTime = null, replyMs = 20, failing = false, bitmapError = false, failBitmaps = false,
    holdBitmaps = false, transportMs = 9, detectMs = 50, cancels = 0;
  const timers = new Map(), nodes = new Map(), ops = [], created = [], posts = [], bitmaps = [], held = [], results = [], workers = [], rejections = [];
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  function canvas() {
    let width = 300, height = 150;
    const c = { dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const record = (op, extra = {}) => ops.push({ target: c, op, at: time, ...extra });
    Object.defineProperties(c, {
      width: { get: () => width, set(value) { width = value; } },
      height: { get: () => height, set(value) { height = value; } },
    });
    const ctx = { canvas: c, drawImage(source, ...box) { record("drawImage", { source, box }); }, clearRect() {},
      fillText() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {},
      getImageData(_x, _y, w, h) {
        const result = grid && w === W && h === H ? scene(W, H, grid[0], grid[1]) : blank(w, h);
        record("getImageData", { w, h, result });
        return result;
      } };
    c.getContext = () => ctx;
    return c;
  }
  // A bitmap keeps the scene as it was when it was made; transfer and close()
  // both detach it.
  function bitmap(source, label = "frame") {
    const b = { label, source, grid: grid && [...grid], width: source?.width ?? 2, height: source?.height ?? 2, closed: false, transferred: false, at: time,
      close() { if (!this.transferred) this.closed = true; this.width = this.height = 0; } };
    bitmaps.push(b); ops.push({ op: "bitmap", bitmap: b, at: time }); return b;
  }
  const previous = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  globalThis.document = { createElement: () => { const c = canvas(); created.push({ canvas: c, at: time }); return c; } };
  globalThis.createImageBitmap = (source) => {
    if (failBitmaps) return Promise.reject(new DOMException("No bitmap", "InvalidStateError"));
    const made = bitmap(source);
    if (!holdBitmaps) return Promise.resolve(made);
    return new Promise((resolve, reject) => held.push({ resolve: () => resolve(made),
      // Made after all: the bitmap was never handed over.
      reject: () => { bitmaps.splice(bitmaps.indexOf(made), 1); reject(new DOMException("No bitmap", "InvalidStateError")); } }));
  };
  const element = () => ({ textContent: "", hidden: true, attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; } });
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const writes = []; let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const tracker = createLiveTracker({ setTimer, clearTimer,
    probe: transport === "imagedata" ? () => null : () => Promise.resolve(bitmap(null, "probe")),
    makeWorker() {
      const core = createTrackingCore(), worker = {
        dead: false,
        postMessage(message, transfer = []) {
          for (const item of transfer) if (bitmaps.includes(item)) { item.transferred = true; item.width = item.height = 0; }
          posts.push({ op: message.op, at: time, bitmap: message.bitmap ?? null, image: message.image ?? null, transfer,
            width: message.width ?? message.image?.width, height: message.height ?? message.image?.height });
          if (message.op === "probe") {
            if (transport !== "silent") setTimer(() => { if (!worker.dead) worker.onmessage?.({ data: { probe: { pixels: [...PROBE] } } }); }, 2);
            return;
          }
          setTimer(() => {
            if (worker.dead) return;
            let data;
            try {
              if (failing) throw Error("injected worker failure");
              if (message.bitmap && bitmapError) data = { id: message.id, error: "bitmap-unsupported" };
              else {
                // The worker's readback: the scene where the grid was when the
                // bitmap was made, at the frame's own size as the camera reads it.
                const pixels = !message.bitmap ? message.image
                  : message.bitmap.grid && message.width === W && message.height === H ? scene(W, H, ...message.bitmap.grid) : blank(message.width, message.height);
                const result = core.run({ ...message, image: pixels });
                if (message.op === "verify") results.push(JSON.stringify(result.proofs));
                for (const rejection of Object.values(result.rejections ?? {})) rejections.push({ at: time, reason: rejection.reason });
                data = { id: message.id, result, milliseconds: 20, transportMilliseconds: message.bitmap ? transportMs : 0 };
              }
            } catch (error) { data = { id: message.id, error: error.message }; }
            worker.onmessage?.({ data });
          }, replyMs);
        },
        terminate() { worker.dead = true; },
      };
      worker.createdAt = time; workers.push(worker);
      setTimer(() => { if (!worker.dead) worker.onmessage?.({ data: { started: true } }); }, startMs);
      return worker;
    } });
  const diagnostics = createScanDiagnostics({ now: () => time }), detections = [];
  diagnostics.begin("live", { type: "latinsquare", rows: 4, cols: 4 });
  // The tick metric's call, in the order of everything else.
  const ticking = diagnostics.ticking;
  diagnostics.ticking = (ms) => { ops.push({ op: "ticking", at: time }); ticking(ms); };
  const video = { videoWidth: W, videoHeight: H, get currentTime() { return (frozenTime ?? time) / 1000; } };
  const reading = () => {
    const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
    return { puzzle, cellUncertain: [], markedCells: [], notes: [] };
  };
  const live = { ...settings };
  const camera = createLiveCamera({ tracker, $, canvas: view, diagnostics, video,
    getSettings: () => ({ type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true, autoSolve: !!solve, ...live }),
    detector: { detect(input) {
      const sx = (input.width - 1) / (W - 1), sy = (input.height - 1) / (H - 1), at = grid;
      detections.push(time);
      return new Promise((resolve) => setTimer(() => resolve(at
        ? { confidence: .99, rows: 4, cols: 4, sharpness: 200, corners: cornersAt(...at).map((p) => ({ x: p.x * sx, y: p.y * sy })) }
        : { confidence: .2, rows: 0, cols: 0, sharpness: 10, corners: null }), detectMs));
    }, cancel() { cancels++; } },
    reader: { read: () => new Promise((resolve) => setTimer(() => resolve(reading()), 500)), cancel() {} },
    solver: solve ? { solve: async () => solve, cancel() {}, invalidate() {} } : { solve: () => new Promise(() => {}), cancel() {}, invalidate() {} },
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
  const contentCanvas = created[0].canvas;
  t.after(() => { camera.stop(); globalThis.document = previous.document; globalThis.createImageBitmap = previous.createImageBitmap; });
  camera.start();
  return { camera, view, video, ops, posts, bitmaps, results, workers, diagnostics, advance, until, live, contentCanvas, rejections, detections,
    get cancels() { return cancels; }, detectDelay(ms) { detectMs = ms; },
    get now() { return time; }, get help() { return help; }, writes, restartHidden: () => $("restart-live").hidden,
    // Bitmaps neither transferred nor closed (with nothing still being made).
    open: () => bitmaps.filter((b) => !b.closed && !b.transferred),
    // The camera's tracking readbacks on the main thread.
    readbacks: () => ops.filter((o) => o.target === contentCanvas && o.op === "getImageData"),
    jobs: () => posts.filter((p) => p.op !== "probe"),
    reasons: () => diagnostics.snapshot().events.map((e) => e.reason),
    aim(value) { grid = value; }, stall() { frozenTime = time; }, unstall() { frozenTime = null; }, fail(value) { failing = value; },
    replyDelay(ms) { replyMs = ms; }, transportTime(ms) { transportMs = ms; }, bitmapError(value) { bitmapError = value; },
    failBitmaps(value) { failBitmaps = value; }, holdBitmaps(value) { holdBitmaps = value; },
    // Lets the bitmaps held so far be made, or fail to be, with no time passing.
    releaseBitmaps: async () => { for (const entry of held.splice(0)) entry.resolve(); await flush(); },
    failHeldBitmaps: async () => { for (const entry of held.splice(0)) entry.reject(); await flush(); },
    get held() { return held.length; } };
}

test("with the bitmap transport the camera reads back no tracking pixels and every job carries a transferred bitmap", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "the grid is found, tracked and read");
  await h.advance(1500);
  assert.equal(h.camera.stats.tracking.transport, "bitmap");
  assert.deepEqual(h.readbacks(), [], "no tracking readback on the main thread");
  assert.deepEqual(h.ops.filter((o) => o.target === h.contentCanvas), [], "the readback canvas is not even drawn");
  const jobs = h.jobs();
  assert.ok(jobs.filter((p) => p.op === "verify").length >= 10 && jobs.some((p) => p.op === "anchor"));
  for (const job of jobs) {
    assert.ok(job.bitmap, `${job.op} carries a bitmap`); assert.equal(job.image, null);
    assert.deepEqual(job.transfer, [job.bitmap], "transferred"); assert.deepEqual([job.width, job.height], [700, 700]);
    const drawn = (target) => h.ops.find((o) => o.target === target && o.op === "drawImage")?.source;
    const source = drawn(job.bitmap.source);
    assert.ok(source === h.video || drawn(source) === h.video, "a bitmap of a snapshot of the video (or of detection's copy of one)");
  }
  assert.deepEqual(h.open(), [], "every bitmap transferred or closed");
  // The export: the transport, the core's time apart from the transport's.
  const report = h.diagnostics.snapshot();
  assert.equal(report.tracking.transport, "bitmap");
  assert.equal(report.performance.trackingWorker.p50Milliseconds, 20, "the tracking core's time");
  assert.equal(report.performance.trackingTransport.p50Milliseconds, 9, "the worker's draw and readback, apart");
});

test("both transports give the same proofs; the camera's own readback is the fallback", async (t) => {
  const runs = {};
  for (const transport of ["bitmap", "imagedata"]) {
    const h = simulation(t, { transport });
    assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
    await h.advance(2000);
    assert.equal(h.camera.stats.tracking.transport, transport);
    runs[transport] = { proofs: new Set(h.results), readbacks: h.readbacks().length, bitmaps: h.jobs().filter((p) => p.bitmap).length,
      dataset: { ...h.view.dataset } };
    h.camera.stop();
  }
  assert.deepEqual([...runs.bitmap.proofs].sort(), [...runs.imagedata.proofs].sort(), "the same proofs of the same scene");
  assert.equal(runs.bitmap.readbacks, 0); assert.ok(runs.imagedata.readbacks >= 10, "the fallback reads back here, as before");
  assert.equal(runs.imagedata.bitmaps, 0, "and posts no bitmap");
  assert.equal(runs.bitmap.dataset.recognised, runs.imagedata.dataset.recognised);
  assert.equal(runs.bitmap.dataset.overlay, "outline"); assert.equal(runs.imagedata.dataset.overlay, "outline");
});

test("the handshake holds the first anchor for at most 300 ms after the worker started, then the camera reads back itself", async (t) => {
  const h = simulation(t, { transport: "silent", startMs: 40 });
  assert.ok(await h.until(() => h.jobs().length > 0, 3000), "the first job is posted");
  const [probe] = h.posts, [first] = h.jobs();
  assert.equal(probe.op, "probe");
  assert.equal(first.op, "anchor"); assert.equal(first.bitmap, null); assert.ok(first.image, "the camera's own readback");
  assert.equal(probe.at, h.workers[0].createdAt, "the probe goes out with the first anchor's request for the transport");
  assert.equal(first.at, h.workers[0].createdAt + 40 + HANDSHAKE_WAIT, "the anchor, once the wait after the worker's start ran out");
  assert.equal(h.camera.stats.tracking.transport, "imagedata"); assert.equal(h.camera.stats.recovery.failures, 0);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "and the grid is read");
  assert.deepEqual(h.open().map((b) => b.label), [], "the probe bitmap was transferred");
});

// Whatever retires a frame while its bitmap is being made, the bitmap is
// closed and not posted: a closed camera, a frozen view, Clear, a changed
// setting, a Restart and a worker failure all start a new epoch.
for (const [name, retire] of [
  ["the camera is closed", (h) => h.camera.stop()],
  ["the settings change", async (h) => { h.live.rows = 5; h.live.cols = 5; await h.advance(110); }],
  ["Restart", (h) => h.camera.restart()],
  ["the worker fails", async (h) => { h.fail(true); await h.advance(500); assert.equal(h.camera.stats.recovery.failures, 1); }],
]) test(`a verification's bitmap made after ${name} is closed and not posted`, async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  // Slow replies keep a verification in flight while the next bitmap is made.
  h.replyDelay(450); await h.advance(1000);
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "a verification's bitmap is being made");
  const late = h.bitmaps.at(-1), posted = h.jobs().length;
  assert.equal(h.camera.stats.tracking.active, 1, "while another is in the worker");
  await retire(h);
  h.holdBitmaps(false); await h.releaseBitmaps();
  assert.equal(late.closed, true, "closed"); assert.equal(late.transferred, false);
  assert.ok(!h.jobs().slice(posted).some((p) => p.bitmap === late), "not posted");
  await h.advance(50);
  assert.deepEqual(h.open(), []);
});

test("a verification's bitmap made after the view froze is closed and not posted", async (t) => {
  let solved;
  const h = simulation(t, { solve: new Promise((resolve) => { solved = resolve; }) });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read; the solver has not answered");
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "a verification's bitmap is being made");
  const late = h.bitmaps.at(-1), posted = h.jobs().length;
  solved({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] });
  assert.ok(await h.until(() => h.camera.view === "frozen", 1000), "the solved view freezes meanwhile");
  h.holdBitmaps(false); await h.releaseBitmaps();
  assert.equal(late.closed, true, "closed"); assert.equal(late.transferred, false);
  assert.ok(!h.jobs().slice(posted).some((p) => p.bitmap === late), "not posted");
  assert.deepEqual(h.open(), []);
});

test("an anchor's bitmap made after its detection was retired is closed and not posted", async (t) => {
  const h = simulation(t);
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "the first detection's anchor bitmap is being made");
  assert.equal(h.jobs().length, 0);
  h.camera.stop();
  await h.releaseBitmaps();
  assert.equal(h.bitmaps.filter((b) => b.label === "frame").every((b) => b.closed), true);
  assert.deepEqual(h.jobs(), []); assert.deepEqual(h.open(), []);
  assert.equal(h.camera.stats.retainedSources, 0, "its snapshot is released");
});

test("a frozen view, Clear and a closed camera leave no bitmap open, and every queued frame's bitmap is closed", async (t) => {
  const h = simulation(t, { solve: { status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] } });
  // Slow replies: frames queue behind the active one and are replaced.
  h.replyDelay(250);
  assert.ok(await h.until(() => h.camera.view === "frozen", 15000), "the solved view freezes");
  assert.ok(h.camera.stats.tracking.dropped > 0, "queued frames were replaced");
  const dropped = h.bitmaps.filter((b) => b.closed);
  assert.ok(dropped.length > 0, "their bitmaps closed");
  assert.deepEqual(h.open(), [], "nothing open at the freeze");
  assert.equal(h.workers.at(-1).dead, true, "the worker ended at the freeze");
  assert.equal(h.diagnostics.snapshot().tracking.transport, "bitmap", "the export keeps the transport the scan used");
  await h.advance(3000);
  assert.deepEqual(h.open(), [], "nothing made while frozen");
  h.camera.resume();
  assert.ok(await h.until(() => h.camera.view === "frozen", 15000), "Clear: a new worker, a new handshake, frozen again");
  assert.equal(h.workers.length, 2); assert.equal(h.posts.filter((p) => p.op === "probe").length, 2);
  assert.deepEqual(h.open(), []);
  h.camera.resume(); await h.advance(700); h.camera.stop(); await h.advance(500);
  assert.deepEqual(h.open(), [], "nothing open after closing");
  assert.equal(h.bitmaps.filter((b) => b.label === "frame").length,
    h.bitmaps.filter((b) => b.label === "frame" && (b.closed || b.transferred)).length, "created = transferred + closed");
});

// A bitmap failure is no tracking failure: the tracker gives bitmaps up and
// resets; the camera restarts acquisition at once on its own readback, with no
// back-off and no Restart, and reads the grid again.
for (const [name, provoke] of [
  ["the worker cannot read a bitmap back", (h) => h.bitmapError(true)],
  ["no bitmap can be made", (h) => h.failBitmaps(true)],
]) test(`when ${name}, acquisition restarts on the camera's own readback, with no back-off and no Restart`, async (t) => {
  const h = simulation(t);
  provoke(h);
  assert.ok(await h.until(() => h.reasons().includes("tracking-transport"), 3000), "the transport is given up");
  // The first detection's anchor failed: its own frame stays the newest
  // picture scanned, as after any tracking failure.
  assert.equal(h.camera.stats.retainedSources, 1, "the frame the anchor failed on is kept");
  const restartedAt = h.now, recovery = h.camera.stats.recovery;
  assert.equal(recovery.failures, 0, "no failure counted"); assert.equal(recovery.blocked, false);
  assert.equal(h.reasons().includes("worker-error"), false); assert.equal(h.reasons().includes("worker-backoff"), false);
  assert.equal(h.workers[0].dead, true, "the worker and its anchors are gone");
  assert.ok(await h.until(() => h.jobs().some((p) => p.image && p.at >= restartedAt), 1000), "a new anchor within the second, not after a back-off");
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "the grid is read on the camera's own readback");
  assert.equal(h.camera.stats.recovery.failures, 0);
  assert.equal(h.restartHidden(), true, "no Restart");
  assert.deepEqual(h.open(), []);
});

test("a stop during the handshake ends the waiting anchor and releases its snapshot", async (t) => {
  const h = simulation(t, { transport: "silent", startMs: 100000 });
  assert.ok(await h.until(() => h.camera.stats.tracking.active === 1 && h.posts.length === 1, 1000), "the handshake runs");
  await h.advance(200);
  assert.equal(h.jobs().length, 0, "the anchor waits");
  assert.equal(h.camera.stats.retainedSources, 0, "its frame is still the detection's, not kept");
  const frames = h.ops.filter((o) => o.op === "drawImage" && o.source === h.video).map((o) => o.target);
  h.camera.stop(); await h.advance(10);
  assert.ok(frames.every((frame) => frame.width === 0), "every snapshot released");
  assert.deepEqual(h.jobs(), []); assert.equal(h.camera.stats.retainedSources, 0);
  assert.equal(h.camera.stats.recovery.failures, 0);
});

test("the camera's frames are paced by the tracking core's time, not the transport's", async (t) => {
  // The guide alone (automatic reading paused): no settled reading's 250 ms floor.
  const h = simulation(t, { settings: { enabled: false } });
  h.transportTime(400);
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline"));
  await h.advance(1000);
  assert.equal(h.camera.stats.tracking.transportMilliseconds, 400);
  assert.equal(h.camera.stats.scheduling.intervalMilliseconds, 100, "1.5 x 20 ms of core time, floored at 100 ms; not 1.5 x 420");
});

// performance.tick times the main thread's work of a sampling tick, which
// must keep tracking's part of it: the readback (imagedata) or the bitmap's
// copy of the snapshot (bitmap) happens inside the tick, before its metric,
// once the transport is known.
for (const transport of ["bitmap", "imagedata"]) test(`a verification's ${transport === "bitmap" ? "bitmap" : "readback"} is made inside the tick that sampled its frame`, async (t) => {
  const h = simulation(t, { transport });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(1000);
  const index = (test) => h.ops.findIndex(test);
  let checked = 0;
  for (const post of h.posts.filter((p) => p.op === "verify")) {
    const made = transport === "bitmap" ? index((o) => o.op === "bitmap" && o.bitmap === post.bitmap) : index((o) => o.op === "getImageData" && o.result === post.image);
    const snapshot = transport === "bitmap" ? post.bitmap.source
      : h.ops.slice(0, made).reverse().find((o) => o.target === h.contentCanvas && o.op === "drawImage").source;
    const sampled = index((o) => o.target === snapshot && o.op === "drawImage" && o.source === h.video);
    assert.ok(sampled >= 0 && sampled < made, "a snapshot of the video");
    assert.equal(h.ops.slice(sampled, made).some((o) => o.op === "ticking"), false, "made before the tick ended");
    checked++;
  }
  assert.ok(checked >= 5, `${checked} verifications`);
});

// A bitmap failure while a reading is tracked: the worker has a verification
// active and a frame queued, and a detection is in flight. One restart for
// both rejected jobs; the detection is abandoned, not cancelled (the geometry
// worker stays warm), so the next one starts at once; no anchor of the old
// worker is asked for again.
test("a bitmap failure while a reading is tracked restarts acquisition once, at once, and asks the new worker for no old anchor", async (t) => {
  const AIMING = "Hold the grid steady. Recognition and solution appear here automatically.";
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  assert.equal(h.view.dataset.overlay, "outline");
  h.replyDelay(450); h.detectDelay(2000);
  assert.ok(await h.until(() => h.camera.stats.detection === 1 && h.camera.stats.tracking.active === 1 && h.camera.stats.tracking.queuedFrames === 1, 5000),
    "a detection in flight, a verification active and a frame queued");
  const writes = h.writes.length, detections = h.detections.length, cancels = h.cancels;
  h.bitmapError(true);
  assert.ok(await h.until(() => h.reasons().includes("tracking-transport"), 2000));
  const restartedAt = h.now;
  assert.deepEqual(h.writes.slice(writes).filter((text) => text === AIMING), [AIMING], "one restart, saying so once");
  assert.equal(h.cancels, cancels, "the detection is abandoned, not cancelled");
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.restartHidden(), true);
  h.detectDelay(50); h.replyDelay(20);
  assert.ok(await h.until(() => h.detections.length > detections, 150), "a new detection at the next frame");
  assert.ok(h.detections.at(-1) - restartedAt <= 110, `${h.detections.at(-1) - restartedAt} ms after the restart`);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again on the camera's own readback");
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.deepEqual(h.rejections.filter((r) => r.at >= restartedAt && r.reason === "missing-anchor"), [], "no anchor of the old worker asked for");
  assert.deepEqual(h.open(), []);
});

// A bitmap failure while a later detection's candidate waits for its first
// verification and the reading's outline is shown. The restart retires both at
// once, before the next frame: the candidate's anchor died with the worker, so
// it is discarded rather than verified on the next worker, and the outline of
// the old worker's proofs goes. The frame whose bitmap failed stays the newest
// picture scanned, which a capture on a stalled feed keeps, as after any
// tracking failure.
test("a bitmap failure while a candidate waits retires it and the outline at once, and keeps the frame it failed on", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  assert.ok(await h.until(() => h.camera.stats.candidate === 1, 5000), "a later detection's candidate waits");
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "the bitmap of the frame that verifies it is being made");
  const failed = h.bitmaps.at(-1).source;
  assert.equal(h.camera.stats.candidate, 1); assert.equal(h.camera.stats.tracking.active, 0, "no other job in the worker");
  assert.equal(h.view.dataset.overlay, "outline");
  await h.failHeldBitmaps();
  const restartedAt = h.now;
  assert.deepEqual(h.reasons().filter((reason) => reason === "tracking-transport"), ["tracking-transport"], "bitmaps given up");
  assert.equal(h.view.dataset.overlay, "none", "the outline goes before the next frame");
  assert.equal(h.camera.stats.candidate, 0, "the candidate is discarded");
  assert.ok(failed.width > 0, "the frame the bitmap failed on is not released");
  assert.equal(h.camera.stats.retainedSources, 2, "the adopted frame, and the frame scanned since");
  h.holdBitmaps(false); h.stall();
  assert.ok(await h.until(() => !h.camera.stats.scheduling.fresh, 2000), "the feed stalls");
  const shot = h.camera.capture();
  assert.equal(shot.found, null);
  assert.ok(h.ops.some((o) => o.target === shot.photo && o.op === "drawImage" && o.source === failed), "a copy of the frame it failed on");
  h.unstall();
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again on the camera's own readback");
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.deepEqual(h.rejections.filter((r) => r.at >= restartedAt && r.reason === "missing-anchor"), [], "the old candidate's anchor is not asked for");
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.restartHidden(), true);
  assert.deepEqual(h.open(), []);
});

// A worker that dies while it verifies one frame and another waits in its
// queue: a tracking failure, counted as before, since a dead worker is no
// bitmap failure (SPEC 4.4). The queued frame's bitmap is closed and its
// snapshot released; the active frame's bitmap went with the worker. After the
// back-off a new worker probes for bitmaps again and the grid is read on them.
test("a worker that dies with a verification in it and a frame queued closes the queued bitmap; after the back-off bitmaps are used again", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.replyDelay(450);
  assert.ok(await h.until(() => h.camera.stats.tracking.active === 1 && h.camera.stats.tracking.queuedFrames === 1, 5000),
    "a verification in the worker and a frame queued");
  const open = h.open(), sent = h.jobs().at(-1).bitmap, dead = h.workers.at(-1);
  assert.equal(open.length, 1, "the queued frame's bitmap is the only one not handed over");
  assert.equal(sent.transferred, true);
  const [queued] = open, diedAt = h.now;
  dead.onerror({ message: "worker crashed" });
  await h.advance(0);
  assert.equal(queued.closed, true, "the queued frame's bitmap is closed");
  assert.equal(queued.source.width, 0, "and its snapshot released");
  assert.deepEqual(h.open(), []);
  assert.equal(dead.dead, true, "the dead worker is terminated");
  assert.equal(h.camera.stats.recovery.failures, 1, "a tracking failure, as before");
  assert.ok(h.reasons().includes("worker-error")); assert.equal(h.reasons().includes("tracking-transport"), false);
  h.replyDelay(20);
  assert.ok(await h.until(() => h.workers.length === 2 && h.camera.stats.tracking.transport === "bitmap", 4000),
    "a new worker decides for bitmaps again");
  assert.ok(h.workers[1].createdAt >= diedAt + 2000, `not before the back-off (${h.workers[1].createdAt - diedAt} ms)`);
  assert.equal(h.posts.filter((p) => p.op === "probe").length, 2, "with its own probe");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again");
  const later = h.jobs().filter((p) => p.at >= h.workers[1].createdAt);
  assert.ok(later.length > 0 && later.every((p) => p.bitmap && p.bitmap.transferred), "on transferred bitmaps");
  assert.deepEqual(h.open(), []);
});

// Verification replies too late to adopt. With replies taking 1.9 s, the frame
// posted when the worker frees up was sampled up to a frame period earlier, so
// some replies come more than the stale limit (2 s) after their frame: those
// frames are not adopted and their snapshots are released at the reply, while
// the frames whose replies come in time, at exactly 2 s too, are adopted. In
// 12 s the reading is lost and found again, so the replies come 1.9, 2.1, 2.2,
// 2.0 and 2.0 s after their frames. Every bitmap went to the worker when
// posted; at every moment the only bitmaps not handed over are the queued
// jobs'.
test("a verification whose reply comes too late to adopt releases its frame; every bitmap not queued is transferred or closed", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  const REPLY = 1900, from = h.jobs().length, adopted = new Set(), checked = new Set(), late = [], timely = [];
  h.replyDelay(REPLY);
  for (let step = 0; step < 12000; step++) {
    await h.advance(1);
    adopted.add(h.camera.adoptedFrame());
    const stats = h.camera.stats.tracking;
    assert.equal(h.open().length, stats.queuedFrames + stats.queuedAnchors, `${h.now} ms: only queued jobs' bitmaps are not handed over`);
    for (const post of h.jobs().slice(from)) {
      if (post.op !== "verify" || checked.has(post) || h.now < post.at + REPLY) continue;
      checked.add(post);
      const age = post.at + REPLY - post.bitmap.at, snapshot = post.bitmap.source;
      assert.equal(post.bitmap.transferred, true);
      if (age > 2000) { late.push(age); assert.equal(snapshot.width, 0, `a frame ${age} ms old at its reply is released`); }
      else { timely.push(age); assert.equal(h.camera.adoptedFrame(), snapshot, `a frame ${age} ms old at its reply is adopted`); }
    }
  }
  assert.ok(late.length >= 2 && timely.length >= 2, `replies too late ${JSON.stringify(late)}, in time ${JSON.stringify(timely)}`);
  for (const post of h.jobs().slice(from).filter((p) => checked.has(p) && p.at + REPLY - p.bitmap.at > 2000))
    assert.equal(adopted.has(post.bitmap.source), false, "a frame too old at its reply is never adopted");
  assert.equal(h.camera.stats.recovery.failures, 0, "replies within the deadline are no failure");
  h.replyDelay(20);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000));
  assert.deepEqual(h.open(), []);
});

// Verifications that reject every anchor (the grid moved beyond their reach):
// their frames' bitmaps went to the worker like any other, nothing stays
// open, and the moved grid is found and read again on bitmaps.
test("verifications that reject every anchor leave no bitmap open, and the moved grid is read again", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  const from = h.rejections.length, posted = h.jobs().length;
  h.aim([200, 170]);
  assert.ok(await h.until(() => h.rejections.length > from, 2000), "verifications reject");
  assert.ok(await h.until(() => h.view.dataset.recognised === "0", 3000), "the reading is hidden");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 10000), "the moved grid is read again");
  const jobs = h.jobs().slice(posted);
  assert.ok(jobs.length > 0 && jobs.every((p) => p.bitmap && p.bitmap.transferred), "on transferred bitmaps");
  assert.equal(h.camera.stats.recovery.failures, 0);
  assert.deepEqual(h.open(), []);
});
