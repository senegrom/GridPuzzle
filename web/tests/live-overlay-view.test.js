// The live view: the video is the display, and over it the camera's canvas is
// transparent with only the outline of the latest verified proof; a solved
// reading freezes on its own verified frame once that frame is fresh and no
// retry of an uncertain clue may change it, or after three seconds; a live
// capture keeps the reading only on a fresh verified frame. The production
// camera, tracker and tracking core run on a fake clock with a printed 4x4
// grid, and every canvas records what is drawn into it.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { createScanDiagnostics } from "../scan-diagnostics.js";
import { SCAN_COLOURS } from "../live-overlay.js";
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
const FROZEN = /^Solution preview — frozen\./, WAITING = "Solution found — hold the grid steady for a moment…";
// A solution digit (the bar's own "Solution" label is blue too).
const blueDigit = (o) => o.op === "fillText" && o.style === SCAN_COLOURS.solution && /^\d+$/.test(o.text);

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
// The top row read; `uncertain` and `marked` as the reader flags them.
function reading({ uncertain = [], marked = [] } = {}) {
  const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
  return { puzzle, cellUncertain: [...uncertain], markedCells: [...marked], notes: [] };
}

// The production camera, tracker and tracking core on a fake clock. The fake
// tracking worker runs the real core and answers after `replyMs`; while held
// (`hold()`), it keeps its operation until `release()`; with
// `rejectVerify(true)` the printed content matches no anchor any more; and
// `jitter(px)` moves every proof's corners by that much, alternately up and
// down. `solve` is "unique", "deferred" (h.solveJobs) or a function; `read`
// replaces the 500-ms reader; `readCells` adds the reader's targeted retry;
// `quality(n)` is the n-th detection's quality report. Every canvas records
// drawImage, clearRect, stroke and fillText (with its fill colour), in one
// list of operations; the legend's data-count writes are counted.
function simulation(t, { autoSolve = true, solve = "unique", read = null, readCells = null, quality = null, replyMs = 20, viewSize = [SIZE, SIZE] } = {}) {
  let time = 0, serial = 0, x = 120, y = 110, frozenTime = null, hold = false, detections = 0, rejectAll = false, jitter = 0, replies = 0, countWrites = 0;
  const timers = new Map(), nodes = new Map(), ops = [], created = [], held = [], solveJobs = [], renders = [];
  const counts = { reads: 0, retries: 0, solves: 0 };
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  function canvas() {
    const c = { width: SIZE, height: SIZE, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const record = (op, extra = {}) => ops.push({ target: c, op, at: time, ...extra });
    const ctx = { canvas: c, fillStyle: "#000",
      drawImage(source) { record("drawImage", { source }); }, clearRect() { record("clearRect"); },
      fillText(text) { record("fillText", { text: String(text), style: this.fillStyle }); }, stroke() { record("stroke"); },
      fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      getImageData: (_x, _y, width, height) => width === SIZE && height === SIZE ? scene(x, y)
        : { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } };
    c.getContext = () => ctx;
    return c;
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => { const c = canvas(); created.push({ canvas: c, at: time }); return c; } };
  const element = () => ({ textContent: "", hidden: true, attributes: {},
    setAttribute(name, value) { if (name === "data-count") countWrites++; this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; } });
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  // Assigning a canvas's width or height reallocates and clears its bitmap:
  // the display canvas counts those assignments.
  let [viewWidth, viewHeight] = viewSize, sizeWrites = 0;
  Object.defineProperties(view, {
    width: { get: () => viewWidth, set(value) { sizeWrites++; viewWidth = value; } },
    height: { get: () => viewHeight, set(value) { sizeWrites++; viewHeight = value; } },
  });
  let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; } });
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        const reply = () => {
          if (worker.dead) return;
          let data;
          try {
            let result = core.run(message);
            if (message.op === "verify" && rejectAll) result = { proofs: Object.fromEntries(message.anchors.map((id) => [id, null])),
              rejections: Object.fromEntries(message.anchors.map((id) => [id, { reason: "cell-content", region: 0 }])) };
            else if (message.op === "verify" && jitter) {
              const d = ++replies % 2 ? jitter : -jitter;
              for (const proof of Object.values(result.proofs)) if (proof) proof.corners = proof.corners.map((p) => ({ x: p.x + d, y: p.y + d }));
            }
            data = { id: message.id, result, milliseconds: 20 };
          } catch (error) { data = { id: message.id, error: error.message }; }
          worker.onmessage?.({ data });
        };
        if (hold) held.push(reply); else setTimer(reply, replyMs);
      },
      terminate() { worker.dead = true; },
    };
    return worker;
  } });
  // Detection is handed a copy scaled to at most 640 pixels.
  const small = (p) => ({ x: p.x * 639 / (SIZE - 1), y: p.y * 639 / (SIZE - 1) });
  const diagnostics = createScanDiagnostics({ now: () => time }), rendering = diagnostics.rendering;
  diagnostics.rendering = (value) => { renders.push({ ...value, at: time }); rendering(value); };
  diagnostics.begin("live", { type: "latinsquare", rows: 4, cols: 4, autoSolve });
  const video = { videoWidth: SIZE, videoHeight: SIZE, get currentTime() { return (frozenTime ?? time) / 1000; } };
  const reader = { read(...args) {
    counts.reads++;
    if (read) return read(args[6].onPreview, setTimer);
    return new Promise((resolve) => setTimer(() => resolve(reading()), 500));
  }, cancel() {} };
  // Scanner.readCells(image, corners, found, cells, progress, options).
  if (readCells) reader.readCells = (...args) => { counts.retries++; return readCells(args[2], args[3], time); };
  const camera = createLiveCamera({ tracker, $, canvas: view, diagnostics, video,
    getSettings: () => ({ type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true, autoSolve }),
    detector: { detect() {
      const n = ++detections;
      return new Promise((resolve) => setTimer(() => resolve({ confidence: .99, rows: 4, cols: 4, sharpness: 200,
        quality: quality?.(n), corners: cornersAt(x, y).map(small) }), 50));
    }, cancel() {} },
    reader,
    solver: { solve() {
      counts.solves++;
      if (solve === "deferred") { const job = deferred(); solveJobs.push(job); return job.promise; }
      return typeof solve === "function" ? solve() : Promise.resolve(unique());
    }, cancel() {}, invalidate() {} },
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
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, view, video, $, counts, ops, created, renders, solveJobs, diagnostics, advance, until,
    get now() { return time; }, get help() { return help; },
    raw: () => camera.adoptedFrame(), frozen: () => camera.view === "frozen",
    on: (target, from = 0) => ops.slice(from).filter((o) => o.target === target),
    legend: () => Object.fromEntries(["recognised", "uncertain", "unknown", "solution"].map((key) => [key, $(`legend-${key}`).getAttribute("data-count")])),
    stall() { frozenTime = time; }, unstall() { frozenTime = null; },
    hold() { hold = true; }, release() { hold = false; for (const reply of held.splice(0)) reply(); },
    rejectVerify(value) { rejectAll = value; }, jitter(px) { jitter = px; },
    get held() { return held.length; }, get countWrites() { return countWrites; }, get sizeWrites() { return sizeWrites; } };
}

