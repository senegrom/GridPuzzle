// The live view: the video is the display, and over it the camera's canvas is
// transparent with only the outline of the latest verified proof; a solved
// reading freezes on its own verified frame once that frame is fresh and,
// with the setting "Wait up to 3 s for clearer clues before freezing" on, no
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
// A phone's portrait frame (3:4) whose grid reaches below y = 600, where a
// reading drawn against the frame's width and height swapped is rejected.
const PORTRAIT = { frame: [600, 800], grid: [80, 300] };
const SOLUTION = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
const unique = () => ({ status: "unique", complete: true, solutions: [{ cells: [...SOLUTION] }] });
const FROZEN = /^Solution preview — frozen\./, WAITING = "Solution found — hold the grid steady for a moment…";
// A solution digit (the bar's own "Solution" label is blue too).
const blueDigit = (o) => o.op === "fillText" && o.style === SCAN_COLOURS.solution && /^\d+$/.test(o.text);
// The digits drawn in one colour, in drawing order.
const digits = (ops, colour) => ops.filter((o) => o.op === "fillText" && o.style === colour && /^\d+$/.test(o.text)).map((o) => o.text);
// The operations that draw an outline.
const PATH = new Set(["beginPath", "moveTo", "lineTo", "closePath", "stroke"]);
function near(points, expected, tolerance, message) {
  assert.equal(points.length, expected.length, `${message}: ${points.length} points`);
  points.forEach((p, i) => assert.ok(Math.hypot(p.x - expected[i].x, p.y - expected[i].y) <= tolerance,
    `${message}: point ${i} at ${JSON.stringify(p)}, expected ${JSON.stringify(expected[i])}`));
}

// A printed 4x4 grid with a different glyph in every cell, its top-left grid
// corner at (x, y) of a W x H frame (as in live-relock.test.js).
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
// The top row read; `uncertain` and `marked` as the reader flags them.
function reading({ uncertain = [], marked = [] } = {}) {
  const puzzle = makePuzzle("latinsquare", 4, 4); puzzle.cells = [1, 2, 3, 4, ...Array(12).fill(null)];
  return { puzzle, cellUncertain: [...uncertain], markedCells: [...marked], notes: [] };
}

