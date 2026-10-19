// The camera with the bitmap transport (live-tracker.js, SPEC 4.4): the
// snapshot reaches the worker as a transferred bitmap, which the worker draws
// and reads back, so the main thread reads back no tracking pixels. Every
// bitmap is transferred or closed, whatever retires its frame; a bitmap
// failure restarts acquisition on the camera's own readback without counting
// a failure. The production camera, tracker and tracking core run on a fake
// clock; the fake worker answers the handshake's probe and reads a bitmap
// back with the worker's own reader (live-tracking-pixels.js) over a stand-in
// OffscreenCanvas, on which a bitmap draws what the camera's own readback
// would give (the scene where the grid was when the bitmap was made), and
// every bitmap records whether it was closed or transferred.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker, PROBE, HANDSHAKE_WAIT, VERIFY_DEADLINE, REFUSAL_LIMIT, REFUSAL_SPAN } from "../live-tracker.js";
import { createPixelReader, REFUSALS } from "../live-tracking-pixels.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const GRID = 440, CELLS = 4;

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of the video's frame (as in live-sampling.test.js), drawn
// into a W x H picture of that frame scaled by `s` (1: the frame itself).
function scene(W, H, x, y, s = 1) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const rect = (left, top, w, h, value) => {
    const x0 = Math.round(left * s), y0 = Math.round(top * s), x1 = Math.round((left + w) * s), y1 = Math.round((top + h) * s);
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++)
      for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
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
// on this thread), "silent" (the worker never answers the probe) or "stuck"
// (the worker never finishes the probe, so it answers nothing after it).
// `fps`: the video presents this many frames a second through
// requestVideoFrameCallback, the frame scheduler's own clock; without, the
// scheduler's fallback clock samples at its 100-ms heartbeat.
function simulation(t, { frame: [W, H] = [700, 700], grid = [120, 110], settings = {}, transport = "bitmap",
  startMs = 10, solve = null, fps = 0 } = {}) {
  let time = 0, serial = 0, frozenTime = null, replyMs = 20, failing = false, bitmapError = false, failBitmaps = false,
    holdBitmaps = false, blankBitmaps = false, emptyBitmaps = false, crashOnBitmap = false, transportMs = 9, detectMs = 50, cancels = 0;
  // One-shot faults: the next `refusals` bitmap jobs are answered
  // "bitmap-unsupported"; each entry of `upcoming` is what the next bitmap the
  // camera makes turns out as ("fail", "blank" 1 x 1, "empty" or "ok"); the
  // next `pictureless` readbacks of the camera's own are transparent (a
  // snapshot of a video with no picture); `reads` counts full reads.
  let refusals = 0, reads = 0, pictureless = 0;
  const upcoming = [];
  const timers = new Map(), nodes = new Map(), ops = [], created = [], posts = [], bitmaps = [], held = [], results = [], workers = [], rejections = [];
  // Every frame the tracking core was given: its op, and whether it came from a bitmap.
  const runs = [];
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
      // A readback of the frame, at its own size or scaled (the tracking size).
      getImageData(_x, _y, w, h) {
        const result = pictureless > 0 && pictureless-- ? { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
          : grid && w * H === h * W ? scene(w, h, grid[0], grid[1], w / W) : blank(w, h);
        record("getImageData", { w, h, result });
        return result;
      } };
    c.getContext = () => ctx;
    return c;
  }
  // A bitmap keeps the scene as it was when it was made, and the size of its
  // source then (a snapshot is released once its frame is done with); transfer
  // and close() both detach it.
  function bitmap(source, label = "frame") {
    const b = { label, source, grid: grid && [...grid], width: source?.width ?? 2, height: source?.height ?? 2, closed: false, transferred: false, at: time,
      made: [source?.width ?? 2, source?.height ?? 2],
      close() { if (!this.transferred) this.closed = true; this.width = this.height = 0; } };
    bitmaps.push(b); ops.push({ op: "bitmap", bitmap: b, at: time }); return b;
  }
  const previous = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  globalThis.document = { createElement: () => { const c = canvas(); created.push({ canvas: c, at: time }); return c; } };
  globalThis.createImageBitmap = (source) => {
    const once = upcoming.shift();
    if (failBitmaps || once === "fail") return Promise.reject(new DOMException("No bitmap", "InvalidStateError"));
    // `blankBitmaps`: the size of a blank bitmap made instead of the snapshot's
    // copy (WebKit's answer when it cannot allocate the copy is 1 x 1), which
    // the worker would stretch over the tracking pixels: a blank frame.
    const blankSize = blankBitmaps || (once === "blank" ? [1, 1] : null);
    if (blankSize) { const b = bitmap(source, "blank"); b.grid = null; [b.width, b.height] = blankSize; b.made = [...blankSize]; return Promise.resolve(b); }
    // `emptyBitmaps`: bitmaps of the right size that draw nothing (a buffer
    // lost on its way, or a snapshot of a video with no picture to draw),
    // which leave the worker's cleared canvas transparent.
    const empty = emptyBitmaps || once === "empty", made = bitmap(source, empty ? "empty" : "frame");
    if (empty) made.empty = true;
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
  const tracker = createLiveTracker({ setTimer, clearTimer, now: () => time,
    probe: transport === "imagedata" ? () => null : () => Promise.resolve(bitmap(null, "probe")),
    makeWorker() {
      // The worker's reader over a stand-in OffscreenCanvas: a bitmap draws
      // the scene where the grid was when it was made (blank paper without a
      // grid), scaled to the canvas, as the camera's own readback would give
      // it; an empty one draws nothing.
      const reader = createPixelReader((width, height) => {
        let drawn = null;
        return { width, height, getContext: () => ({
          clearRect() { drawn = null; },
          drawImage(received) { drawn = received.empty ? null : received; },
          getImageData: (_x, _y, w, h) => !drawn ? { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
            : drawn.grid && w * H === h * W ? scene(w, h, ...drawn.grid, w / W) : blank(w, h),
        }) };
      });
      const core = createTrackingCore(), worker = {
        dead: false,
        postMessage(message, transfer = []) {
          for (const item of transfer) if (bitmaps.includes(item)) { item.transferred = true; item.width = item.height = 0; }
          posts.push({ op: message.op, at: time, bitmap: message.bitmap ?? null, image: message.image ?? null, transfer,
            width: message.width ?? message.image?.width, height: message.height ?? message.image?.height, corners: message.corners ?? null });
          if (message.op === "probe") {
            if (transport === "stuck") worker.stuck = true;
            else if (transport !== "silent") setTimer(() => { if (!worker.dead) worker.onmessage?.({ data: { probe: { pixels: [...PROBE] } } }); },
              Math.max(0, worker.createdAt + startMs - time) + 2);
            return;
          }
          setTimer(() => {
            if (worker.dead || worker.stuck) return;
            if (crashOnBitmap && message.bitmap) { worker.onerror?.({ message: "worker crashed on a bitmap" }); return; }
            let data, pixels = message.image, refusal;
            try {
              if (failing) throw Error("injected worker failure");
              // The bitmap as it arrives in the worker: the size it was made
              // at (the camera's copy is detached by the transfer).
              const { bitmap: sent } = message, received = sent && { width: sent.made[0], height: sent.made[1], grid: sent.grid, empty: !!sent.empty, close() {} };
              if ("bitmap" in message) try { pixels = reader({ bitmap: received, width: message.width, height: message.height }); }
              catch (error) { pixels = null; refusal = REFUSALS.includes(error?.refusal) ? error.refusal : "failed"; }
              // An injected refusal gives no reason (the tracker counts it as "failed").
              const refused = message.bitmap && (bitmapError || refusals > 0);
              if (refused && !bitmapError) refusals--;
              if (refused) data = { id: message.id, error: "bitmap-unsupported" };
              else if ("bitmap" in message && !pixels) data = { id: message.id, error: "bitmap-unsupported", refusal };
              else {
                runs.push({ op: message.op, bitmap: !!message.bitmap, empty: !!message.bitmap?.empty || pixels?.data?.[3] === 0 });
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
  if (fps) {
    let presented = 0; video.readyState = 4;
    video.requestVideoFrameCallback = (fn) => setTimer(() => { presented++; fn(time, { presentedFrames: presented, mediaTime: time / 1000 }); }, 1000 / fps);
    video.cancelVideoFrameCallback = (id) => clearTimer(id);
  }
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
    reader: { read: () => { reads++; return new Promise((resolve) => setTimer(() => resolve(reading()), 500)); }, cancel() {} },
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
  return { camera, view, video, ops, posts, bitmaps, results, workers, diagnostics, advance, until, live, contentCanvas, rejections, detections, runs,
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
    failBitmaps(value) { failBitmaps = value; }, holdBitmaps(value) { holdBitmaps = value; }, blankBitmaps(value) { blankBitmaps = value; },
    emptyBitmaps(value) { emptyBitmaps = value; }, crashOnBitmap(value) { crashOnBitmap = value; },
    refuseNext(n = 1) { refusals = n; }, nextBitmap(...kinds) { upcoming.push(...kinds); }, noPicture(n = 1) { pictureless = n; },
    get reads() { return reads; }, get upcoming() { return upcoming.length; },
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
  // The export: the transport, why (the probe read back right) and the
  // handshake's time from the worker's start, the core's time apart from the
  // transport's.
  const report = h.diagnostics.snapshot();
  assert.equal(report.tracking.transport, "bitmap");
  assert.equal(report.tracking.transportReason, "probe"); assert.equal(report.tracking.handshakeMilliseconds, 2);
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

// A phone's snapshot, 1200 x 1600, is tracked at 960 x 1280 (the other tests'
// frames are within 1280 pixels, where the two sizes are the same). In both
// transports every job asks the worker for that size: the bitmap of the
// snapshot is drawn at it, or the camera reads back at it. The anchor gets the
// detection's corners scaled into the tracking pixels, and the proofs are
// scaled back to the snapshot, so the reading's corners are the grid's.
for (const transport of ["bitmap", "imagedata"]) test(`${transport === "bitmap" ? "with the bitmap transport" : "with the camera's own readback"} a 1200 x 1600 snapshot is tracked at 960 x 1280, and its proofs come back to the snapshot`, async (t) => {
  const h = simulation(t, { frame: [1200, 1600], grid: [150, 300], transport });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "the grid is found, tracked and read");
  await h.advance(500);
  assert.equal(h.camera.stats.tracking.transport, transport);
  const jobs = h.jobs(), grid = cornersAt(150, 300);
  assert.ok(jobs.filter((p) => p.op === "verify").length >= 5);
  for (const job of jobs) {
    assert.deepEqual([job.width, job.height], [960, 1280], `${job.op} at the tracking size`);
    if (transport === "bitmap") assert.deepEqual(job.bitmap.made, [1200, 1600], "a bitmap of the whole snapshot");
    else assert.deepEqual([job.image.width, job.image.height], [960, 1280], "read back at the tracking size");
  }
  assert.equal(h.readbacks().length > 0, transport === "imagedata", "the main thread reads back only for its own transport");
  const [anchor] = jobs.filter((p) => p.op === "anchor");
  anchor.corners.forEach((p, i) => assert.ok(Math.abs(p.x - grid[i].x * 959 / 1199) < 1e-6 && Math.abs(p.y - grid[i].y * 1279 / 1599) < 1e-6,
    `anchor corner ${i}: ${JSON.stringify(p)}`));
  const shot = h.camera.capture();
  assert.ok(shot.found, "a fresh verified reading");
  shot.corners.forEach((p, i) => assert.ok(Math.hypot(p.x - grid[i].x, p.y - grid[i].y) < 0.5, `corner ${i}: ${JSON.stringify(p)}`));
  assert.deepEqual(h.open(), []);
});

test("the handshake holds the first anchor for at most two waits (600 ms) after the worker started, then the camera reads back itself", async (t) => {
  const h = simulation(t, { transport: "silent", startMs: 40 });
  assert.ok(await h.until(() => h.jobs().length > 0, 3000), "the first job is posted");
  const [probe] = h.posts, [first] = h.jobs();
  assert.equal(probe.op, "probe");
  assert.equal(first.op, "anchor"); assert.equal(first.bitmap, null); assert.ok(first.image, "the camera's own readback");
  assert.equal(probe.at, h.workers[0].createdAt, "the probe goes out with the first anchor's request for the transport");
  assert.equal(first.at, h.workers[0].createdAt + 40 + 2 * HANDSHAKE_WAIT, "the anchor, once a second wait after the worker's start ran out on time");
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
  const workers = h.workers.length, posts = h.posts.length;
  h.camera.stop();
  await h.releaseBitmaps();
  assert.equal(h.bitmaps.filter((b) => b.label === "frame").every((b) => b.closed), true);
  assert.deepEqual(h.jobs(), []); assert.deepEqual(h.open(), []);
  assert.equal(h.camera.stats.retainedSources, 0, "its snapshot is released");
  // Nothing is asked of the tracker for it: no worker started, nothing
  // posted (not even a probe), nothing queued.
  await h.advance(500);
  assert.equal(h.workers.length, workers); assert.equal(h.posts.length, posts);
  assert.equal(h.camera.stats.tracking.queuedAnchors, 0);
});

// The same at the freeze: a later detection's anchor bitmap made after the
// view froze (only the bitmap of detection's copy is held, so verifications
// go on and the view can freeze meanwhile) starts no worker while frozen.
test("an anchor's bitmap made after the view froze is closed and starts no worker while frozen", async (t) => {
  let solved;
  const h = simulation(t, { solve: new Promise((resolve) => { solved = resolve; }) });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read; the solver has not answered");
  const harnessBitmap = globalThis.createImageBitmap, held = [];
  const fromVideo = (source) => h.ops.some((o) => o.target === source && o.op === "drawImage" && o.source === h.video);
  globalThis.createImageBitmap = (source) => fromVideo(source) ? harnessBitmap(source)
    : new Promise((resolve) => held.push(() => resolve(harnessBitmap(source))));
  assert.ok(await h.until(() => held.length > 0, 4000), "a later detection's anchor bitmap is being made");
  solved({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] });
  assert.ok(await h.until(() => h.camera.view === "frozen", 2000), "frozen");
  const workers = h.workers.length, posts = h.posts.length;
  for (const release of held.splice(0)) release();
  await h.advance(1000);
  globalThis.createImageBitmap = harnessBitmap;
  assert.equal(h.camera.view, "frozen");
  assert.equal(h.workers.length, workers, "no worker started while frozen");
  assert.equal(h.posts.length, posts, "nothing posted while frozen");
  assert.deepEqual(h.open(), []);
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

// One frame lost to its bitmap while a reading is tracked costs that frame
// alone: the worker refuses its bitmap (as WebKit on CI did once in
// live_noise's changed-content scene, a frame whose readback had a
// transparent sample), or the bitmap draws nothing there (a snapshot of a
// video with no picture to draw), or the camera cannot make one or gets one of
// another size. No restart and no new worker; the reading is not read again,
// and its outline never leaves the view (the adopted frame stays; before the
// worker read bitmaps back, such a frame's own readback was adopted with no
// proof, and the outline blinked); bitmaps stay, and the export counts the
// frame while still saying why bitmaps are used. Before, any one of these
// gave bitmaps up for the session and retired the reading. The next frame is
// sampled at once, so the view stays on the live tier: a settled reading's
// next frame 250-300 ms later would age the adopted frame past 500 ms, and
// mark the view as catching up for two seconds. The export counts a refused
// frame by the worker's reason too (a refusal without one as "failed").
for (const [name, provoke, cause, reason] of [
  ["the worker refuses one frame's bitmap", (h) => h.refuseNext(1), "refused", "refusedFailed"],
  ["one frame's bitmap draws nothing in the worker", (h) => h.nextBitmap("empty"), "refused", "refusedBlank"],
  ["one frame's bitmap is not its snapshot's size (WebKit's blank 1 x 1)", (h) => h.nextBitmap("blank"), "unmade", null],
  ["one frame's bitmap cannot be made", (h) => h.nextBitmap("fail"), "unmade", null],
]) test(`when ${name} during a tracked reading, that frame alone is lost: the reading, its outline and bitmaps stay`, async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  assert.equal(h.reads, 1); assert.equal(h.camera.stats.tracking.transport, "bitmap");
  const workers = h.workers.length, jobs = h.jobs().length, reasons = h.reasons().length;
  const counted = cause === "refused" ? "refusedFrames" : "unmadeFrames", other = cause === "refused" ? "unmadeFrames" : "refusedFrames";
  assert.equal(h.camera.stats.scheduling.intervalMilliseconds, 250, "a settled reading's interval");
  provoke(h);
  const overlays = new Set(), recognised = new Set(), tiers = new Set(), labels = new Set();
  for (let i = 0; i < 200; i++) {
    await h.advance(10); overlays.add(h.view.dataset.overlay); recognised.add(h.view.dataset.recognised);
    tiers.add(h.view.dataset.delayed); labels.add(h.view.attributes["aria-label"]);
  }
  const tracking = h.camera.stats.tracking;
  assert.equal(tracking[counted], 1, "one frame lost"); assert.equal(tracking[other], 0);
  assert.deepEqual(h.reasons().slice(reasons).filter((r) => r === "tracking-transport"), [], "no restart");
  assert.equal(h.workers.length, workers, "no new worker"); assert.equal(h.workers.at(-1).dead, false);
  assert.equal(tracking.transport, "bitmap"); assert.equal(tracking.transportReason, "probe");
  assert.equal(h.reads, 1, "the reading is not read again");
  assert.deepEqual([...overlays], ["outline"], "its outline never leaves the view");
  assert.deepEqual([...recognised], ["4"], "nor does its reading");
  assert.deepEqual([...tiers], ["0"], "the view stays on the live tier");
  assert.ok([...labels].every((label) => !/catching up/.test(label)), JSON.stringify([...labels]));
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.restartHidden(), true);
  assert.ok(h.jobs().slice(jobs).filter((p) => p.bitmap).length >= 5, "later frames go on as bitmaps");
  assert.deepEqual(h.runs.filter((r) => r.empty), [], "no pixel of the lost frame reaches the tracking core");
  assert.deepEqual(h.jobs().filter((p) => p.bitmap?.label === "blank"), [], "a bitmap of another size is never posted");
  assert.deepEqual(h.open(), []);
  const report = h.diagnostics.snapshot().tracking;
  assert.equal(report.transport, "bitmap"); assert.equal(report.transportReason, "probe", "the export still says why bitmaps are used");
  assert.equal(report[counted], 1, "and counts the lost frame"); assert.equal(report[other], 0);
  const byReason = ["refusedIncomplete", "refusedBlank", "refusedFailed"].map((key) => [key, report[key]]);
  assert.deepEqual(byReason, byReason.map(([key]) => [key, key === reason ? 1 : 0]), "a refused frame by the worker's reason");
});

// A browser that loses two of every three bitmap frames (none has been seen)
// keeps bitmaps: every completed job ends the run. With the frame after each
// lost one sampled at once, a third of its frames are still verified often
// enough for the live tier, and the reading and its outline stay; only the
// export's counts show the losses. Also at a camera's 30 frames a second,
// where a detection's anchor takes one of the bitmaps now and then, so that
// more than two verification frames in a row can be lost: every lost bitmap
// frame hurries the next sample.
for (const fps of [0, 30]) test(`a browser that loses two of every three bitmap frames keeps bitmaps, the reading and the live tier${fps ? `, at ${fps} frames a second` : ""}`, async (t) => {
  const h = simulation(t, { fps });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  const workers = h.workers.length, reasons = h.reasons().length, completed = h.camera.stats.tracking.completed;
  for (let i = 0; i < 40; i++) h.nextBitmap("empty", "blank", "ok");
  const overlays = new Set(), recognised = new Set(), tiers = new Set();
  for (let i = 0; i < 600; i++) {
    await h.advance(10); overlays.add(h.view.dataset.overlay); recognised.add(h.view.dataset.recognised); tiers.add(h.view.dataset.delayed);
  }
  const tracking = h.camera.stats.tracking;
  assert.ok(h.upcoming > 0, "still losing frames at the end");
  assert.ok(tracking.refusedFrames >= 10 && tracking.unmadeFrames >= 10, JSON.stringify(tracking));
  assert.ok(tracking.completed - completed >= 10, `${tracking.completed - completed} jobs completed in 6 s`);
  assert.equal(tracking.transport, "bitmap"); assert.equal(tracking.transportReason, "probe");
  assert.deepEqual(h.reasons().slice(reasons).filter((r) => r === "tracking-transport"), [], "bitmaps kept");
  assert.equal(h.workers.length, workers); assert.equal(h.reads, 1, "the reading is not read again");
  assert.deepEqual([...overlays], ["outline"]); assert.deepEqual([...recognised], ["4"]);
  assert.deepEqual([...tiers], ["0"], "on the live tier");
  assert.deepEqual(h.runs.filter((r) => r.empty), [], "no lost frame's pixels reach the tracking core");
  assert.deepEqual(h.open(), []);
});

// A burst of bitmap failures shorter than REFUSAL_SPAN (memory pressure that
// passes, say) during a tracked reading, at a camera's 30 frames a second:
// with the frame after each lost one sampled at once, it loses REFUSAL_LIMIT
// frames in a row within a tenth of a second, which alone gave bitmaps up and
// retired the reading. They are kept, and so is the reading. A failure that
// lasts gives them up at a frame lost REFUSAL_SPAN or more after the first.
test("a burst of bitmap failures shorter than REFUSAL_SPAN keeps bitmaps and the reading; one that lasts gives them up after it", async (t) => {
  const h = simulation(t, { fps: 30 });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  assert.equal(h.camera.stats.scheduling.mode, "video-frame"); assert.equal(h.camera.stats.scheduling.intervalMilliseconds, 250);
  const workers = h.workers.length, reasons = h.reasons().length, lost0 = h.camera.stats.tracking.refusedFrames;
  const given = () => h.reasons().slice(reasons).includes("tracking-transport");
  h.emptyBitmaps(true); await h.advance(REFUSAL_SPAN - 100); h.emptyBitmaps(false);
  assert.ok(h.camera.stats.tracking.refusedFrames - lost0 >= REFUSAL_LIMIT, `${h.camera.stats.tracking.refusedFrames - lost0} frames lost in the burst`);
  const overlays = new Set();
  for (let i = 0; i < 200; i++) { await h.advance(10); overlays.add(h.view.dataset.overlay); }
  assert.equal(given(), false, "bitmaps kept"); assert.equal(h.workers.length, workers);
  assert.equal(h.camera.stats.tracking.transport, "bitmap"); assert.equal(h.camera.stats.tracking.transportReason, "probe");
  assert.equal(h.reads, 1, "the reading is not read again"); assert.deepEqual([...overlays], ["outline"]);
  assert.deepEqual(h.runs.filter((r) => r.empty), [], "no lost frame's pixels reach the tracking core");
  // A failure that lasts. Each refusal comes 20 ms (the worker's reply) after its post.
  const posted = h.jobs().length;
  h.emptyBitmaps(true);
  assert.ok(await h.until(() => h.jobs().slice(posted).some((p) => p.bitmap?.empty), 1000), "a frame is lost");
  const first = h.jobs().slice(posted).find((p) => p.bitmap?.empty).at + 20;
  assert.ok(await h.until(() => given() || h.now >= first + REFUSAL_SPAN - 10, 1000));
  assert.equal(given(), false, "kept until the span has passed");
  assert.ok(await h.until(given, 1000), "given up once it has");
  assert.equal(h.view.dataset.overlay, "none", "which retires the reading");
  assert.ok(await h.until(() => h.camera.stats.tracking.transport === "imagedata", 1000));
  assert.equal(h.camera.stats.tracking.transportReason, "refused");
  h.emptyBitmaps(false);
  assert.deepEqual(h.runs.filter((r) => r.empty), []);
});

// Only a lost frame hurries the next sample. A queued frame that a newer one
// replaced is retired with an AbortError too, but must not: with replies
// slower than the interval the queued frame is replaced every interval, and
// hurrying then would have the camera sample every frame it is shown.
test("a queued frame replaced by a newer one does not hurry the next sample", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  h.replyDelay(700); await h.advance(1500);
  const dropped = h.camera.stats.tracking.dropped, snapshots = () => h.ops.filter((o) => o.op === "drawImage" && o.source === h.video).length;
  const before = snapshots();
  await h.advance(3000);
  assert.ok(h.camera.stats.tracking.dropped - dropped >= 3, `${h.camera.stats.tracking.dropped - dropped} queued frames replaced`);
  assert.ok(snapshots() - before <= 12, `${snapshots() - before} snapshots in 3 s at a settled reading's interval`);
  assert.equal(h.camera.stats.tracking.refusedFrames + h.camera.stats.tracking.unmadeFrames, 0);
});

// A frame lost after the camera closed (its bitmap failed after the close)
// adds nothing to the diagnostics, which may serve another scan by then.
test("a frame lost after the camera closed leaves the diagnostics of the next scan alone", async (t) => {
  const h = simulation(t);
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "the first detection's anchor bitmap is being made");
  h.camera.stop(); h.diagnostics.begin("photo", { type: "sudoku", rows: 9, cols: 9 });
  await h.failHeldBitmaps(); await h.advance(100);
  assert.deepEqual(h.diagnostics.snapshot().tracking, {}, "the photo scan has no tracking section");
  assert.deepEqual(h.open(), []);
});

// The camera's own readback (the only transport here) of a snapshot of a video
// with no picture to draw, transparent wherever the worker checks a bitmap's
// readback, is lost alone, counted, and never reaches the tracking core.
// Before, it was verified on nothing and adopted without a proof, so the
// outline and the reading's counts blinked for one frame. Two in a row (two
// ticks of a video with no picture) keep the live tier too: each hurries the
// next sample. So does the next such pair, a verification later.
for (const n of [1, REFUSAL_LIMIT - 1]) test(`on the camera's own readback, ${n === 1 ? "a frame" : `${n} frames in a row`} with no picture during a tracked reading ${n === 1 ? "is" : "are"} lost alone: no blink, the live tier kept, also the next time`, async (t) => {
  const h = simulation(t, { transport: "imagedata" });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  const workers = h.workers.length, reasons = h.reasons().length, completed = h.camera.stats.tracking.completed;
  const overlays = new Set(), recognised = new Set(), tiers = new Set();
  for (let round = 0; round < 2; round++) {
    h.noPicture(n);
    for (let i = 0; i < 200; i++) {
      await h.advance(10); overlays.add(h.view.dataset.overlay); recognised.add(h.view.dataset.recognised); tiers.add(h.view.dataset.delayed);
    }
  }
  const tracking = h.camera.stats.tracking;
  assert.equal(tracking.blankReadbacks, 2 * n, "the frames lost"); assert.equal(tracking.refusedFrames + tracking.unmadeFrames, 0);
  assert.ok(tracking.completed > completed, "the frames after it are verified");
  assert.equal(tracking.failures, 0); assert.equal(h.camera.stats.recovery.failures, 0);
  assert.equal(h.workers.length, workers); assert.equal(h.reads, 1, "the reading is not read again");
  assert.deepEqual([...overlays], ["outline"], "the outline does not blink");
  assert.deepEqual([...recognised], ["4"]); assert.deepEqual([...tiers], ["0"], "on the live tier");
  assert.deepEqual(h.runs.filter((r) => r.empty), [], "no pixel of it reaches the tracking core");
  assert.deepEqual(h.reasons().slice(reasons).filter((r) => ["worker-error", "tracking-transport"].includes(r)), []);
  const report = h.diagnostics.snapshot().tracking;
  assert.equal(report.transport, "imagedata"); assert.equal(report.blankReadbacks, 2 * n, "the export counts them");
});

// While aiming, such a readback builds no anchor: the detection's candidate is
// not offered, and detection tries again on the next frame.
test("on the camera's own readback, frames with no picture while aiming build no anchor, and the grid is read from the frames after them", async (t) => {
  const h = simulation(t, { transport: "imagedata" });
  h.noPicture(3);
  assert.ok(await h.until(() => h.camera.stats.tracking.blankReadbacks === 1, 2000), "the first detection's frame is lost");
  assert.deepEqual(h.jobs(), [], "nothing was sent to the worker");
  assert.equal(h.diagnostics.snapshot().tracking.blankReadbacks, 1, "the export counts it with no verification yet");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  assert.equal(h.camera.stats.tracking.blankReadbacks, 3);
  assert.deepEqual(h.runs.filter((r) => r.empty), [], "the tracking core got none of them");
  assert.equal(h.camera.stats.tracking.failures, 0); assert.equal(h.camera.stats.recovery.failures, 0);
});

// A video that keeps having no picture (on an iPhone, the GPU process failing
// to convert the camera's frames, say) on the camera's own readback, which
// nothing gives up: only the first REFUSAL_LIMIT - 1 frames lost in a row
// hurry the next sample, and the rest are read back at the sampling interval,
// not at the video's 30 frames a second, each a full readback on the main
// thread. Here the grid is not found on them either, so no anchor is built.
test("on the camera's own readback, a video that keeps having no picture is read back at the sampling interval, not at its frame rate", async (t) => {
  const h = simulation(t, { transport: "imagedata", fps: 30 });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  const before = h.readbacks().length, lost0 = h.camera.stats.tracking.blankReadbacks;
  h.noPicture(1e9); h.aim(null);
  await h.advance(2000);
  const times = h.readbacks().slice(before).map((r) => r.at), gaps = times.slice(1).map((at, i) => at - times[i]);
  assert.ok(gaps.length >= REFUSAL_LIMIT, `${times.length} readbacks`);
  assert.ok(gaps.slice(0, REFUSAL_LIMIT - 1).every((gap) => gap <= 34), `hurried: ${gaps}`);
  assert.ok(gaps.slice(REFUSAL_LIMIT - 1).every((gap) => gap >= 100), `then the interval: ${gaps}`);
  assert.ok(times.length <= 2000 / 100 + REFUSAL_LIMIT, `${times.length} readbacks in 2 s`);
  assert.equal(h.camera.stats.tracking.blankReadbacks - lost0, times.length, "each one lost");
  assert.deepEqual(h.runs.filter((r) => r.empty), []);
  assert.equal(h.camera.stats.tracking.failures, 0); assert.equal(h.camera.stats.recovery.failures, 0);
});

// That bound counts the camera's own readbacks only: bitmap frames lost before
// bitmaps were given up are not in it. A failure that lasts gives bitmaps up
// during a tracked reading at 30 frames a second, after a dozen verification
// frames lost to their bitmaps (each hurrying the next sample, and none of
// them completed). On the camera's own readback after it, the first
// REFUSAL_LIMIT - 1 frames with no picture that would verify the next
// detection's candidate still hurry their samples, as on a camera that never
// had bitmaps.
test("after bitmaps are given up, the camera's own readback still hurries the sample after its first frames with no picture: lost bitmap frames are not counted", async (t) => {
  const h = simulation(t, { fps: 30 });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  await h.advance(1000);
  const reasons = h.reasons().length, posted = h.jobs().length;
  h.emptyBitmaps(true);
  assert.ok(await h.until(() => h.reasons().slice(reasons).includes("tracking-transport"), 2000), "bitmaps given up");
  h.emptyBitmaps(false);
  const lost = h.jobs().slice(posted).filter((p) => p.op === "verify" && p.bitmap?.empty).length;
  assert.ok(lost >= REFUSAL_LIMIT, `${lost} verification frames lost to their bitmaps first`);
  const restartedAt = h.now;
  assert.ok(await h.until(() => h.jobs().some((p) => p.op === "anchor" && p.image && p.at >= restartedAt), 2000),
    "a detection's anchor on the camera's own readback");
  const before = h.readbacks().length, blank0 = h.camera.stats.tracking.blankReadbacks;
  h.noPicture(REFUSAL_LIMIT - 1);
  assert.ok(await h.until(() => h.readbacks().length >= before + REFUSAL_LIMIT, 2000), "its candidate's verification frames");
  const frames = h.readbacks().slice(before, before + REFUSAL_LIMIT), gaps = frames.slice(1).map((r, i) => r.at - frames[i].at);
  assert.deepEqual(frames.map((r) => r.result.data[3] === 0), [...Array(REFUSAL_LIMIT - 1).fill(true), false], "with no picture, then one");
  assert.equal(h.camera.stats.tracking.blankReadbacks - blank0, REFUSAL_LIMIT - 1, "lost");
  assert.ok(gaps.every((gap) => gap <= 34), `each hurried the next sample: ${gaps}`);
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again on the camera's own readback");
  assert.deepEqual(h.runs.filter((r) => r.empty), []);
  assert.equal(h.camera.stats.recovery.failures, 0);
});

// Bitmap frames lost persistently (every frame here) are no tracking failure:
// at the REFUSAL_LIMIT-th lost in a row the tracker gives bitmaps up and
// resets; the camera restarts acquisition at once on its own readback, with
// no back-off and no Restart, and reads the grid again. The frames before it
// were lost alone.
for (const [name, provoke, cause] of [
  ["the worker cannot read a bitmap back", (h) => h.bitmapError(true), "refused"],
  ["no bitmap can be made", (h) => h.failBitmaps(true), "unmade"],
  ["a bitmap is not its snapshot's size (WebKit's blank 1 x 1)", (h) => h.blankBitmaps([1, 1]), "unmade"],
  ["a bitmap is not its snapshot's height", (h) => h.blankBitmaps([700, 699]), "unmade"],
  ["a bitmap of the right size draws nothing in the worker", (h) => h.emptyBitmaps(true), "refused"],
]) test(`when ${name} in every frame, acquisition restarts on the camera's own readback, with no back-off and no Restart`, async (t) => {
  const h = simulation(t);
  provoke(h);
  assert.ok(await h.until(() => h.reasons().includes("tracking-transport"), 3000), "the transport is given up");
  const counted = cause === "refused" ? "refusedFrames" : "unmadeFrames";
  assert.equal(h.camera.stats.tracking[counted], REFUSAL_LIMIT, "at the REFUSAL_LIMIT-th frame lost in a row");
  assert.equal(h.diagnostics.snapshot().tracking[counted], REFUSAL_LIMIT, "the export has it at the give-up, before any verification");
  assert.deepEqual(h.jobs().filter((p) => p.bitmap?.label === "blank"), [], "no blank bitmap reaches the worker");
  // The first detections' anchors failed: their own frame stays the newest
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
  const report = h.diagnostics.snapshot().tracking;
  assert.equal(report.transport, "imagedata"); assert.equal(report.transportReason, cause, "the export says why");
  assert.equal(report[counted], REFUSAL_LIMIT, "and how many frames were lost");
});

// The review's case (M1): a bitmap that is no picture of its snapshot, WebKit's
// blank 1 x 1 copy (refused by the camera) or one of the right size that draws
// nothing (refused by the worker's reader), would give an anchor with nothing
// in it, which every later such frame "verifies" at the detection's corners.
// Each such frame is lost, and bitmaps are given up at the REFUSAL_LIMIT-th in
// a row, so the tracking core gets no pixels of one. The grid moves 90 px
// right and 60 px down after the reading, then the solver answers: the view
// must freeze where the grid is, not draw the solution where it was.
for (const [name, provoke, cause] of [
  ["that are not their snapshot's size (WebKit's blank 1 x 1)", (h) => h.blankBitmaps([1, 1]), "unmade"],
  ["of the right size that draw nothing", (h) => h.emptyBitmaps(true), "refused"],
]) test(`with bitmaps ${name} no anchor or proof is built on one, and the moved grid freezes where it is, not where it was`, async (t) => {
  let solved;
  const h = simulation(t, { solve: new Promise((resolve) => { solved = resolve; }) });
  provoke(h);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read");
  assert.equal(h.camera.stats.tracking.transport, "imagedata", "on the camera's own readback");
  assert.ok(h.runs.some((r) => r.op === "anchor") && h.runs.some((r) => r.op === "verify"));
  assert.deepEqual(h.runs.filter((r) => r.bitmap), [], "the tracking core got no bitmap's pixels");
  assert.deepEqual(h.reasons().filter((r) => r === "tracking-transport"), ["tracking-transport"], "bitmaps given up once");
  assert.equal(h.camera.stats.tracking[cause === "refused" ? "refusedFrames" : "unmadeFrames"], REFUSAL_LIMIT,
    "at the REFUSAL_LIMIT-th frame lost in a row");
  assert.equal(h.diagnostics.snapshot().tracking.transportReason, cause);
  h.aim([210, 170]); await h.advance(1500);
  solved({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] });
  assert.ok(await h.until(() => h.camera.view === "frozen", 5000), "frozen");
  const grid = cornersAt(210, 170);
  h.camera.capture().corners.forEach((p, i) => assert.ok(Math.hypot(p.x - grid[i].x, p.y - grid[i].y) < 1, `corner ${i}: ${JSON.stringify(p)}`));
  assert.equal(h.camera.stats.recovery.failures, 0);
  assert.deepEqual(h.open(), []);
});

// A worker stuck on its probe answers nothing after it: the handshake's second
// wait that ends on time replaces it with a worker on the camera's own
// readback, so the jobs do not queue behind the probe until their deadlines,
// and no failure counts. The worker after a reset (Restart here) probes
// again; a second worker stuck so gives bitmaps up, and no later worker is
// probed.
test("a worker stuck on its probe is replaced at the handshake's second wait, and the grid is read on the camera's own readback", async (t) => {
  const h = simulation(t, { transport: "stuck" });
  const probes = () => h.posts.filter((p) => p.op === "probe").length;
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read");
  assert.equal(h.workers.length, 2); assert.equal(h.workers[0].dead, true, "the stuck worker is ended");
  assert.equal(probes(), 1, "the new worker is not probed");
  assert.ok(h.jobs().length > 0 && h.jobs().every((p) => p.image), "on the camera's own readback");
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.restartHidden(), true);
  h.camera.restart();
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again after Restart");
  assert.equal(probes(), 2, "the worker after Restart probes again");
  assert.equal(h.workers.length, 4); assert.equal(h.workers[2].dead, true, "and, stuck too, is replaced");
  h.camera.restart();
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read again after another Restart");
  assert.equal(probes(), 2, "the second stuck worker gave bitmaps up: no probe for a later worker");
  assert.equal(h.workers.length, 5);
  assert.ok(h.jobs().every((p) => p.image), "every job on the camera's own readback");
  assert.equal(h.camera.stats.recovery.failures, 0);
  assert.deepEqual(h.open(), []);
  assert.equal(h.diagnostics.snapshot().tracking.transportReason, "timeout", "the export says why");
});

// A worker that dies on every bitmap job (a bitmap that crashes it) gives
// bitmaps up at its first one, as one that never answers it would: the grid is
// read on the camera's own readback with no failure counted, rather than each
// new worker crashing in turn until tracking pauses.
test("a worker that dies on its first bitmap job gives bitmaps up, and the grid is read on the camera's own readback", async (t) => {
  const h = simulation(t);
  h.crashOnBitmap(true);
  assert.ok(await h.until(() => h.reasons().includes("tracking-transport"), 3000), "bitmaps are given up");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4", 5000), "read on the camera's own readback");
  assert.equal(h.camera.stats.tracking.transport, "imagedata");
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.reasons().includes("worker-error"), false);
  assert.equal(h.restartHidden(), true, "no Restart");
  assert.deepEqual(h.open(), []);
  assert.equal(h.diagnostics.snapshot().tracking.transportReason, "unanswered", "the export says why");
});

// A bitmap that cannot be made for a frame the freeze has retired: the frozen
// view and its help line stay, and nothing is logged while frozen (N2). The
// frame is lost alone, counted, so the scan after Clear probes for bitmaps
// again and reads on them; its export still counts the lost frame.
test("a bitmap that cannot be made for a frame the freeze retired is lost alone: the frozen view stays, and after Clear bitmaps are probed for again", async (t) => {
  let solved;
  const h = simulation(t, { solve: new Promise((resolve) => { solved = resolve; }) });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read; the solver has not answered");
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "a verification's bitmap is being made");
  solved({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] });
  assert.ok(await h.until(() => h.camera.view === "frozen", 1000), "the solved view freezes meanwhile");
  const help = h.help, writes = h.writes.length, reasons = h.reasons().length, held = h.held;
  assert.ok(held >= 1 && held < REFUSAL_LIMIT, `${held} bitmaps held`);
  const frozenReport = h.diagnostics.snapshot();
  assert.equal(frozenReport.tracking.unmadeFrames, 0);
  await h.failHeldBitmaps(); await h.advance(1000);
  assert.equal(h.camera.view, "frozen");
  assert.equal(h.help, help, "the frozen help line stays");
  assert.deepEqual(h.writes.slice(writes), [], "nothing written to the help line while frozen");
  assert.deepEqual(h.reasons().slice(reasons), [], "no event while frozen");
  assert.equal(h.camera.stats.recovery.failures, 0);
  assert.equal(h.camera.stats.tracking.unmadeFrames, held, "each lost frame counted");
  // The export counts them at once, with no verification since: the report of
  // the frozen scan has them. Its latest verification's frame and the
  // metrics stay as they were.
  const report0 = h.diagnostics.snapshot();
  assert.equal(report0.tracking.unmadeFrames, held, "the frozen scan's export counts the lost frames");
  for (const key of ["frame", "ageMilliseconds", "verified", "tier", "transport", "transportReason"])
    assert.deepEqual(report0.tracking[key], frozenReport.tracking[key], key);
  assert.deepEqual(report0.performance.trackingFrameAge, frozenReport.performance.trackingFrameAge, "no metric added");
  assert.deepEqual(h.open(), []);
  h.holdBitmaps(false); h.camera.resume();
  assert.ok(await h.until(() => h.camera.view === "frozen" || h.view.dataset.recognised === "4", 10000), "read again after Clear");
  assert.equal(h.posts.filter((p) => p.op === "probe").length, 2, "the worker after Clear probes again");
  assert.ok(h.jobs().filter((p) => p.at >= h.workers[1].createdAt).every((p) => p.bitmap), "and gets bitmaps");
  const report = h.diagnostics.snapshot().tracking;
  assert.equal(report.transport, "bitmap"); assert.equal(report.transportReason, "probe");
  assert.equal(report.unmadeFrames, held, "the export counts the lost frame");
});

// Two frames lost as the view freezes and one after Clear, half a minute
// later, are three in a row (the freeze ends no run), but the frozen half
// minute is no tracking time: the frame lost after Clear is lost alone, and
// the scan goes on with bitmaps. Before, it gave bitmaps up for the rest of
// the camera session, which then read every frame back on the main thread.
test("frames lost as the view freezes and one lost after Clear half a minute later are lost alone: frozen time is no part of REFUSAL_SPAN", async (t) => {
  let solved;
  const h = simulation(t, { solve: new Promise((resolve) => { solved = resolve; }) });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"), "read; the solver has not answered");
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held >= REFUSAL_LIMIT - 1, 2000), "two verification bitmaps are being made");
  solved({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1] }] });
  assert.ok(await h.until(() => h.camera.view === "frozen", 3000), "the solved view freezes meanwhile");
  const lostAtFreeze = h.held;
  await h.failHeldBitmaps(); h.holdBitmaps(false);
  assert.equal(h.camera.stats.tracking.unmadeFrames, lostAtFreeze, `${lostAtFreeze} frames lost at the freeze`);
  await h.advance(30000);
  const reasons = h.reasons().length;
  h.camera.resume();
  h.nextBitmap("fail"); // The first bitmap after Clear, the first detection's anchor's, cannot be made.
  assert.ok(await h.until(() => h.camera.view === "frozen" || h.view.dataset.recognised === "4", 10000), "read again after Clear");
  assert.equal(h.upcoming, 0); assert.equal(h.camera.stats.tracking.unmadeFrames, lostAtFreeze + 1, "the frame after Clear was lost");
  assert.ok(!h.reasons().slice(reasons).includes("tracking-transport"), "bitmaps are not given up");
  assert.equal(h.workers.length, 2, "the worker after Clear is kept");
  const after = h.jobs().filter((p) => p.at >= h.workers[1].createdAt);
  assert.ok(after.length > 0 && after.every((p) => p.bitmap), "and gets bitmaps");
  assert.equal(h.readbacks().length, 0, "no tracking pixels are read back on the main thread");
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

