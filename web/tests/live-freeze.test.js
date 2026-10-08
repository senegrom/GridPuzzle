// The solved view freezes on its own verified frame and stays until Clear
// (resume) or close: nothing is sampled, detected, tracked, read or solved
// meanwhile, every late reply is fenced, and Clear scans again from nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const SIZE = 700, GRID = 440, CELLS = 4;
const SOLUTION = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
const unique = () => ({ status: "unique", complete: true, solutions: [{ cells: [...SOLUTION] }] });
const FROZEN = /^Solution preview — frozen\./;

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of a SIZE x SIZE frame (as in live-relock.test.js).
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
function reading() {
  const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
  return { puzzle, cellUncertain: [], markedCells: [] };
}

// The production camera, tracker and tracking core on a fake clock with the
// printed grid; detection is stubbed to find it where it is. Every canvas
// records the images drawn into it and its clears. `solve` is "unique" (an
// immediate unique solution), "deferred" (h.solveJobs) or a function.
function simulation(t, { autoSolve = true, solve = "unique", read = null, workerMs = 20 } = {}) {
  let time = 0, serial = 0, x = 120, y = 110, frozenTime = null, rejectAll = false, holdDetections = false, failVerify = 0;
  const timers = new Map(), nodes = new Map(), posts = [], draws = [], clears = [], created = [], workers = [];
  const solveJobs = [], heldDetections = [], viewChanges = [];
  const counts = { reads: 0, detects: 0, detectorCancels: 0, solves: 0 };
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  function canvas() {
    const c = { width: SIZE, height: SIZE, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const ctx = { canvas: c, drawImage(source) { draws.push({ target: c, source, at: time }); },
      clearRect() { clears.push({ target: c, at: time }); }, save() {}, restore() {}, translate() {}, rotate() {},
      fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      getImageData: (_x, _y, width, height) => width === SIZE && height === SIZE ? scene(x, y)
        : { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } };
    c.getContext = () => ctx;
    return c;
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => { const c = canvas(); created.push({ canvas: c, at: time }); return c; } };
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: true }); return nodes.get(id); };
  const writes = []; let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        posts.push({ op: message.op, at: time });
        setTimer(() => {
          if (worker.dead) return;
          let data;
          try {
            // failVerify(n): the next n verifications fail in the worker.
            if (failVerify > 0 && message.op === "verify") { failVerify--; throw Error("worker failure"); }
            // rejectVerify: the worker answers, but the printed content no
            // longer matches any anchor (the grid moved away or changed).
            const result = rejectAll && message.op === "verify"
              ? { proofs: Object.fromEntries(message.anchors.map((id) => [id, null])),
                rejections: Object.fromEntries(message.anchors.map((id) => [id, { reason: "cell-content", region: 0 }])) }
              : core.run(message);
            data = { id: message.id, result, milliseconds: workerMs };
          } catch (error) { data = { id: message.id, error: error.message }; }
          worker.onmessage?.({ data });
        }, 20);
      },
      terminate() { worker.dead = true; },
    };
    workers.push(worker);
    return worker;
  } });
  // The camera hands detection a copy scaled to at most 640 pixels.
  const small = (p) => ({ x: p.x * 639 / (SIZE - 1), y: p.y * 639 / (SIZE - 1) });
  const found = () => ({ confidence: .99, rows: 4, cols: 4, sharpness: 200, corners: cornersAt(x, y).map(small) });
  const diagnostics = createScanDiagnostics({ now: () => time });
  diagnostics.begin("live", { type: "latinsquare", rows: 4, cols: 4, autoSolve });
  const video = { videoWidth: SIZE, videoHeight: SIZE, get currentTime() { return (frozenTime ?? time) / 1000; } };
  const camera = createLiveCamera({ tracker, $, canvas: view, diagnostics, video,
    getSettings: () => ({ type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true, autoSolve }),
    detector: { detect() {
      counts.detects++;
      if (holdDetections) { const job = deferred(); heldDetections.push(job); return job.promise; }
      return new Promise((resolve) => setTimer(() => resolve(found()), 50));
    }, cancel() { counts.detectorCancels++; } },
    // Scanner.read(image, corners, type, rows, cols, progress, { onPreview, ... }).
    reader: { read(...args) {
      counts.reads++;
      if (read) return read(args[6].onPreview, setTimer);
      return new Promise((resolve) => setTimer(() => resolve(reading()), 500));
    }, cancel() {} },
    solver: { solve() {
      counts.solves++;
      if (solve === "deferred") { const job = deferred(); solveJobs.push(job); return job.promise; }
      return typeof solve === "function" ? solve() : Promise.resolve(unique());
    }, cancel() {}, invalidate() {} },
    onViewChange: (value) => viewChanges.push(value),
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
  async function until(predicate, limit = 10000, step = 50) {
    for (let waited = 0; !predicate() && waited < limit; waited += step) await advance(step);
    return predicate();
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, view, video, $, counts, timers, posts, draws, clears, created, writes, workers, solveJobs, heldDetections, viewChanges, diagnostics,
    advance, until, found,
    get now() { return time; }, get help() { return help; },
    raw: () => camera.diagnosticSource().image,
    viewDraws: () => draws.filter((d) => d.target === view),
    move(dx, dy) { x += dx; y += dy; }, stall() { frozenTime = time; }, resume() { frozenTime = null; },
    rejectVerify(value) { rejectAll = value; }, holdDetections(value) { holdDetections = value; },
    failVerify(count) { failVerify = count; } };
}
const frozenNow = (h) => h.camera.view === "frozen";

test("a verified unique solution freezes on its own frame and stops all frame work", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)), "the solved view freezes");
  assert.equal(h.view.attributes["data-view"], "frozen");
  assert.equal(h.camera.stats.view, "frozen");
  assert.deepEqual(h.viewChanges, ["frozen"]);
  assert.equal(h.view.dataset.solution, "12");
  assert.equal(h.view.dataset.delayed, "0", "the frozen picture is never marked DELAYED");
  assert.match(h.view.attributes["aria-label"], /^Frozen picture of the solved puzzle: 4 recognised, .* 12 solution entries/);
  const raw = h.raw();
  assert.ok(raw && raw.width > 0);
  assert.equal(h.viewDraws().at(-1).source, raw, "the frozen paint is the frame the solution was verified on");
  assert.match(h.help, FROZEN); assert.match(h.help, /preview/i);
  await h.advance(100);
  assert.equal(h.timers.size, 0, "no scheduler, deadline or worker timer remains");
  const posts = h.posts.length, detects = h.counts.detects, paints = h.viewDraws().length, writes = h.writes.length;
  await h.advance(10000);
  assert.equal(h.posts.length, posts, "no tracking while frozen");
  assert.equal(h.counts.detects, detects, "no detection while frozen");
  assert.equal(h.viewDraws().length, paints, "nothing repaints the frozen picture");
  assert.equal(h.writes.length, writes, "nothing rewrites the help line");
  assert.equal(h.raw(), raw);
  assert.equal(h.counts.reads, 1); assert.equal(h.counts.solves, 1);
  assert.equal(h.camera.stats.retainedSources, 1, "only the frozen frame is retained");
  assert.ok(h.workers.length > 0 && h.workers.every((worker) => worker.dead), "the tracking worker is terminated");
});