// The production camera, tracker and tracking core on a fake clock, with the
// grid's top-left corner at `grid` of a `frame` (W x H) the video delivers.
// The fake tracking worker runs the real core and answers after `replyMs`;
// while held (`hold()`), it keeps its operation until `release()`; with
// `rejectVerify(true)` the printed content matches no anchor any more;
// `jitter(px)` moves every proof's corners by that much, alternately up and
// down, and `warp(fn)` maps them with fn(corners, n) for the n-th reply.
// `solve` is "unique", "deferred" (h.solveJobs) or a function; `read`
// replaces the 500-ms reader; `readCells` adds the reader's targeted retry;
// `quality(n)` is the n-th detection's quality report. `freezeWait` is the
// setting "Wait up to 3 s for clearer clues before freezing" (unset: off, the
// default), which `h.settings` changes while the camera runs. Every canvas
// records drawImage, clearRect, fillRect, fillText (with the fill colour) and
// the outline's path and stroke (colour and width), in one list of
// operations; the legend's data-count writes are counted.
function simulation(t, { autoSolve = true, freezeWait, solve = "unique", read = null, readCells = null, quality = null, replyMs = 20,
  frame: [W, H] = [SIZE, SIZE], grid: [x, y] = [120, 110], viewSize = [W, H] } = {}) {
  let time = 0, serial = 0, frozenTime = null, hold = false, detections = 0, rejectAll = false, jitter = 0, warp = null, replies = 0, countWrites = 0;
  const timers = new Map(), nodes = new Map(), ops = [], created = [], held = [], solveJobs = [], renders = [];
  const counts = { reads: 0, retries: 0, solves: 0 };
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  function canvas() {
    const c = { width: W, height: H, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const record = (op, extra = {}) => ops.push({ target: c, op, at: time, ...extra });
    const ctx = { canvas: c, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
      drawImage(source) { record("drawImage", { source }); }, clearRect() { record("clearRect"); },
      fillText(text) { record("fillText", { text: String(text), style: this.fillStyle }); },
      fillRect(left, top, width, height) { record("fillRect", { x: left, y: top, w: width, h: height, style: this.fillStyle }); },
      beginPath() { record("beginPath"); }, moveTo(px, py) { record("moveTo", { x: px, y: py }); },
      lineTo(px, py) { record("lineTo", { x: px, y: py }); }, closePath() { record("closePath"); },
      stroke() { record("stroke", { style: this.strokeStyle, width: this.lineWidth }); },
      save() {}, restore() {}, translate() {}, rotate() {},
      getImageData: (_x, _y, width, height) => width === W && height === H ? scene(W, H, x, y)
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
  // The help line is a polite live region: every write is announced, so each
  // is logged with the camera's view at the time.
  let help = "", viewNow = () => null;
  const writes = [];
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push({ text: value, at: time, view: viewNow() }); } });
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
            else if (message.op === "verify" && (jitter || warp)) {
              const n = ++replies, d = n % 2 ? jitter : -jitter;
              for (const proof of Object.values(result.proofs)) if (proof)
                proof.corners = warp ? warp(proof.corners, n) : proof.corners.map((p) => ({ x: p.x + d, y: p.y + d }));
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
  const scale = Math.min(1, 640 / Math.max(W, H)), sw = Math.round(W * scale), sh = Math.round(H * scale);
  const small = (p) => ({ x: p.x * (sw - 1) / (W - 1), y: p.y * (sh - 1) / (H - 1) });
  const diagnostics = createScanDiagnostics({ now: () => time }), rendering = diagnostics.rendering;
  diagnostics.rendering = (value) => { renders.push({ ...value, at: time }); rendering(value); };
  diagnostics.begin("live", { type: "latinsquare", rows: 4, cols: 4, autoSolve });
  const video = { videoWidth: W, videoHeight: H, get currentTime() { return (frozenTime ?? time) / 1000; } };
  const reader = { read(...args) {
    counts.reads++;
    if (read) return read(args[6].onPreview, setTimer);
    return new Promise((resolve) => setTimer(() => resolve(reading()), 500));
  }, cancel() {} };
  // Scanner.readCells(image, corners, found, cells, progress, options).
  if (readCells) reader.readCells = (...args) => { counts.retries++; return readCells(args[2], args[3], time); };
  // Without `freezeWait` the settings carry no such key: off is the default.
  const settings = { type: "latinsquare", rows: 4, cols: 4, boxRows: 2, boxCols: 2, enabled: true, autoSolve,
    ...(freezeWait === undefined ? {} : { freezeWait }) };
  const camera = createLiveCamera({ tracker, $, canvas: view, diagnostics, video,
    getSettings: () => ({ ...settings }),
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
  viewNow = () => camera.view;
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
  // The outline last stroked on a canvas: its points, whether it was closed,
  // the last stroke's colour and width, and every stroke of that path.
  function outline(target, from = 0) {
    const mine = ops.slice(from).filter((o) => o.target === target), end = mine.findLastIndex((o) => o.op === "stroke");
    if (end < 0) return null;
    const path = mine.slice(mine.slice(0, end).findLastIndex((o) => o.op === "beginPath") + 1, end + 1);
    return { points: path.filter((o) => o.op === "moveTo" || o.op === "lineTo").map((o) => ({ x: o.x, y: o.y })),
      closed: path.some((o) => o.op === "closePath"), style: mine[end].style, width: mine[end].width,
      strokes: path.filter((o) => o.op === "stroke").map((o) => ({ style: o.style, width: o.width })) };
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, view, video, $, counts, ops, created, renders, solveJobs, diagnostics, advance, until, writes, outline, settings,
    W, H, corners: cornersAt(x, y),
    get now() { return time; }, get help() { return help; },
    raw: () => camera.adoptedFrame(), frozen: () => camera.view === "frozen",
    on: (target, from = 0) => ops.slice(from).filter((o) => o.target === target),
    legend: () => Object.fromEntries(["recognised", "uncertain", "unknown", "solution"].map((key) => [key, $(`legend-${key}`).getAttribute("data-count")])),
    stall() { frozenTime = time; }, unstall() { frozenTime = null; },
    hold() { hold = true; }, release() { hold = false; for (const reply of held.splice(0)) reply(); },
    rejectVerify(value) { rejectAll = value; }, jitter(px) { jitter = px; }, warp(fn) { warp = fn; },
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
  live.forEach((o, i) => { if (o.op === "stroke") assert.equal(live.slice(0, i).findLast((p) => !PATH.has(p.op)).op, "clearRect", "an outline only on a cleared canvas"); });
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
  assert.deepEqual(h.on(h.view, from).filter((o) => o.op !== "clearRect" && !PATH.has(o.op)), [], "nothing is drawn on the display canvas");
  assert.equal(h.view.attributes["aria-label"], preview);
  shot.found.puzzle.cells[5] = 9;
  assert.equal(h.camera.capture().found.puzzle.cells[5], null, "each capture owns its copy of the reading");
});

// The freeze's wait ends at the shutter: no retry can run after it, and the
// help line has said that a solution was found. The shutter freezes the
// solved reading on its own verified frame and saves that frozen picture,
// with the solution, as when the view freezes by itself.
test("the shutter freezes a solved reading that waits for a retry and saves its solution", async (t) => {
  // With the setting on, an uncertain marked clue with retries left holds the
  // freeze (see below).
  const h = simulation(t, { freezeWait: true, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  assert.equal(h.camera.view, "live");
  const raw = h.raw(), from = h.ops.length, shot = h.camera.capture();
  assert.equal(h.camera.view, "frozen"); assert.equal(shot.frozen, true);
  assert.equal(h.raw(), raw, "frozen on the frame the solution was verified on");
  const frozen = h.on(h.view, from), text = frozen.filter((o) => o.op === "fillText");
  assert.equal(frozen[0].op, "drawImage"); assert.equal(frozen[0].source, raw);
  assert.equal(text.filter(blueDigit).length, 12, "the picture carries the solution");
  assert.ok(text.some((o) => o.style === SCAN_COLOURS.uncertain), "and the uncertain clue in yellow");
  assert.deepEqual(h.on(shot.annotated).map((o) => o.source), [h.view], "the saved picture is the frozen one");
  assert.equal(shot.found.puzzle.cells[1], 2); assert.equal(h.view.dataset.solution, "12");
  assert.match(h.help, FROZEN);
});

// A slow tracker keeps the freeze waiting for a fresher frame (see below); the
// shutter freezes on the solution's own verified frame all the same, rather
// than keep a frame without the reading the legend counts.
test("the shutter freezes a solved reading on a verified frame older than half a second", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.hold(); await h.advance(700);
  h.solveJobs[0].resolve(unique()); await flush(); await h.advance(300);
  assert.equal(h.camera.view, "live", "the freeze waits for a fresh frame");
  assert.equal(h.help, WAITING);
  const raw = h.raw(), shot = h.camera.capture();
  assert.equal(shot.frozen, true); assert.equal(h.camera.view, "frozen");
  assert.equal(h.raw(), raw, "on the frame the solution was verified on, a second old");
  assert.deepEqual(shot.found.puzzle.cells, reading().puzzle.cells);
  assert.equal(h.on(h.view).filter(blueDigit).length, 12);
  assert.equal(h.view.dataset.delayed, "0", "a frozen picture is never marked as catching up");
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

// The page draws a captured picture onto the canvas after the camera stopped;
// a capture of the stopped camera must not clear or relabel it.
test("a capture after the camera stopped leaves the display canvas alone", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4" && h.view.dataset.overlay === "outline"));
  h.camera.stop();
  const from = h.ops.length, label = h.view.attributes["aria-label"];
  assert.equal(h.camera.capture().found, null);
  assert.deepEqual(h.on(h.view, from), [], "nothing is cleared or drawn");
  assert.equal(h.view.attributes["aria-label"], label);
  assert.equal(h.view.dataset.overlay, "outline"); assert.equal(h.view.dataset.recognised, "4");
});

// With no frame presented the video can show nothing useful: iOS paints an
// interrupted camera (a call, another app) black. A live capture then keeps
// the last frame the camera scanned, without its reading, for the editor.
test("with no frame presented for half a second a live capture keeps the last adopted frame, without its reading", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  h.stall(); await h.advance(700);
  assert.match(h.help, /Waiting for a new camera frame/);
  const raw = h.raw();
  assert.ok(raw, "the last adopted frame is kept while no frame comes");
  const shot = h.camera.capture();
  assert.equal(shot.found, null); assert.equal(shot.frozen, false);
  assert.deepEqual(h.on(shot.photo).filter((o) => o.op === "drawImage").map((o) => o.source), [raw], "a copy of it, not the video");
  assert.notEqual(shot.photo, raw);
  const picture = h.on(shot.annotated);
  assert.equal(picture[0].source, shot.photo);
  assert.equal(picture.some((o) => o.op === "stroke"), false, "without the outline");
  h.unstall(); await h.advance(300);
  assert.deepEqual(h.on(h.camera.capture().photo).filter((o) => o.op === "drawImage").map((o) => o.source),
    [h.raw()], "frames again: a fresh verified frame");
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
  // Nor does the shutter: it keeps the fresh verified reading as a live
  // capture, which never carries a solution.
  const shot = h.camera.capture();
  assert.equal(shot.frozen, false); assert.equal(h.camera.view, "live"); assert.ok(shot.found);
  assert.deepEqual(h.on(shot.annotated).filter(blueDigit), [], "no solution in a live capture");
  await h.advance(1000);
  assert.equal(h.camera.view, "live", "the settings start over with frames of the new shape");
  assert.equal(h.view.dataset.recognised, "0");
});

// The wait for a fresh frame is about which picture freezes, not about the
// clues: it holds whatever the setting for clearer clues says.
for (const [freezeWait, setting] of [[undefined, "the wait for clearer clues off, the default"], [true, "the wait for clearer clues on"]]) {
  test(`a solved reading on a frame older than half a second freezes on the next fresh frame (${setting})`, async (t) => {
    const h = simulation(t, { solve: "deferred", freezeWait });
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

  test(`with every verified frame older than half a second the freeze comes three seconds after the solution (${setting})`, async (t) => {
    const h = simulation(t, { replyMs: 600, freezeWait });
    assert.ok(await h.until(() => h.help === WAITING, 15000));
    const since = h.now;
    assert.ok(await h.until(() => h.frozen(), 4000));
    const waited = h.now - since;
    assert.ok(waited >= 2800 && waited <= 3200, `froze ${waited} ms after the solution was first rendered`);
    assert.equal(h.view.dataset.solution, "12");
  });
}

// Targeted retries need a clearer view of the uncertain cell: the n-th
// detection reports it ever sharper. A retry reads the same value.
const sharper = (n) => ({ assessable: true, score: 150, contrast: 90, cellPixels: 110, reason: null,
  cells: [{ cell: 1, score: 10 * 2 ** n, contrast: 90 }] });
const retryResult = (found, cells) => {
  const puzzle = structuredClone(found.puzzle);
  return { puzzle, targetCells: cells, entries: cells.map((cell) => ({ cell, kind: "value", text: String(puzzle.cells[cell]), evidence: `retry-${cell}-${Math.random()}` })),
    ocrStats: { calls: 1 }, rectified: null };
};

test("with the wait on, a solved reading with a retryable uncertain clue freezes after its retries or three seconds, not before", async (t) => {
  const h = simulation(t, { freezeWait: true, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  // The wait's text holds from the reading's publication; the canvas shows
  // the reading with the next render.
  assert.ok(await h.until(() => h.help === WAITING && h.view.dataset.uncertain === "1", 5000));
  const since = h.now;
  assert.equal(h.view.dataset.solution, "0");
  assert.ok(await h.until(() => h.frozen(), 4000));
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3200, `no clearer frame came: froze after ${waited} ms`);
  assert.equal(h.counts.retries, 0);
  assert.equal(h.view.dataset.solution, "12"); assert.equal(h.view.dataset.uncertain, "1", "the yellow clue stays flagged in the picture");
});

test("with the wait on, the retries of an uncertain clue run before the freeze", async (t) => {
  const retried = [];
  const h = simulation(t, { freezeWait: true, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })), quality: sharper,
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
  const h = simulation(t, { freezeWait: true, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })), quality: once,
    readCells: (found, cells) => Promise.resolve(retryResult(found, cells)) });
  assert.ok(await h.until(() => h.help === WAITING, 5000));
  const since = h.now;
  assert.ok(await h.until(() => h.frozen(), 4000));
  assert.equal(h.counts.retries, 1, "one retry was read and merged");
  const waited = h.now - since;
  assert.ok(waited >= 2800 && waited <= 3300, `froze ${waited} ms after the reading was first shown solved, not three seconds after the merge`);
});

// The live video shows no clue digits, so the help line names the unclear
// clues by the legend entry that counts them.
test("waiting for a clearer frame of an uncertain clue, the help line points to its legend entry", async (t) => {
  const h = simulation(t, { autoSolve: false, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => /^Waiting for a clearer frame/.test(h.help), 5000));
  assert.match(h.help, /^Waiting for a clearer frame of the unclear clues \(uncertain \? in the legend\)\./);
  assert.equal(h.legend().uncertain, "1");
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

// The setting "Wait up to 3 s for clearer clues before freezing" is off by
// default: a solved reading then freezes on the first fresh verified frame,
// as with PR 1, also with a yellow clue a retry could still read. The help
// line keeps what it said until the frozen help replaces it: neither the
// wait's text nor the session's text for a solution on screen is written.
const RETRYABLE = { read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })), readCells: () => new Promise(() => {}) };
test("by default a solved reading with a retryable yellow clue freezes on the next fresh frame, without the wait's text", async (t) => {
  const h = simulation(t, { solve: "deferred", ...RETRYABLE });
  assert.ok(await h.until(() => h.solveJobs.length === 1 && h.view.dataset.uncertain === "1"), "the reading, with its yellow clue, is being solved");
  const line = h.help, from = h.writes.length;
  assert.match(line, /^Finding a solution/);
  h.solveJobs[0].resolve(unique()); await flush();
  const solved = h.now;
  assert.equal(h.help, line, "the solved reading keeps the line as it stands");
  assert.ok(await h.until(() => h.frozen(), 200));
  assert.ok(h.now - solved <= 100, `frozen ${h.now - solved} ms after the solution, at the next render`);
  assert.deepEqual(h.writes.slice(from).filter((w) => w.view === "live"), [], "nothing is written to the help line before the freeze");
  assert.match(h.help, FROZEN);
  assert.equal(h.view.dataset.uncertain, "1", "the yellow clue stays flagged in the frozen picture");
  assert.equal(h.view.dataset.solution, "12");
  assert.equal(h.counts.retries, 0);
});

// With the setting on, the yellow clue's retries hold the freeze (the tests
// above); a reading with nothing left to retry still freezes at once, and so
// says nothing about a wait.
test("with the wait on, a solved reading with nothing to retry freezes on the next fresh frame, without the wait's text", async (t) => {
  const h = simulation(t, { freezeWait: true, solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  const from = h.writes.length, solved = h.now;
  h.solveJobs[0].resolve(unique()); await flush();
  assert.ok(await h.until(() => h.frozen(), 200));
  assert.ok(h.now - solved <= 100, `frozen ${h.now - solved} ms after the solution`);
  assert.deepEqual(h.writes.slice(from).filter((w) => w.view === "live"), []);
});

// The setting applies to the reading on screen at its next freeze decision
// and resets nothing: it is not part of the reading's identity, as automatic
// solving is not. The diagnostics' settings are configured only when a
// setting that is part of it changes.
function countConfigures(h) {
  const counter = { calls: 0 }, configure = h.diagnostics.configure;
  h.diagnostics.configure = (value) => { counter.calls++; configure(value); };
  return counter;
}
test("turning the wait off while a solved reading waits freezes it at the next render, on the same reading", async (t) => {
  const h = simulation(t, { freezeWait: true, ...RETRYABLE });
  assert.ok(await h.until(() => h.help === WAITING && h.view.dataset.uncertain === "1", 5000));
  await h.advance(1000);
  assert.equal(h.camera.view, "live", "a second into the wait");
  const configures = countConfigures(h);
  h.settings.freezeWait = false;
  const toggled = h.now;
  assert.ok(await h.until(() => h.frozen(), 200));
  assert.ok(h.now - toggled <= 100, `frozen ${h.now - toggled} ms after the change`);
  assert.equal(configures.calls, 0, "the settings did not start over");
  assert.equal(h.counts.reads, 1, "nor did the reading");
  assert.equal(h.view.dataset.uncertain, "1"); assert.equal(h.view.dataset.solution, "12");
});

test("turning the wait on while a solved reading waits for a fresh frame keeps it waiting for the retries", async (t) => {
  const h = simulation(t, { freezeWait: false, solve: "deferred", ...RETRYABLE });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.hold(); await h.advance(700); // The verified frame ages past half a second.
  h.solveJobs[0].resolve(unique()); await flush(); await h.advance(100);
  assert.equal(h.camera.view, "live", "the wait for a fresh frame holds whatever the setting");
  assert.equal(h.help, WAITING, "and asks the user to hold steady");
  const configures = countConfigures(h);
  h.settings.freezeWait = true;
  const toggled = h.now;
  h.release(); await h.advance(300);
  const age = h.now - h.created.find((c) => c.canvas === h.raw()).at;
  assert.ok(age <= 500, `a fresh frame verified (${age} ms old)`);
  assert.equal(h.camera.view, "live", "but the yellow clue's retries are now waited for");
  assert.ok(await h.until(() => h.frozen(), 3000));
  assert.ok(h.now - toggled >= 2800, `frozen ${h.now - toggled} ms after the change: three seconds from the first solved render`);
  assert.equal(configures.calls, 0, "the settings did not start over");
  assert.equal(h.counts.reads, 1); assert.equal(h.counts.solves, 1, "one reading, solved once");
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
  const h = simulation(t, { freezeWait: true, read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
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

// No solution is shown live, so the session's text for one on screen
// ("Solution preview — check the clues and rules. Tap the shutter…") must not
// reach the help line, a polite live region, while the reading waits to
// freeze: neither as the solve finishes, until the next heartbeat, nor when
// the reading returns after a blink. The wait's text holds from the moment
// the reading is published solved.
test("while a solved reading waits to freeze the help line keeps the wait's text, also across a blink", async (t) => {
  const h = simulation(t, { freezeWait: true, solve: "deferred", read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  const from = h.writes.length;
  h.solveJobs[0].resolve(unique()); await flush();
  assert.equal(h.help, WAITING, "as soon as the solved reading is published");
  await h.advance(1000);
  h.rejectVerify(true);
  assert.ok(await h.until(() => h.view.dataset.uncertain === "0", 1000), "a blink hides the reading");
  await h.advance(300);
  h.rejectVerify(false);
  assert.ok(await h.until(() => h.frozen(), 4000));
  const live = h.writes.slice(from).filter((w) => w.view === "live").map((w) => w.text);
  assert.deepEqual(live, [WAITING, WAITING], "only the wait's text while live, written as the solve finished and as the reading returned, never again on a heartbeat");
  assert.match(h.help, FROZEN);
});

// Where the outline lands and how it is drawn. Phones deliver portrait frames
// (3:4 here), whose width and height are easy to swap unnoticed on a square.
test("on a portrait frame the live outline lies on the verified grid, closed, white, a 500th of the frame wide", async (t) => {
  const h = simulation(t, { autoSolve: false, ...PORTRAIT });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  assert.equal(h.view.dataset.overlay, "outline", "the outline is shown on a 3:4 frame");
  const line = h.outline(h.view);
  near(line.points, h.corners, 2, "the outline follows the grid's verified corners");
  assert.equal(line.closed, true, "all four sides");
  assert.equal(line.style, "#ffffff"); assert.equal(line.width, Math.max(2, h.W / 500));
  assert.deepEqual([h.view.width, h.view.height], [h.W, h.H], "in the frame's own coordinates");
});

// A phone's viewfinder shows the frame at a third of its size or less, so over
// live video the outline is sized in CSS pixels through the canvas's contain
// scale, 2.5 wide with a dark pixel either side; the frozen and saved
// pictures keep the frame's own scale.
test("over live video the outline is 2.5 CSS pixels wide with a dark halo; the frozen picture keeps the frame's scale", async (t) => {
  const h = simulation(t);
  Object.assign(h.view, { clientWidth: 350, clientHeight: 500 }); // A contain scale of min(350, 500) / 700 = 0.5.
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline"));
  const live = h.outline(h.view);
  assert.deepEqual(live.strokes, [{ style: "#101820b3", width: 9 }, { style: "#ffffff", width: 5 }]);
  near(live.points, h.corners, 2, "on the grid");
  assert.ok(await h.until(() => h.frozen()));
  assert.deepEqual(h.outline(h.view).strokes, [{ style: "#ffffff", width: 2 }], "frozen: white, two pixels or a 500th of the frame");
});

test("the frozen picture of a portrait frame carries the clues, the solution and the outline on the grid", async (t) => {
  const h = simulation(t, PORTRAIT);
  assert.ok(await h.until(() => h.frozen()));
  const ops = h.on(h.view), at = ops.findIndex((o) => o.op === "drawImage");
  const frozen = ops.slice(at);
  assert.deepEqual(digits(frozen, SCAN_COLOURS.recognised), ["1", "2", "3", "4"], "the clues");
  assert.equal(digits(frozen, SCAN_COLOURS.solution).length, 12, "the solution");
  near(h.outline(h.view, h.ops.indexOf(ops[at])).points, h.corners, 2, "the frozen outline");
});

test("a live capture of a portrait frame keeps its clues and outline on the verified frame", async (t) => {
  const h = simulation(t, { autoSolve: false, ...PORTRAIT });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  const shot = h.camera.capture();
  assert.ok(shot.found);
  assert.deepEqual(digits(h.on(shot.annotated), SCAN_COLOURS.recognised), ["1", "2", "3", "4"], "the clues on the saved picture");
  near(h.outline(shot.annotated).points, h.corners, 2, "its outline");
});

// The bar of the frozen and saved picture: PREVIEW and the legend on a dark
// backing across the bottom, so they read on white paper.
test("the frozen picture's bar lies on its dark backing across the bottom", async (t) => {
  const h = simulation(t, PORTRAIT);
  assert.ok(await h.until(() => h.frozen()));
  const backing = h.on(h.view).filter((o) => o.op === "fillRect" && o.style === "#101820e8");
  assert.equal(backing.length, 1, "one bar");
  const [bar] = backing;
  assert.deepEqual([bar.x, bar.w], [0, h.W]); assert.ok(Math.abs(bar.y + bar.h - h.H) < 1e-9, "at the bottom edge");
  const text = h.on(h.view).filter((o) => o.op === "fillText" && o.text === "PREVIEW");
  assert.equal(text.length, 1);
  assert.ok(h.ops.indexOf(bar) < h.ops.indexOf(text[0]), "under its text");
});

// The paint key holds the whole outline: a move along either axis, and a
// zoom about any corner, repaints it.
test("a vertical move of the verified grid repaints the outline where the grid is", async (t) => {
  const h = simulation(t, { autoSolve: false, ...PORTRAIT });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.warp((corners, n) => corners.map((p) => ({ x: p.x, y: p.y + (n % 2 ? 1.5 : -1.5) })));
  const paints = h.renders.filter((r) => r.painted).length;
  await h.advance(2000);
  assert.ok(h.renders.filter((r) => r.painted).length >= paints + 4, "each 3-px vertical step repaints");
  const line = h.outline(h.view);
  near(line.points, h.corners, 3.5, "near the grid");
  assert.ok(line.points.every((p, i) => Math.abs(Math.abs(p.y - h.corners[i].y) - 1.5) < 1), "at the moved height");
});

test("a zoom about the outline's first corner repaints it", async (t) => {
  const h = simulation(t, { autoSolve: false, ...PORTRAIT });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.warp((corners, n) => {
    const [o] = corners, k = n % 2 ? 1.01 : .99;
    return corners.map((p) => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k }));
  });
  const paints = h.renders.filter((r) => r.painted).length;
  await h.advance(2000);
  assert.ok(h.renders.filter((r) => r.painted).length >= paints + 4, "the far corners move 4 px with each verification");
});

test("before a reading the outline follows the candidate's current proof, not where it was detected", async (t) => {
  // The read never finishes: there is no preview, and the outline is the
  // verified guide's.
  const h = simulation(t, { autoSolve: false, read: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.view.dataset.overlay === "outline"));
  assert.equal(h.view.dataset.recognised, "0", "no reading yet");
  h.warp((corners) => corners.map((p) => ({ x: p.x + 6, y: p.y + 6 })));
  await h.advance(500);
  assert.equal(h.view.dataset.overlay, "outline");
  near(h.outline(h.view).points, h.corners.map((p) => ({ x: p.x + 6, y: p.y + 6 })), 2, "the outline moved with the proof");
});

test("the freeze's paint is reported to the paint timings", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.frozen()));
  const painted = h.renders.filter((r) => r.painted), clears = h.on(h.view).filter((o) => o.op === "clearRect").length;
  assert.equal(painted.length, clears + 1, "every live paint clears once, and the freeze's composition is reported too");
  assert.equal(typeof painted.at(-1).milliseconds, "number");
});

test("an aspect mismatch of 1 % draws nothing; 0.4 % is rounding", async (t) => {
  const h = simulation(t, { autoSolve: false, ...PORTRAIT });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  for (const [width, overlay] of [[606, "none"], [602, "outline"]]) {
    h.hold();
    assert.ok(await h.until(() => h.held >= 1, 1000), "a verification is in flight");
    // The stream's shape changes before a heartbeat or tick resets the
    // settings: the reply for the old shape is adopted and rendered.
    h.video.videoWidth = width;
    h.release(); await flush();
    assert.equal(h.view.dataset.recognised, "4", "its reading verifies");
    assert.equal(h.view.dataset.overlay, overlay, `video ${width} x ${h.H} against a ${h.W} x ${h.H} frame`);
    h.video.videoWidth = h.W;
    assert.ok(await h.until(() => h.view.dataset.recognised === "4" && h.view.dataset.overlay === "outline", 3000));
  }
});

// The exact boundaries: a frame exactly FRESH (500 ms) old is fresh, for the
// live capture and for the freeze, and the freeze's wait ends at exactly
// three seconds. Renders run on the 100-ms pulses (tick and heartbeat) and
// 20 ms later (the verification reply).
test("a live capture keeps its reading on a frame exactly half a second old, not one millisecond older", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.hold(); await h.advance(30); // A reply already on its way still lands.
  const raw = h.raw(), at = h.created.find((c) => c.canvas === raw).at;
  assert.ok(h.now - at < 500);
  await h.advance(at + 500 - h.now);
  assert.equal(h.raw(), raw, "no newer frame was adopted");
  assert.ok(h.camera.capture().found, "500 ms old: still fresh");
  await h.advance(1);
  assert.equal(h.camera.capture().found, null, "501 ms old: not");
});

test("a solved reading freezes on a verified frame exactly half a second old", async (t) => {
  const h = simulation(t, { solve: "deferred" });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  h.hold(); await h.advance(30);
  const raw = h.raw(), at = h.created.find((c) => c.canvas === raw).at;
  await h.advance(at + 450 - h.now);
  h.solveJobs[0].resolve(unique()); await flush();
  assert.equal(h.camera.view, "live", "not rendered yet");
  await h.advance(50); // The pulse at exactly half a second renders it first.
  assert.equal(h.now - at, 500);
  assert.equal(h.camera.view, "frozen", "a frame exactly half a second old is fresh");
  assert.equal(h.raw(), raw);
});

test("a solved reading held by a retryable clue freezes exactly three seconds after its first render", async (t) => {
  const h = simulation(t, { freezeWait: true, solve: "deferred", read: () => Promise.resolve(reading({ uncertain: [1], marked: [0, 1, 2, 3] })),
    readCells: () => new Promise(() => {}) });
  assert.ok(await h.until(() => h.solveJobs.length === 1));
  // Between two pulses and after the last reply: the next pulse renders the
  // solved reading first.
  await h.advance((150 - h.now % 100) % 100);
  h.solveJobs[0].resolve(unique()); await flush();
  await h.advance(50);
  assert.equal(h.view.dataset.uncertain, "1", "the solved reading is shown");
  await h.advance(2999);
  assert.equal(h.camera.view, "live", "not before three seconds");
  await h.advance(1);
  assert.equal(h.camera.view, "frozen", "at three seconds");
});

// data-delayed is the tier of the verified evidence the view shows: the
// outline, or the reading the legend counts, which stays shown when a frame
// of another shape leaves no outline to draw.
test("under an aspect mismatch data-delayed still reports the lagging tier of the reading", async (t) => {
  const h = simulation(t, { autoSolve: false });
  assert.ok(await h.until(() => h.view.dataset.recognised === "4"));
  await h.advance(500);
  h.hold(); await h.advance(700);
  assert.equal(h.view.dataset.delayed, "1");
  assert.ok(h.held >= 1);
  h.video.videoHeight = 525; // 4:3 before a heartbeat or tick resets the settings
  h.release(); await flush();
  assert.equal(h.view.dataset.recognised, "4", "the adopted reply's reading verifies");
  assert.equal(h.view.dataset.overlay, "none", "nothing is drawn on a frame of another shape");
  assert.equal(h.view.dataset.delayed, "1", "the reading's evidence is still on the delayed tier");
});

// The wait for a frame reported after Clear belongs to that camera session:
// a camera stopped and started again captures at once.
test("a camera stopped right after Clear and started again does not wait for a frame reported after Clear", async (t) => {
  const h = simulation(t);
  assert.ok(await h.until(() => h.frozen()));
  h.camera.resume();
  assert.throws(() => h.camera.capture(), /Wait for a camera frame/, "right after Clear it waits");
  h.camera.stop(); h.camera.start();
  const shot = h.camera.capture();
  assert.equal(shot.found, null, "a new session captures the frame on screen at once");
  assert.equal(shot.frozen, false);
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