test("live, the canvas holds only the outline: no camera frame, no digits, no solution", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.equal(h.view.dataset.overlay, "none");
  assert.equal(h.view.attributes["aria-label"], "Live camera preview");
  assert.deepEqual(h.legend(), { recognised: null, uncertain: null, unknown: null, solution: null }, "no counts before a reading");
  await h.advance(100);
  assert.ok(h.raw(), "the first frame is adopted");
  assert.equal(h.view.dataset.overlay, "none"); assert.equal(h.view.attributes["aria-label"], "Live camera preview");
  assert.deepEqual(h.legend(), { recognised: null, uncertain: null, unknown: null, solution: null }, "nor once a frame is shown without one");
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(3000);
  const live = h.on(h.view);
  assert.deepEqual(live.filter((o) => o.op === "drawImage"), [], "no camera frame is painted over the video");
  assert.deepEqual(live.filter((o) => o.op === "fillText"), [], "no digits, no bar, no label");
  // Every paint clears first: the canvas is only ever a cleared layer with at
  // most one outline on it.
  const painted = h.renders.filter((r) => r.painted).length, clears = live.filter((o) => o.op === "clearRect").length;
  assert.ok(painted > 1); assert.equal(clears, painted, "one clear per paint");
  assert.equal(live[0].op, "clearRect");
  live.forEach((o, i) => { if (o.op === "stroke") assert.equal(live[i - 1].op, "clearRect", "an outline only on a cleared canvas"); });
  assert.ok(live.some((o) => o.op === "stroke"), "the outline is drawn");
  assert.equal(h.view.dataset.overlay, "outline");
  assert.equal(h.view.dataset.solution, "0");
  assert.equal(h.view.attributes["aria-label"], "Live camera. Grid outline shown; reading: 4 recognised, 0 uncertain, 0 unread clues.");
  assert.deepEqual(h.legend(), { recognised: "4", uncertain: "0", unknown: "0", solution: null }, "the legend counts the reading; no solution live");
  assert.match(h.help, /^Clues read \(4 recognised, 0 uncertain\)\. Automatic solving is off/);
  // Settled, the view does not repaint for sub-pixel jitter or on heartbeats.
  const settledPaints = h.renders.filter((r) => r.painted).length;
  await h.advance(2000);
  assert.equal(h.renders.filter((r) => r.painted).length, settledPaints, "an unchanged outline is not repainted");
  // The adopted snapshot is the canvas drawn from the video itself, never a copy.
  const raw = h.raw();
  assert.equal(raw, h.camera.diagnosticSource().image);
  assert.deepEqual(h.on(raw).filter((o) => o.op === "drawImage").map((o) => o.source), [h.video]);
  h.camera.stop();
  assert.equal(h.raw(), null);
  assert.deepEqual(h.legend(), { recognised: null, uncertain: null, unknown: null, solution: null }, "closing clears the counts");
});