test("the frozen view ignores scene changes, stalls, slow replies and the loss limit", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  const raw = h.raw(), writes = h.writes.length;
  h.stall(); h.move(60, 40);
  await h.advance(10000);
  assert.equal(h.camera.view, "frozen");
  assert.equal(h.view.dataset.solution, "12");
  assert.deepEqual(h.writes.slice(writes), [], "no Grid lost, no stalled-feed message");
  assert.match(h.help, FROZEN);
  const shot = h.camera.capture();
  assert.equal(shot.frozen, true);
  assert.deepEqual(shot.found.puzzle.cells, reading().puzzle.cells, "the frozen reading");
  assert.equal(h.draws.find((d) => d.target === shot.photo)?.source, raw, "the photo is a copy of the frozen frame");
});

test("capture while frozen copies the frozen frame and composition; a capture can itself freeze", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.solveJobs[0].resolve(unique()); await flush();
  // The solved preview is published, but no render has painted it yet: the
  // shutter's own render freezes it, and the frozen picture is what is saved.
  assert.equal(h.camera.view, "live");
  const shot = h.camera.capture();
  assert.equal(h.camera.view, "frozen");
  assert.equal(shot.frozen, true);
  const raw = h.raw();
  assert.equal(h.draws.find((d) => d.target === shot.photo)?.source, raw);
  assert.equal(h.draws.find((d) => d.target === shot.annotated)?.source, h.view, "annotated is a copy of the shown composition");
  assert.equal(shot.found.puzzle.cells.filter(Number.isInteger).length, 4);
  assert.equal(shot.corners.length, 4);
  shot.found.puzzle.cells[4] = 9; shot.corners[0].x = -1;
  const again = h.camera.capture();
  assert.equal(again.found.puzzle.cells[4], null, "each capture owns its copy of the reading");
  assert.notEqual(again.corners[0].x, -1);
});

