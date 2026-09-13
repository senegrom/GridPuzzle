// Regressions for the 2026-09-13 webapp review: camera review screen survival,
// preview blocker messages, guide validation, capture-store edge cases, the
// solver worker's runtime handling, and small model/persistence guards.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { makePuzzle, checkShape } from "../model.js";
import { prepareEdit } from "../edit-history.js";
import { sniffDimensions } from "../image-dimensions.js";
import { previewBlocker, previewAllowed, drawLiveOverlay } from "../live-overlay.js";
import { createLiveCamera } from "../live-camera.js";
import { captureTransaction, setupCaptureGallery } from "../capture-store.js";
import { createTaskController } from "../task-controller.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

// --- photo-flow: captured still, track listeners, Escape -----------------
async function cameraHarness(t, { capture = null, play = async () => {} } = {}) {
  const { setupPhotoFlow } = await import("../photo-flow.js");
  const nodes = new Map(), statuses = [], listeners = {}, tracks = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "", style: {}, focus() { this.focused = (this.focused || 0) + 1; }, getContext: () => ({ clearRect() {} }) });
    return nodes.get(id);
  };
  for (const key of ["navigator", "document"]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  globalThis.document = { hidden: false, body: { classList: { add() {}, remove() {} } }, addEventListener(type, fn) { listeners[type] = fn; } };
  const track = { stopped: 0, events: {}, stop() { this.stopped++; }, addEventListener(type, fn) { this.events[type] = fn; } };
  tracks.push(track);
  const stream = { getTracks: () => tracks };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  $("video").play = play;
  let liveStarted = 0, liveStopped = 0;
  const flow = setupPhotoFlow({
    $, state: {}, scanner: {}, stopTask() {}, status: (...args) => statuses.push(args),
    savePicture: async () => true,
    liveFactory: () => ({ start() { liveStarted++; }, stop() { liveStopped++; }, capture: () => capture }),
  });
  return { $, flow, statuses, listeners, track, get liveStarted() { return liveStarted; }, get liveStopped() { return liveStopped; } };
}
const stillPicture = () => ({ photo: {}, annotated: {}, found: null, corners: null, createdAt: 1 });

test("hiding the page keeps a captured still on screen but releases a live camera", async (t) => {
  const h = await cameraHarness(t, { capture: stillPicture() });
  await h.$("camera").onclick();
  assert.equal(h.liveStarted, 1);
  await h.$("take-photo").onclick();
  await tick();
  assert.equal(h.$("camera-panel").hidden, false);
  assert.equal(h.track.stopped, 1, "the shutter releases the camera");
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, false, "a still holds no camera and must survive an app switch");
  assert.equal(h.$("use-live-capture").hidden, false);
  globalThis.document.hidden = false;
  await h.$("retake-photo").onclick();
  assert.equal(h.liveStarted, 2);
  globalThis.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.$("camera-panel").hidden, true, "a live camera is released when the page is hidden");
  assert.equal(h.track.stopped, 2);
});

test("track-ended listeners are attached before playback is awaited", async (t) => {
  const playback = deferred();
  const h = await cameraHarness(t, { play: () => playback.promise });
  const opening = h.$("camera").onclick();
  await tick(); await tick();
  assert.equal(typeof h.track.events.ended, "function", "a stream that dies during play() must still close the panel");
  h.track.events.ended();
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera disconnected/);
  playback.resolve();
  await opening;
  assert.equal(h.liveStarted, 0, "playback resolving after the stream ended must not start a preview");
});

test("Escape closes the full-screen camera and returns focus to its opener", async (t) => {
  const h = await cameraHarness(t);
  await h.$("camera").onclick();
  assert.equal(h.$("close-camera").focused, 1, "focus moves into the panel when it opens");
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera-panel").hidden, true);
  assert.match(h.statuses.at(-1)[0], /Camera closed/);
  assert.equal(h.$("camera").focused, 1);
  h.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(h.$("camera").focused, 1, "Escape with the panel closed is not ours");
});

// --- live-overlay: blocker reasons and balanced context state ------------
test("the preview blocker names the actual obstacle", () => {
  const puzzle = makePuzzle("latinsquare", 2);
  assert.match(previewBlocker({ puzzle, markedCells: [] }), /No printed clues/);
  puzzle.cells = [1, 1, null, null];
  assert.match(previewBlocker({ puzzle, markedCells: [0, 1] }), /Conflicting/);
  puzzle.cells = [1, null, null, null];
  assert.match(previewBlocker({ puzzle, markedCells: [0, 3] }), /Red \? cells/);
  assert.equal(previewBlocker({ puzzle, markedCells: [0] }), null);
  assert.equal(previewAllowed({ puzzle, markedCells: [0] }), true);
  const cage = makePuzzle("kenken", 2);
  cage.cages = [{ cells: [0, 1], target: 3, op: "+" }];
  assert.match(previewBlocker({ puzzle: cage, markedCells: [] }), /cage/i);
  assert.match(previewBlocker({}), /Check the readings/);
});