test("the freeze is the one camera-frame paint, with the solution, and blue appears only there", async (t) => {
  const h = simulation(t);
  assert.equal(h.raw(), null, "no frame is adopted before the first tick");
  assert.ok(await h.until(() => h.frozen()));
  const ops = h.on(h.view), draws = ops.filter((o) => o.op === "drawImage");
  assert.equal(draws.length, 1, "exactly one camera frame on the canvas");
  assert.equal(draws[0].source, h.raw(), "the frame the solution was verified on");
  const at = ops.indexOf(draws[0]);
  assert.deepEqual(ops.slice(0, at).filter((o) => o.op === "fillText"), [], "no digits before the freeze");
  const frozenText = ops.slice(at).filter((o) => o.op === "fillText");
  assert.equal(frozenText.filter(blueDigit).length, 12, "the frozen picture carries the solution");
  assert.ok(frozenText.some((o) => o.text === "PREVIEW"));
  assert.equal(h.view.dataset.overlay, "composition"); assert.equal(h.view.dataset.solution, "12");
  assert.deepEqual(h.legend(), { recognised: "4", uncertain: "0", unknown: "0", solution: "12" }, "frozen, the legend counts the solution too");
  assert.match(h.view.attributes["aria-label"], /^Frozen picture of the solved puzzle: 4 recognised, 0 uncertain, 0 unread, 12 solution entries\./);
  assert.match(h.help, FROZEN);
  h.camera.resume();
  assert.equal(h.view.dataset.overlay, "none"); assert.equal(h.view.dataset.solution, "0");
  assert.deepEqual(h.legend(), { recognised: null, uncertain: null, unknown: null, solution: null }, "Clear clears the counts");
  assert.equal(h.raw(), null);
});

test("a live capture keeps a fresh verified frame with its reading and outline, without a solution", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  const raw = h.raw(), from = h.ops.length, preview = h.view.attributes["aria-label"];
  const shot = h.camera.capture();
  assert.equal(shot.frozen, false); assert.equal(h.camera.view, "live");
  assert.deepEqual(h.on(shot.photo).filter((o) => o.op === "drawImage").map((o) => o.source), [raw], "the photo is a copy of the verified frame");
  assert.notEqual(shot.photo, raw);
  const picture = h.on(shot.annotated);
  assert.equal(picture[0].op, "drawImage"); assert.equal(picture[0].source, raw, "the picture is drawn on the verified frame");
  const text = picture.filter((o) => o.op === "fillText");
  assert.deepEqual(text.filter((o) => o.style === SCAN_COLOURS.recognised && /^\d$/.test(o.text)).map((o) => o.text), ["1", "2", "3", "4"], "with its clues");
  assert.ok(picture.some((o) => o.op === "stroke"), "its outline");
  assert.ok(text.some((o) => o.text === "PREVIEW"), "and the bar");
  assert.deepEqual(shot.found.puzzle.cells, reading().puzzle.cells);
  assert.equal(shot.corners.length, 4);
  for (const [i, p] of cornersAt(120, 110).entries()) assert.ok(Math.hypot(shot.corners[i].x - p.x, shot.corners[i].y - p.y) < 2, JSON.stringify(shot.corners[i]));
  assert.deepEqual(h.on(h.view, from).filter((o) => o.op !== "clearRect" && o.op !== "stroke"), [], "nothing is drawn on the display canvas");
  assert.equal(h.view.attributes["aria-label"], preview);
  shot.found.puzzle.cells[5] = 9;
  assert.equal(h.camera.capture().found.puzzle.cells[5], null, "each capture owns its copy of the reading");
});