test("Clear resumes from nothing: a fresh detection, read and solve on a new frame", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.solveJobs[0].resolve(unique());
  assert.ok(await h.until(() => frozenNow(h)));
  await h.advance(500);
  const old = h.raw(), clears = h.clears.length, detects = h.counts.detects;
  h.camera.resume();
  assert.equal(h.camera.view, "live");
  assert.equal(h.view.attributes["data-view"], "live");
  assert.deepEqual(h.viewChanges, ["frozen", "live"]);
  assert.equal(h.clears.length, clears + 1); assert.equal(h.clears.at(-1).target, h.view, "the canvas is cleared");
  for (const key of ["recognised", "uncertain", "unknown", "solution", "delayed"]) assert.equal(h.view.dataset[key], "0", key);
  assert.equal(h.view.attributes["aria-label"], "Live camera preview", "no longer described as the frozen picture");
  assert.equal(old.width, 0, "the frozen frame is released");
  assert.equal(h.camera.stats.retainedSources, 0);
  assert.equal(h.timers.size, 1, "exactly the scheduler's heartbeat");
  h.camera.resume();
  assert.equal(h.timers.size, 1, "a second Clear is a no-op");
  assert.deepEqual(h.viewChanges, ["frozen", "live"]);
  assert.doesNotMatch(h.help, FROZEN);
  const solutions = [];
  for (let waited = 0; h.solveJobs.length < 2 && waited < 10000; waited += 50) {
    await h.advance(50); solutions.push(h.view.dataset.solution);
  }
  assert.equal(h.solveJobs.length, 2, "the same grid is solved again");
  assert.ok(h.counts.detects >= detects + 2, "only after new detections");
  assert.equal(h.counts.reads, 2, "and a new read");
  assert.ok(solutions.every((value) => value === "0"), "the old solution never returns before the new solve");
  h.solveJobs[1].resolve(unique());
  assert.ok(await h.until(() => frozenNow(h)));
  assert.notEqual(h.raw(), old);
});

test("a solve finishing while the grid does not verify freezes only once it verifies again", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.rejectVerify(true); await h.advance(400);
  h.solveJobs[0].resolve(unique()); await flush(); await h.advance(400);
  assert.equal(h.camera.view, "live", "an unverified result is not shown, so it cannot freeze");
  assert.equal(h.view.dataset.solution, "0");
  const before = h.raw();
  h.rejectVerify(false);
  assert.ok(await h.until(() => frozenNow(h), 3000));
  assert.notEqual(h.raw(), before, "frozen on the newly verified frame");
  assert.equal(h.viewDraws().at(-1).source, h.raw());
  assert.equal(h.view.dataset.solution, "12");
});

test("without automatic solving a settled reading never freezes and keeps tracking", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  const posts = h.posts.length;
  await h.advance(6000);
  assert.equal(h.camera.view, "live");
  assert.equal(h.counts.solves, 0); assert.equal(h.view.dataset.solution, "0");
  assert.ok(h.posts.length > posts + 10, "verification goes on");
  assert.match(h.help, /Automatic solving is off/);
});