// Bitmaps given up while a reading is tracked (every bitmap refused from now
// on): at the REFUSAL_LIMIT-th lost frame the worker has a verification
// active and a frame queued, and a detection is in flight. One restart for
// both rejected jobs; the detection is abandoned, not cancelled (the geometry
// worker stays warm), so the next one starts at once; no anchor of the old
// worker is asked for again.
test("bitmaps given up while a reading is tracked restart acquisition once, at once, and ask the new worker for no old anchor", async (t) => {
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

// Bitmaps given up while a later detection's candidate waits for its first
// verification and the reading's outline is shown: the frames that would
// verify it are lost, alone, until the REFUSAL_LIMIT-th in a row, whose bitmap
// cannot be made, REFUSAL_SPAN after the first (the frames sampled meanwhile
// wait for their bitmaps too). The restart retires both at once, before the
// next frame: the candidate's anchor died with the worker, so it is discarded
// rather than verified on the next worker, and the outline of the old
// worker's proofs goes. The frame whose bitmap failed stays the newest
// picture scanned, which a capture on a stalled feed keeps, as after any
// tracking failure.
test("bitmaps given up while a candidate waits retire it and the outline at once, and keep the frame they were given up on", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  assert.ok(await h.until(() => h.camera.stats.candidate === 1, 5000), "a later detection's candidate waits");
  h.refuseNext(REFUSAL_LIMIT - 1);
  assert.ok(await h.until(() => h.camera.stats.tracking.refusedFrames === REFUSAL_LIMIT - 1, 2000), "the frames that would verify it are lost");
  assert.equal(h.camera.stats.candidate, 1, "alone: the candidate still waits"); assert.equal(h.view.dataset.overlay, "outline");
  assert.equal(h.reasons().includes("tracking-transport"), false);
  h.holdBitmaps(true);
  assert.ok(await h.until(() => h.held > 0, 1000), "the bitmap of the frame that verifies it is being made");
  const failed = h.bitmaps.at(-1).source;
  assert.equal(h.camera.stats.candidate, 1); assert.equal(h.camera.stats.tracking.active, 0, "no other job in the worker");
  await h.advance(REFUSAL_SPAN);
  assert.equal(h.camera.stats.candidate, 1); assert.equal(h.view.dataset.overlay, "outline");
  assert.equal(h.reasons().includes("tracking-transport"), false);
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