test("a live capture never draws blue, also while a solved reading waits to freeze", async (t) => {
  // An uncertain marked clue with retries left holds the freeze (see below).
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const shot = h.camera.capture();
  assert.equal(h.camera.view, "live"); assert.equal(shot.frozen, false);
  assert.ok(shot.found, "the fresh verified reading is kept");
  const text = h.on(shot.annotated).filter((o) => o.op === "fillText");
  assert.ok(text.some((o) => o.style === SCAN_COLOURS.uncertain), "the uncertain clue is yellow");
  assert.deepEqual(text.filter(blueDigit), [], "no solution was shown, so none is saved");
});

test("a live capture whose verified frame is older than half a second keeps the frame on screen, without a reading", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.hold(); await h.advance(700);
  assert.equal(h.view.dataset.recognised, "4", "the reading is still verified, on a frame 0.7 s old");
  const shot = h.camera.capture();
  assert.equal(shot.found, null); assert.equal(shot.corners, null); assert.equal(shot.frozen, false);
  assert.deepEqual(h.on(shot.photo).filter((o) => o.op === "drawImage").map((o) => o.source), [h.video], "a frame of the video now");
  const picture = h.on(shot.annotated);
  assert.equal(picture[0].source, shot.photo, "the picture is that frame");
  assert.deepEqual(picture.filter((o) => o.op === "fillText").map((o) => o.text), ["PREVIEW", "Read", "Check ?", "Unread ?", "Solution"], "with the bar and no clue");
  assert.equal(picture.some((o) => o.op === "stroke"), false, "and no outline");
  h.release(); await h.advance(300);
  assert.ok(h.camera.capture().found, "a fresh verified frame keeps the reading again");
});

test("a live capture without dimensions or before any proof", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.equal(h.camera.capture().found, null, "before anything is verified: the frame on screen");
  h.video.videoWidth = 0;
  assert.throws(() => h.camera.capture(), /not ready yet/);
});

// The video stays attached while frozen, and after Clear its paused player can
// still draw the picture of the freeze (WebKit). As for scanning, which
// discards the first frame reported after Clear, a live capture waits for a
// frame that was scanned; at the start of a session there is no such picture.
test("a live capture right after Clear waits for a frame reported after Clear", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.frozen()));
  h.camera.resume();
  assert.throws(() => h.camera.capture(), /Wait for a camera frame/, "no frame reported since Clear");
  await h.advance(100); // The first report after Clear: a baseline only.
  assert.equal(h.camera.stats.scheduling.discarded, 1);
  assert.throws(() => h.camera.capture(), /Wait for a camera frame/, "nor from the discarded one");
  await h.advance(100);
  assert.equal(h.camera.stats.scheduling.processed, 1, "a frame reported after Clear was scanned");
  const shot = h.camera.capture();
  assert.equal(shot.found, null); assert.equal(shot.frozen, false);
  assert.deepEqual(h.on(shot.photo).filter((o) => o.op === "drawImage").map((o) => o.source), [h.video], "the frame on screen now");
});

test("past the stale limit the adopted frame and its proofs are dropped, with no copy in their place", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  const raw = h.raw();
  h.hold(); await h.advance(2300);
  assert.equal(h.raw(), null); assert.equal(raw.width, 0, "the old frame is released");
  assert.equal(h.camera.diagnosticSource().verified, false);
  assert.equal(h.view.dataset.recognised, "0"); assert.equal(h.view.dataset.overlay, "none");
  assert.equal(h.camera.stats.retainedSources, h.camera.stats.candidate, "no frame or copy is kept for display");
  assert.deepEqual(h.on(h.view).filter((o) => o.op === "drawImage"), [], "and nothing is painted from one");
  assert.equal(h.camera.capture().found, null);
});