test("a freeze inside a tick does not track or adopt that tick's frame", async (t) => {
  // Replies that report 200 ms keep the interval at 300 ms, so a tick runs on
  // every third 100-ms pulse, before that pulse's heartbeat.
  const h = simulation(t, { solve: "deferred", workerMs: 200 });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  const lastTick = () => Math.max(...h.created.map((c) => c.at));
  const seen = lastTick();
  assert.ok(await h.until(() => lastTick() > seen, 1000, 100));
  const tickAt = lastTick();
  await h.advance(tickAt + 250 - h.now);
  assert.equal(lastTick(), tickAt, "no tick in the two pulses after it");
  h.solveJobs[0].resolve(unique()); await flush();
  assert.equal(h.camera.view, "live");
  const raw = h.raw(), posts = h.posts.length;
  await h.advance(50);
  assert.equal(h.camera.view, "frozen");
  // This video has no requestVideoFrameCallback, so the pulse that ran the
  // freezing tick runs its heartbeat right after it (as it does in browsers
  // without one, and after the native callback stalls). That heartbeat sees
  // the scheduler the freeze stopped and must not report a stalled feed or
  // put "Waiting for a new camera frame" over the frozen help line.
  assert.match(h.help, FROZEN, "the same pulse's heartbeat leaves the frozen help line");
  const reasons = h.diagnostics.snapshot().events.map((e) => `${e.stage}:${e.reason}`);
  assert.equal(reasons.at(-1), "complete:frozen", `nothing follows the freeze: ${reasons.slice(-3).join(" ")}`);
  const sampled = h.created.filter((c) => c.at === h.now);
  assert.equal(sampled.length, 1, "the freezing tick took its snapshot and nothing else");
  assert.equal(sampled[0].canvas.width, 0, "and released it at once");
  assert.equal(h.raw(), raw, "the frozen frame keeps its identity");
  assert.equal(h.viewDraws().at(-1).source, raw);
  assert.equal(h.posts.length, posts, "the frame was neither tracked nor sent for detection");
  assert.equal(h.camera.stats.candidate, 0); assert.equal(h.camera.stats.retainedSources, 1);
});