test("drawing an invalid guide puzzle leaves the canvas state balanced", () => {
  let saves = 0, restores = 0;
  const ctx = { save() { saves++; }, restore() { restores++; }, translate() {}, rotate() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const puzzle = makePuzzle("sudoku", 9, 6);
  assert.throws(() => drawLiveOverlay(ctx, 300, 300, [{ x: 0, y: 0 }, { x: 299, y: 0 }, { x: 299, y: 299 }, { x: 0, y: 299 }], { puzzle, markedCells: [] }));
  assert.equal(saves, restores, "a rejected puzzle shape must not leak a save()");
});

// --- live-camera: a detected grid that contradicts the chosen rules --------
test("a detected grid that does not fit the selected rules shows the reason instead of failing every frame", async (t) => {
  const timers = new Map(); let serial = 0, time = 0;
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "" }); return nodes.get(id); };
  const context = { drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(180) }) };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} }) };
  t.after(() => { globalThis.document = previous; });
  const detections = [], invalidations = [];
  const camera = createLiveCamera({ $, video: { videoWidth: 700, videoHeight: 700 }, canvas: { width: 700, height: 700, dataset: {}, getContext: () => context, setAttribute() {} },
    getSettings: () => ({ type: "sudoku", rows: 9, cols: 9, boxRows: 3, boxCols: 3, enabled: true }),
    detector: { detect() { const job = deferred(); detections.push(job); return job.promise; }, cancel() {} },
    reader: { read() { return new Promise(() => {}); }, cancel() {} },
    solver: { solve: async () => null, cancel() { invalidations.push("cancel"); }, prepare() {} }, now: () => time,
    setTimer(fn, ms) { timers.set(++serial, { fn, at: time + ms }); return serial; }, clearTimer(id) { timers.delete(id); } });
  const advance = async (ms) => { const end = time + ms; for (;;) { const next = [...timers.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); await tick(); } time = end; await tick(); };
  t.after(() => camera.stop());
  camera.start(); await advance(100);
  assert.equal(detections.length, 1);
  detections[0].resolve({ confidence: .99, rows: 9, cols: 6, sharpness: 200, corners: [{ x: 0, y: 0 }, { x: 639, y: 0 }, { x: 639, y: 639 }, { x: 0, y: 639 }] });
  await tick();
  assert.match($("camera-help").textContent, /Detected 9 × 6, which does not fit Sudoku/);
  await advance(300);
  assert.match($("camera-help").textContent, /does not fit Sudoku/, "the message survives further frames instead of a per-tick error");
});

// --- capture-store ---------------------------------------------------------
test("downloading the shown picture reuses its long-lived object URL", async (t) => {
  const created = [], revoked = [];
  const previousURL = globalThis.URL, previousDocument = globalThis.document;
  globalThis.URL = { createObjectURL: (blob) => { created.push(blob); return `blob:${created.length}`; }, revokeObjectURL: (url) => revoked.push(url) };
  globalThis.document = { createElement: () => ({ click() { this.clicked = true; } }) };
  t.after(() => { globalThis.URL = previousURL; globalThis.document = previousDocument; });
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: "", removeAttribute() {} }); return nodes.get(id); };
  const save = setupCaptureGallery($, { load: async () => null, save: async () => {}, remove: async () => {} });
  await save({ toBlob(done) { done(new Blob(["png"], { type: "image/png" })); } }, 42);
  assert.equal(created.length, 1);
  $("download-capture").onclick();
  assert.equal(created.length, 1, "the download must not mint a second, short-lived URL for the same blob");
  assert.deepEqual(revoked, []);
});

test("a version-1 database without its store is reset instead of failing forever", async () => {
  let deleted = 0;
  const db = { objectStoreNames: { contains: () => false }, close() {}, transaction() { throw Error("NotFoundError"); } };
  const open = { result: db };
  const indexedDB = { open() { queueMicrotask(() => open.onsuccess?.()); return open; }, deleteDatabase() { deleted++; } };
  await assert.rejects(captureTransaction("readwrite", (store) => store.get("latest"), { indexedDB }), /reset/);
  assert.equal(deleted, 1);
});