test("data-delayed and the label follow the evidence's tier; the outline trails", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  assert.equal(h.view.dataset.delayed, "0");
  const writes = h.countWrites, paints = h.renders.filter((r) => r.painted).length;
  h.hold(); await h.advance(700);
  assert.equal(h.view.dataset.delayed, "1");
  assert.ok(h.renders.filter((r) => r.painted).length > paints, "the tier change repaints");
  assert.equal(h.countWrites, writes, "and leaves the unchanged legend counts alone");
  assert.equal(h.view.dataset.overlay, "outline", "the outline of the last proof stays");
  assert.equal(h.view.attributes["aria-label"], "Live camera. Grid outline shown; reading: 4 recognised, 0 uncertain, 0 unread clues. The overlay is catching up with the camera.");
  h.release(); await h.advance(2500);
  assert.equal(h.view.dataset.delayed, "0", "two seconds of prompt replies return it to the live tier");
  assert.doesNotMatch(h.view.attributes["aria-label"], /catching up/);
});

test("after a stall the reading returns only with a newly verified frame", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.stall(); await h.advance(700);
  assert.equal(h.view.dataset.recognised, "0", "a stalled feed hides the reading");
  // Frames are presented again, but their verification is held: the proof
  // from before the stall must not bring the reading back on its own.
  h.hold(); h.unstall(); await h.advance(300);
  assert.equal(h.view.dataset.recognised, "0", "presented frames alone do not revive the old proof");
  assert.equal(h.camera.capture().found, null);
  h.release(); await h.advance(300);
  assert.equal(h.view.dataset.recognised, "4", "a newly verified frame does");
});

test("a camera closed while its outline lagged starts again on the live tier", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.hold(); await h.advance(700);
  assert.equal(h.view.dataset.delayed, "1");
  h.camera.stop(); h.release(); h.camera.start();
  assert.equal(h.view.dataset.delayed, "0", "before its first paint");
});

test("with no adopted frame a stalled feed still says so and offers Restart", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.hold(); await h.advance(2300);
  assert.equal(h.raw(), null);
  h.stall(); await h.advance(700);
  assert.match(h.help, /Waiting for a new camera frame/);
  assert.equal(h.$("restart-live").hidden, false, "a frame was seen, then none: Restart is offered");
});

test("an aspect mismatch between the adopted frame and the video draws nothing", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.hold(); await h.advance(150);
  assert.equal(h.held, 1, "a verification is in flight");
  // The stream turns to 4:3, before a heartbeat or tick resets the settings:
  // the reply for a square frame is adopted and rendered.
  h.video.videoHeight = 525;
  const from = h.ops.length, raw = h.raw();
  h.release(); await flush();
  assert.notEqual(h.raw(), raw, "the reply was adopted");
  assert.equal(h.view.dataset.recognised, "4", "its reading verifies");
  assert.deepEqual(h.on(h.view, from).map((o) => o.op), ["clearRect"], "but no outline is drawn on a frame of another shape");
  assert.equal(h.view.dataset.overlay, "none"); assert.equal(h.view.attributes["aria-label"], "Live camera preview");
  // Within half a percent the shapes match (rounding of the snapshot size).
  h.video.videoHeight = 702; h.camera.capture();
  assert.equal(h.view.dataset.overlay, "outline");
});

// The paused video stays visible behind the frozen still, so the still must
// letterbox like it: a solved reading on a reply adopted after the stream
// changed shape (a rotation), before a heartbeat or tick starts the settings
// over, does not freeze on that frame of the old shape.
test("a solved reading on a frame of another shape than the video does not freeze", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.hold();
  assert.ok(await h.until(() => h.held >= 1, 1000), "a verification is in flight");
  h.solveJobs[0].resolve(unique()); await flush();
  h.video.videoHeight = 525;
  const raw = h.raw();
  h.release(); await flush();
  assert.notEqual(h.raw(), raw, "the reply for a square frame was adopted");
  assert.equal(h.view.dataset.recognised, "4", "its solved reading verifies on it");
  assert.equal(h.camera.view, "live", "but the view does not freeze on it");
  assert.equal(h.view.dataset.overlay, "none");
  await h.advance(1000);
  assert.equal(h.camera.view, "live", "the settings start over with frames of the new shape");
  assert.equal(h.view.dataset.recognised, "0");
});