// live-camera-recovery.test.js's harness: the real tracking core behind a
// fake tracker whose reset does not reject held replies, so the camera's own
// fences are what keeps a late reply out; detections and reads are manual.
function heldReplies(t) {
  let time = 0, serial = 0, hold = false, core = createTrackingCore();
  const timers = new Map(), detections = [], readings = [], held = [], renders = [], draws = [], created = [], texts = [], events = [], nodes = new Map();
  const context = { drawImage(source) { draws.push(source); }, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
    fillRect() {}, fillText(text) { texts.push(text); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(180) }) };
  const canvas = () => ({ width: 700, height: 700, dataset: {}, attributes: {}, getContext: () => context, setAttribute(name, value) { this.attributes[name] = value; } });
  const previous = globalThis.document;
  globalThis.document = { createElement: () => { const c = canvas(); created.push(c); return c; } };
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: true }); return nodes.get(id); };
  const tracker = {
    anchor: async (task) => core.run({ ...task, op: "anchor" }),
    verify: (task) => hold ? new Promise((resolve, reject) => held.push({ resolve, reject, result: () => core.run({ ...task, op: "verify" }),
      settle() { resolve(this.result()); } }))
      : Promise.resolve(core.run({ ...task, op: "verify" })),
    reset() { core = createTrackingCore(); },
  };
  const camera = createLiveCamera({ tracker, $, canvas: view,
    diagnostics: { event: (value) => events.push(value), configure() {}, geometry() {}, tracking() {}, scheduling() {}, rendering: (value) => renders.push(value) },
    video: { videoWidth: 700, videoHeight: 700, get currentTime() { return time / 1000; } },
    getSettings: () => ({ type: "latinsquare", rows: 2, cols: 2, boxRows: 1, boxCols: 2, enabled: true }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() {} },
    reader: { read() { const job = deferred(); readings.push(job); return job.promise; }, cancel() {} },
    solver: { solve: async () => ({ status: "unique", complete: true, solutions: [{ cells: [1, 2, 2, 1] }] }), cancel() {}, invalidate() {} },
    now: () => time, setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; }, clearTimer(id) { timers.delete(id); } });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next; time = job.at; timers.delete(id); job.fn(); await flush();
    }
    time = end; await flush();
  }
  async function result(sharpness = 200) {
    detections.at(-1).resolve({ confidence: .99, rows: 2, cols: 2, sharpness,
      corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
    await flush(); await advance(100);
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, view, detections, readings, held, renders, draws, created, texts, events, $, advance, result, holdTracking(value) { hold = value; } };
}

test("replies held across the freeze are fenced: the frozen frame stays and nothing paints", async (t) => {
  const h = heldReplies(t);
  await h.advance(100); await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
  // Verifications submitted from now on stay in flight; the last adopted
  // proofs still verify the reading for up to two seconds, by now on the
  // delayed tier.
  h.holdTracking(true); await h.advance(700);
  assert.ok(h.held.length > 0, "verifications are in flight");
  assert.equal(h.view.dataset.delayed, "1", "the view lags behind the camera");
  // The freeze waits for a frame at most half a second old: the latest
  // verification is handed back and adopted, still on the delayed tier,
  // while the older ones and the next tick's stay in flight.
  h.held.pop().settle(); await flush(); await h.advance(100);
  assert.ok(h.held.length > 1, "verifications from before and after it are in flight");
  const puzzle = makePuzzle("latinsquare", 2); puzzle.cells = [1, null, null, 1];
  const texts = h.texts.length;
  h.readings[0].resolve({ puzzle, cellUncertain: [], cageUncertain: [], markedCells: [0, 3], needsReview: true, notes: [] });
  await flush(); await h.advance(100);
  assert.equal(h.camera.view, "frozen");
  const frozenPaint = h.texts.slice(texts);
  assert.ok(frozenPaint.includes("PREVIEW"));
  assert.equal(frozenPaint.includes("DELAYED"), false, "no picture is marked DELAYED");
  assert.equal(h.view.dataset.delayed, "0", "the frozen picture is not marked as catching up");
  const raw = h.camera.diagnosticSource().image, paints = h.renders.filter((r) => r.painted).length, draws = h.draws.length;
  // One held verification fails late: a worker error from before the freeze
  // must not reach the frozen view (no failure, message or Restart).
  const [failing, ...rest] = h.held;
  failing.reject(Error("late worker failure"));
  for (const job of rest) job.resolve(job.result());
  for (const job of h.detections) job.resolve({ confidence: 0 });
  await flush(); await h.advance(1000);
  assert.equal(h.camera.diagnosticSource().image, raw, "no late reply replaces the frozen frame");
  assert.equal(h.renders.filter((r) => r.painted).length, paints);
  assert.equal(h.draws.length, draws, "nothing is drawn, not even a copy");
  assert.equal(h.view.dataset.solution, "2");
  assert.equal(h.events.some((event) => event.reason === "worker-error"), false, "a late failure is fenced");
  assert.match(h.$("camera-help").textContent, FROZEN);
  assert.equal(h.camera.stats.recovery.failures, 0); assert.equal(h.$("restart-live").hidden, true);
  const [scratchA, scratchB] = h.created;
  assert.deepEqual(h.created.filter((c) => c.width !== 0), [scratchA, scratchB, raw],
    "every fenced frame is released; the frozen frame and the two scratch canvases remain");
});

// The freeze retires the reading, since Clear starts over. A candidate that
// the reply which freezes also verifies becomes the session's best frame, and
// one sharp enough starts a re-read of it: neither outlives the freeze, so no
// frame is held beside the frozen one and no OCR goes on while frozen.
for (const [kept, sharpness] of [["the frame the reading kept as its best", 200], ["the re-read of a sharper frame", 300]])
  test(`the freeze retires the reading: ${kept} does not outlive it`, async (t) => {
    const h = heldReplies(t);
    await h.advance(100); await h.result(); await h.advance(700); await h.result();
    assert.equal(h.readings.length, 1, "a read is running");
    h.holdTracking(true); // From here verifications stay in flight until handed back.
    const detections = h.detections.length;
    for (let waited = 0; h.detections.length === detections && waited < 2000; waited += 50) await h.advance(50);
    assert.equal(h.detections.length, detections + 1, "a tracked detection starts");
    await h.result(sharpness);
    assert.equal(h.camera.stats.candidate, 1, "its candidate waits for a held verification");
    const job = h.held.at(-1);
    // The read and its solve finish: the solved preview is published, but no
    // timer has run since, so nothing has painted it.
    const puzzle = makePuzzle("latinsquare", 2); puzzle.cells = [1, null, null, 1];
    const read = () => ({ puzzle: structuredClone(puzzle), cellUncertain: [], cageUncertain: [], markedCells: [0, 3], needsReview: true, notes: [] });
    h.readings[0].resolve(read());
    await flush();
    assert.equal(h.camera.view, "live");
    // The reply that verifies the candidate verifies the reading too: the
    // session takes the candidate, and the render that follows freezes.
    job.resolve(job.result()); await flush();
    assert.equal(h.camera.view, "frozen");
    assert.equal(h.readings.length, sharpness > 200 ? 2 : 1, sharpness > 200 ? "the sharper frame is being read" : "no re-read");
    const raw = h.camera.diagnosticSource().image, events = h.events.length;
    for (const other of h.held) if (other !== job) other.resolve(other.result());
    for (const detection of h.detections) detection.resolve({ confidence: 0 });
    await flush(); await h.advance(1000);
    const [scratchA, scratchB] = h.created;
    assert.deepEqual(h.created.filter((c) => c.width !== 0), [scratchA, scratchB, raw],
      "only the frozen frame and the two scratch canvases hold pixels while frozen");
    for (const reading of h.readings.slice(1)) reading.resolve(read());
    await flush(); await h.advance(1000);
    assert.equal(h.camera.view, "frozen");
    assert.deepEqual(h.events.slice(events), [], "nothing the reading started reports back");
    assert.match(h.$("camera-help").textContent, FROZEN);
  });

test("closing a frozen camera releases everything, and thirty Clear cycles leave nothing behind", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  await h.advance(100);
  h.camera.stop();
  assert.equal(h.camera.stats.retainedSources, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.camera.view, "live"); assert.equal(h.camera.stats.scratchPixels, 0);
  assert.match(h.view.attributes["aria-label"], /^Frozen picture/);
  h.camera.start();
  assert.equal(h.view.attributes["data-view"], "live", "a camera started on the canvas a frozen one left is live");
  assert.equal(h.view.attributes["aria-label"], "Live camera preview", "and no longer described as the frozen picture");
  assert.deepEqual([h.view.dataset.recognised, h.view.dataset.solution, h.view.dataset.overlay, h.view.dataset.delayed], ["0", "0", "none", "0"],
    "nor counted as it, before its first paint");
  for (let cycle = 0; cycle < 30; cycle++) {
    assert.ok(await h.until(() => frozenNow(h)), `cycle ${cycle} freezes`);
    await h.advance(100);
    assert.equal(h.timers.size, 0, `cycle ${cycle}: no timer while frozen`);
    assert.equal(h.camera.stats.retainedSources, 1);
    h.camera.resume();
  }
  h.camera.stop(); await h.advance(1000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.camera.stats.retainedSources, 0); assert.equal(h.camera.stats.scratchPixels, 0);
  assert.deepEqual(h.created.filter((c) => c.canvas.width !== 0).map((c) => c.at), [], "every canvas the camera made is released");
  assert.equal(h.counts.reads, 31); assert.equal(h.counts.solves, 31);
});