// --- task controller: Check and Hint are protected like Solve -------------
test("a running task disables Check and Hint until it finishes", () => {
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { setAttribute() {}, hidden: false, disabled: false }); return nodes.get(id); };
  const tasks = createTaskController({ $, scanner: { cancel() {} }, status() {}, onStop() {} });
  tasks.begin();
  assert.equal($("check-play").disabled, true);
  assert.equal($("hint-play").disabled, true);
  tasks.finish();
  assert.equal($("check-play").disabled, false);
  assert.equal($("hint-play").disabled, false);
});

// --- model / persistence guards --------------------------------------------
test("a Str8ts # outside the black list is reported as such, not as an out-of-range value", () => {
  const p = makePuzzle("str8ts", 3);
  p.cells[4] = "#";
  assert.throws(() => checkShape(p), /listed as black/);
});

test("an edit that shrinks the board drops indices that no longer exist", () => {
  const state = { puzzle: makePuzzle("latinsquare", 3), layout: null, uncertain: new Set([0, 8]), blackReadings: [], cageUncertain: new Set([8]),
    needsReview: true, notes: [], puzzleSource: null, play: [], hints: [], selected: [8, 1] };
  const draft = prepareEdit(state, (d) => { d.puzzle = makePuzzle("latinsquare", 2); });
  assert.deepEqual([...draft.uncertain], [0]);
  assert.deepEqual([...draft.cageUncertain], []);
  assert.deepEqual(draft.selected, [1]);
});

test("sniffing dimensions of a missing buffer returns null", () => {
  assert.equal(sniffDimensions(null), null);
  assert.equal(sniffDimensions(undefined), null);
});

// --- solver worker: runtime survival ---------------------------------------
function workerHarness({ pythonError = false, loadFails = false } = {}) {
  const source = fs.readFileSync(new URL("../solver-worker.js", import.meta.url), "utf8")
    .replace('await import("./vendor/pyodide/pyodide.mjs")', "await self.__pyodideModule()");
  const messages = [], globals = new Map();
  let loads = 0, deletes = 0;
  const runtime = {
    globals: { set: (k, v) => globals.set(k, v), delete: (k) => { deletes++; globals.delete(k); } },
    unpackArchive() {},
    runPython(code) {
      if (code.startsWith("from ")) return;
      if (pythonError) { const error = Error("ZeroDivisionError: division by zero"); error.name = "PythonError"; error.type = "ZeroDivisionError"; throw error; }
      return JSON.stringify({ status: "unique", solutions: [], complete: true });
    },
  };
  const self = { location: { href: "https://example.test/solver-worker.js" }, postMessage: (m) => messages.push(m),
    __pyodideModule: async () => ({ loadPyodide: async () => { loads++; return runtime; } }) };
  const context = vm.createContext({ self, URL, JSON, fetch: async () => ({ ok: !loadFails, status: loadFails ? 503 : 200, arrayBuffer: async () => new ArrayBuffer(0) }) });
  vm.runInContext(source, context);
  return { self, messages, get loads() { return loads; }, get deletes() { return deletes; }, globals,
    async solve(id) { await self.onmessage({ data: { id, puzzle: { type: "sudoku" } } }); return messages.findLast((m) => m.type === "result" && m.id === id).result; } };
}

test("a Python exception keeps the loaded interpreter and clears the payload", async () => {
  const h = workerHarness({ pythonError: true });
  assert.equal((await h.solve(1)).status, "error");
  assert.equal(h.loads, 1);
  assert.equal(h.deletes, 1, "the payload global is released even when Python throws");
  assert.equal((await h.solve(2)).status, "error");
  assert.equal(h.loads, 1, "the runtime is not reloaded after a Python exception");
});

test("a runtime that failed to load is retried on the next request", async () => {
  const h = workerHarness({ loadFails: true });
  assert.match((await h.solve(1)).message, /Solver download failed/);
  assert.equal(h.loads, 1);
  assert.match((await h.solve(2)).message, /Solver download failed/);
  assert.equal(h.loads, 2);
});

test("a solve during warm-up shares the warm-up's load instead of starting another", async () => {
  const h = workerHarness();
  const warm = h.self.onmessage({ data: { type: "warm" } });
  const solve = h.self.onmessage({ data: { id: 7, puzzle: { type: "sudoku" } } });
  await Promise.all([warm, solve]);
  assert.equal(h.loads, 1);
  assert.ok(h.messages.some((m) => m.type === "ready"));
  assert.equal(h.messages.findLast((m) => m.type === "result").result.status, "unique");
});