test("a solved reading on a frame older than half a second freezes on the next fresh frame", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.hold(); await h.advance(700);
  h.solveJobs[0].resolve(unique()); await flush(); await h.advance(300);
  assert.equal(h.camera.view, "live", "no freeze on a frame a second old");
  assert.equal(h.view.dataset.solution, "0", "and no solution over the live video");
  assert.equal(h.help, WAITING);
  assert.deepEqual(h.on(h.view).filter((o) => o.op === "fillText"), []);
  const old = h.raw();
  h.release(); // That old reply, then one for the latest frame.
  assert.ok(await h.until(() => h.frozen(), 300));
  assert.notEqual(h.raw(), old, "frozen on the fresh frame");
  assert.equal(h.on(h.view).filter((o) => o.op === "drawImage").at(-1).source, h.raw());
  assert.match(h.help, FROZEN);
});

test("with every verified frame older than half a second the freeze comes three seconds after the solution", async (t) => {
  const h = simulation(t, { replyMs: 600 });
  assert.ok(await h.until(() => h.help === WAITING, 15000));
  const since = h.now;
  assert.ok(await h.until(() => h.frozen(), 4000));
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3200, `froze ${waited} ms after the solution was first rendered`);
  assert.equal(h.view.dataset.solution, "12");
});

// Targeted retries need a clearer view of the uncertain cell: the n-th
// detection reports it ever sharper. A retry reads the same value.
const sharper = (n) => ({ assessable: true, score: 150, contrast: 90, cellPixels: 110, reason: null,
  cells: [{ cell: 1, score: 10 * 2 ** n, contrast: 90 }] });
const retryResult = (found, cells) => {
  const puzzle = structuredClone(found.puzzle);
  return { puzzle, targetCells: cells, entries: cells.map((cell) => ({ cell, kind: "value", text: String(puzzle.cells[cell]), evidence: `retry-${cell}-${Math.random()}` })),
    ocrStats: { calls: 1 }, rectified: null };
};

test("a solved reading with a retryable uncertain clue freezes after its retries or three seconds, not before", async (t) => {
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const since = h.now;
  assert.equal(h.view.dataset.uncertain, "1"); assert.equal(h.view.dataset.solution, "0");
  assert.ok(await h.until(() => h.frozen(), 4000));
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3200, `no clearer frame came: froze after ${waited} ms`);
  assert.equal(h.counts.retries, 0);
  assert.equal(h.view.dataset.solution, "12"); assert.equal(h.view.dataset.uncertain, "1", "the yellow clue stays flagged in the picture");
});

test("the retries of an uncertain clue run before the freeze", async (t) => {
  const retried = [];
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })), quality: sharper,
    readCells: (found, cells, at) => { retried.push(at); return Promise.resolve(retryResult(found, cells)); } });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const since = h.now;
  assert.ok(await h.until(() => h.frozen(), 4000));
  assert.ok(retried.length >= 1, "a clearer frame was retried");
  assert.ok(retried.every((at) => at < h.now), `the retries at ${retried.map((at) => at - since)} ms came before the freeze at ${h.now - since} ms`);
  assert.ok(retried.length === 2 || h.now - since >= 2800, "it froze once both retries were spent or the wait was over");
  assert.equal(h.view.dataset.solution, "12");
});

test("a merged retry keeps the freeze's three seconds running", async (t) => {
  // One clearer view of cell 1 (the third detection), then none: one retry
  // lands early and leaves one more, which never comes.
  const once = (n) => sharper(Math.min(n, 3));
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })), quality: once,
    readCells: (found, cells) => Promise.resolve(retryResult(found, cells)) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const since = h.now;
  assert.ok(await h.until(() => h.frozen(), 4000));
  assert.equal(h.counts.retries, 1, "one retry was read and merged");
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3300, `froze ${waited} ms after the reading was first shown solved, not three seconds after the merge`);
});

test("a yellow clue that cannot be retried does not hold the freeze", async (t) => {
  // Flagged but not a marked printed mark: no automatic retry would read it.
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.frozen(), 5000));
  assert.equal(h.view.dataset.uncertain, "1");
  assert.equal(h.counts.retries, 0);
  assert.ok(!h.diagnostics.snapshot().events.some((e) => e.reason === "clearer-frame-needed"), "no retry was waited for");
});

test("the canvas takes the adopted frame's size, so the outline's coordinates are the video's", async (t) => {
  // A canvas element starts at 300 x 150; the frames are 700 x 700.
  const h = simulation(t, { autoSolve: false, viewSize: [300, 150] });
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline"));
  assert.deepEqual([h.view.width, h.view.height], [700, 700]);
});