for (const [name, options] of [
  ["a provisional atlas reading", { read: (onPreview, setTimer) => {
    setTimer(() => { const partial = reading(); partial.cellUncertain = [0, 1, 2, 3]; onPreview(partial); }, 200);
    return new Promise(() => {});
  } }],
  ["a reading with more than one solution", { solve: async () => ({ status: "multiple", complete: true, solutions: [{ cells: SOLUTION }, { cells: SOLUTION }] }) }],
  ["a reading with no solution", { solve: async () => ({ status: "no-solution", complete: true, solutions: [] }) }],
])
  test(`${name} never freezes`, async (t) => {
    const h = simulation(t, options);
    assert.ok(await h.until(() => Number(h.view.dataset.recognised) + Number(h.view.dataset.uncertain) === 4));
    const posts = h.posts.length;
    await h.advance(6000);
    assert.equal(h.camera.view, "live");
    assert.equal(h.view.dataset.solution, "0");
    assert.ok(h.posts.length > posts, "tracking goes on");
    assert.deepEqual(h.viewChanges, []);
  });

test("Restart live scanning is hidden while frozen, even with the scheduler stopped", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  assert.equal(h.$("restart-live").hidden, true);
  h.stall(); await h.advance(3000);
  assert.equal(h.$("restart-live").hidden, true);
  h.camera.restart();
  assert.equal(h.camera.view, "frozen", "Restart does nothing to a frozen view");
  await h.advance(1000);
  assert.equal(h.timers.size, 0, "and starts no scheduler");
});