// Each assignment of a canvas's size reallocates and clears its bitmap, about
// 7 MB for a 1600 x 1200 frame: the live paints, ten a second, keep the size
// they have.
test("the canvas size is assigned only when the adopted frame's differs", async (t) => {
  const h = simulation(t, { autoSolve: false, viewSize: [300, 150] });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  assert.equal(h.sizeWrites, 2, "once to the frames' 700 x 700");
  const paints = h.renders.filter((r) => r.painted).length;
  h.jitter(1); await h.advance(2000);
  assert.ok(h.renders.filter((r) => r.painted).length >= paints + 4, "the outline was repainted");
  assert.equal(h.sizeWrites, 2, "at the size the canvas already had");
});

// After a rotation or a change of stream resolution the settings start over
// and nothing is drawn until a grid verifies on frames of the new shape; the
// cleared canvas takes their size with the first one adopted.
test("a change of stream resolution gives the cleared canvas the new frames' size at once", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline"));
  h.video.videoHeight = 525; // The stream turns to 4:3.
  assert.ok(await h.until(() => h.raw()?.height === 525, 1000), "a frame of the new shape is adopted");
  assert.equal(h.view.dataset.overlay, "none");
  assert.deepEqual([h.view.width, h.view.height], [700, 525]);
});

// data-delayed and the label describe the evidence on screen. A stalled feed
// shows none, so a lagging reply adopted meanwhile, whose proofs still match,
// marks nothing as catching up.
test("a lagging reply adopted while nothing is shown does not mark the view as catching up", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.hold(); await h.advance(300);
  assert.ok(h.held >= 1, "a verification is in flight");
  h.stall();
  assert.ok(await h.until(() => h.view.dataset.overlay === "none", 1500), "the stalled feed hides the outline");
  assert.equal(h.view.dataset.delayed, "0");
  const raw = h.raw();
  h.release(); await flush();
  assert.notEqual(h.raw(), raw, "the reply, its frame 0.6 s old, was adopted");
  assert.equal(h.view.dataset.overlay, "none", "nothing is shown on a stalled feed");
  assert.equal(h.view.dataset.delayed, "0", "so nothing is catching up");
});

test("sub-pixel jitter of the proofs does not repaint the outline; a pixel does", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.jitter(.2); await h.advance(300);
  const paints = h.renders.filter((r) => r.painted).length;
  await h.advance(2000);
  assert.equal(h.renders.filter((r) => r.painted).length, paints, "0.2 px either way rounds to the same half pixel");
  h.jitter(1); await h.advance(2000);
  assert.ok(h.renders.filter((r) => r.painted).length >= paints + 4, "a pixel either way repaints with each verification");
});

test("a video without dimensions gets no outline", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline" && h.view.dataset.recognised === "4"));
  h.video.videoHeight = 0; await h.advance(100);
  assert.equal(h.view.dataset.overlay, "none", "no shape to align the outline with");
});

test("the freeze's three seconds run from the first render of the solved reading, across a blink", async (t) => {
  const h = simulation(t, { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const since = h.now;
  await h.advance(1000);
  h.rejectVerify(true);
  assert.ok(await h.until(() => h.view.dataset.uncertain === "0", 1000), "the grid stops verifying: the reading is hidden");
  await h.advance(300);
  h.rejectVerify(false);
  assert.ok(await h.until(() => h.view.dataset.recognised === "3" && h.view.dataset.uncertain === "1", 1000), "and verifies again, the same reading");
  assert.equal(h.camera.view, "live");
  assert.ok(await h.until(() => h.frozen(), 4000));
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3300, `froze ${waited} ms after the reading was first shown solved, not three seconds after the blink`);
  assert.equal(h.counts.reads, 1, "one reading throughout");
});

test("adoptedFrame is the adopted snapshot itself, or null", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.equal(h.raw(), null);
  await h.advance(100);
  const first = h.raw();
  assert.ok(first, "the first tick's empty verification adopts its snapshot");
  assert.equal(h.created.find((c) => c.canvas === first)?.at, 100, "made by that tick");
  assert.equal(h.raw(), first, "the same object, not a copy");
  assert.ok(await h.until(() => h.raw() !== first, 500), "the next adopted reply replaces it");
  assert.equal(first.width, 0, "a replaced snapshot is released");
});