test("Restart live scanning offered just before the freeze is hidden by the freeze itself", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.rejectVerify(true);
  assert.ok(await h.until(() => h.$("restart-live").hidden === false, 4000, 10), "three rejected candidates offer Restart");
  h.solveJobs[0].resolve(unique()); await flush();
  assert.equal(h.camera.view, "live", "an unverified result is not shown");
  // The reply that verifies again resets the rejected count and freezes in
  // the same render, before a heartbeat could hide Restart, and no heartbeat
  // runs while frozen.
  h.rejectVerify(false);
  assert.ok(await h.until(() => frozenNow(h), 2000, 10));
  assert.equal(h.$("restart-live").hidden, true, "the frozen view offers no Restart, which would do nothing");
});

test("Clear resets the tracking-failure circuit, as Restart does", async (t) => {
  const h = simulation(t);
  h.failVerify(1); // The first verification of the candidate fails in the worker.
  assert.ok(await h.until(() => h.camera.stats.recovery.failures === 1, 5000, 10), "a tracking failure is counted");
  assert.ok(await h.until(() => frozenNow(h)), "tracking recovers after its back-off and the grid is solved");
  // Only two seconds of sustained verified tracking clear a failure; the
  // freeze came sooner, so the count is still there behind the frozen view.
  assert.equal(h.camera.stats.recovery.failures, 1);
  h.camera.resume();
  assert.equal(h.camera.stats.recovery.failures, 0, "the scan after Clear starts with a clean circuit");
  assert.equal(h.camera.stats.recovery.retryInMilliseconds, 0);
});

// Clear starts the detection and lag clocks over too, so the scan after it
// owes nothing to the one before the freeze. The first frame the paused
// video reports after Clear is discarded (it can be the picture of the
// freeze), so the first frame scanned is the second.
test("Clear right after a detection began detects again on the first frame it scans", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.holdDetections(true);
  const detects = h.counts.detects;
  assert.ok(await h.until(() => h.counts.detects > detects, 3000, 10), "a detection starts");
  const started = h.now;
  h.solveJobs[0].resolve(unique()); await flush();
  h.camera.capture(); // Its render freezes the solved view at once.
  assert.ok(frozenNow(h));
  h.camera.resume();
  const before = h.counts.detects;
  assert.ok(await h.until(() => h.camera.stats.scheduling.processed > 0, 300, 10), "a frame is scanned after Clear");
  assert.equal(h.camera.stats.scheduling.discarded, 1, "after the first one, discarded");
  assert.ok(h.counts.detects > before, "the first frame scanned after Clear starts a detection");
  assert.ok(h.now - started < 300, `within 300 ms of the last one before the freeze (${h.now - started} ms)`);
});

test("Clear discards the first frame the paused video reports, which can be the picture of the freeze", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  await h.advance(500);
  h.camera.resume();
  const ticks = h.camera.stats.scheduling.processed;
  await h.advance(100); // The first report after Clear: a baseline only.
  assert.equal(h.camera.stats.scheduling.discarded, 1);
  assert.equal(h.camera.stats.scheduling.processed, ticks, "nothing is scanned from it");
  await h.advance(100);
  assert.equal(h.camera.stats.scheduling.processed, ticks + 1, "the next frame is scanned");
});

test("the first verified view after Clear is not marked as catching up for a lag before the freeze", async (t) => {
  const h = heldReplies(t);
  await h.advance(100); await h.result(); await h.advance(700); await h.result();
  assert.equal(h.readings.length, 1);
  h.holdTracking(true); await h.advance(700);
  assert.equal(h.view.dataset.delayed, "1", "the view lags behind the camera before the freeze");
  // A fresh frame for the freeze, adopted while the lag still holds the tier.
  h.held.pop().settle(); await flush();
  const puzzle = makePuzzle("latinsquare", 2); puzzle.cells = [1, null, null, 1];
  h.readings[0].resolve({ puzzle, cellUncertain: [], cageUncertain: [], markedCells: [0, 3], needsReview: true, notes: [] });
  await flush(); await h.advance(100);
  assert.equal(h.camera.view, "frozen");
  for (const job of h.held) job.resolve(job.result());
  h.holdTracking(false); await flush();
  h.camera.resume();
  const paints = h.renders.filter((r) => r.painted).length, detections = h.detections.length;
  // The first frame the video reports after Clear is a baseline only
  // (discardFirst); the next one starts a new detection, which is resolved
  // here and verified on the frame after.
  await h.advance(200);
  assert.equal(h.detections.length, detections + 1, "the first frame scanned after Clear starts a detection");
  await h.result();
  await h.advance(100);
  assert.equal(h.camera.stats.candidate, 0, "the candidate was verified");
  assert.ok(h.renders.filter((r) => r.painted).length > paints, "views were painted after Clear");
  assert.equal(h.view.dataset.overlay, "outline", "the verified outline is shown");
  assert.equal(h.view.dataset.delayed, "0", "and not marked as catching up");
  assert.doesNotMatch(h.view.attributes["aria-label"], /catching up/);
});

test("diagnostics: the frozen frame is the verified source, and the freeze and Clear are reported", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  const source = h.camera.diagnosticSource();
  assert.equal(source.verified, true); assert.equal(source.image, h.viewDraws().at(-1).source);
  const events = () => h.diagnostics.snapshot().events.map((e) => `${e.stage}:${e.reason}`);
  assert.ok(events().includes("tracking:frozen"), events().join(" "));
  assert.equal(events().at(-1), "complete:frozen");
  assert.equal(h.diagnostics.snapshot().reason, "frozen");
  const tick = h.diagnostics.snapshot().performance.tick;
  assert.ok(tick.count > 0 && tick.meanMilliseconds >= 0, "main-thread time per sampled frame");
  h.camera.resume();
  assert.ok(events().includes("tracking:cleared"), events().join(" "));
  assert.equal(events().at(-1), "detecting:cleared");
});

test("a detection in flight at the freeze is abandoned without cancelling its worker", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.holdDetections(true);
  const detects = h.counts.detects;
  assert.ok(await h.until(() => h.counts.detects > detects, 3000), "a settled detection starts");
  const sample = h.created.at(-1).canvas, cancels = h.counts.detectorCancels, posts = h.posts.length;
  assert.ok(sample.width > 0, "the detection holds its own copy of the frame");
  h.solveJobs[0].resolve(unique()); await flush();
  await h.advance(100);
  assert.equal(h.camera.view, "frozen");
  assert.equal(h.counts.detectorCancels, cancels, "the geometry worker is not cancelled");
  await h.advance(100);
  assert.equal(h.timers.size, 0, "its eight-second deadline is cleared");
  assert.equal(h.camera.stats.detection, 0);
  h.heldDetections[0].resolve(h.found()); await flush(); await h.advance(1000);
  assert.equal(h.camera.view, "frozen");
  assert.equal(h.posts.length, posts, "the late reply builds no anchor");
  assert.equal(h.camera.stats.candidate, 0); assert.equal(h.camera.stats.retainedSources, 1);
  assert.equal(sample.width, 0, "its frame is released");
  assert.equal(h.timers.size, 0);
});

test("a detection candidate still waiting for its verdict at the freeze is discarded", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  // A settled detection's candidate waits for the next frame's verification.
  assert.ok(await h.until(() => h.camera.stats.candidate === 1, 3000, 10), "a candidate is pending");
  h.solveJobs[0].resolve(unique()); await flush();
  assert.ok(await h.until(() => frozenNow(h), 500, 10));
  assert.equal(h.camera.stats.candidate, 0);
  assert.equal(h.camera.stats.retainedSources, 1, "its frame is not kept beside the frozen one");
  await h.advance(1000);
  h.camera.resume();
  assert.equal(h.camera.stats.candidate, 0, "Clear starts without it");
});

test("after Clear the help line says when no picture arrives, then gives way", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => frozenNow(h)));
  h.video.videoWidth = 0; // The resumed stream has no picture yet.
  h.camera.resume();
  await h.advance(900);
  assert.doesNotMatch(h.help, /deliver a picture/);
  await h.advance(200);
  assert.equal(h.help, "Waiting for the camera to deliver a picture…");
  assert.equal(h.$("restart-live").hidden, true);
  h.video.videoWidth = SIZE;
  await h.advance(200);
  assert.doesNotMatch(h.help, /deliver a picture/, "the first frame ends the wait");
  h.stall(); await h.advance(700);
  assert.match(h.help, /new camera frame/, "a feed that stops after a frame is reported as before");
});
