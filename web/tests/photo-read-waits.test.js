import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { setupPhotoFlow } from "../photo-flow.js";
import { restoreSession, saveSession } from "../session.js";
import { boxShape, fitPlay, isPlayableCell, makePuzzle, maxValue } from "../model.js";
import { rememberEdit } from "../edit-history.js";
import { createTaskController } from "../task-controller.js";

// A new photograph is shown on the fallback crop while its grid is found, and
// a Read through that crop highlights every cell. Read puzzle tapped while the
// detection runs therefore waits for it instead of stopping it (the owner's
// choice of 2026-10-21): the tap is answered with "Still finding the grid…",
// the detection goes on, and the Read starts when it ends, through the corners
// it found, exactly as a Read tapped then; through the fallback crop when it
// found no grid, failed, or the scanner gave its job up. Whatever stops the
// detection's task (Stop, a new photograph or capture, Rotate, a moved corner,
// another task) drops the waiting Read, and so does Hide photo; a second tap
// adds nothing. A Read tapped during the detection that Rotate or Find grid
// starts on the fallback crop waits for that one in turn. A photograph chosen
// from a file is opened as a task of its own first (below, with its decode
// held open): a Read tapped meanwhile waits for it and then for its grid, and
// nothing tapped meanwhile acts on the photograph still in the crop editor.
// The flow runs with the app's own task controller, so Stop shown and Solve,
// Check and Hint disabled are checked throughout.

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const aborted = () => new DOMException("Scan cancelled", "AbortError");
const sorted = (cells) => [...cells].sort((a, b) => a - b);
// A PNG header the import takes the size from; the decoder is a stub.
function png(width, height) {
  const bytes = new Uint8Array(45), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  view.setUint32(16, width); view.setUint32(20, height); bytes.set([73, 69, 78, 68], 37);
  return new Blob([bytes], { type: "image/png" });
}
// The fallback crop of a w x h photograph (geometry.js fallbackCorners), and
// the corners the detector finds on the 800 x 600 photographs below.
const fallback = (width, height) => [{ x: width * 0.08, y: height * 0.08 }, { x: width * 0.92, y: height * 0.08 },
  { x: width * 0.92, y: height * 0.92 }, { x: width * 0.08, y: height * 0.92 }];
const GRID = [{ x: 100, y: 80 }, { x: 700, y: 90 }, { x: 690, y: 520 }, { x: 110, y: 530 }];
// The corners found on such a photograph turned upright by Rotate (600 x 800),
// and an answer that a stopped detection gives too late to be taken.
const TURNED = [{ x: 80, y: 100 }, { x: 520, y: 110 }, { x: 510, y: 700 }, { x: 90, y: 690 }];
const STRAY = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }];
const found = (corners = GRID) => ({ rows: 4, cols: 4, confidence: 0.99, corners: corners.map((p) => ({ ...p })) });
const ALL = [...Array(16).keys()];
const UNCONFIRMED = /^The grid was not found automatically and the crop corners were not adjusted, so every cell is highlighted\./;

// `late`: stopping a task leaves the detection running, so that its answer can
// come after the stop, which the flow must ignore (the real scanner rejects it).
// `holdReads`: each reading answers only once the test releases it.
// `failLine`: a failure shows its line, as app.js's fail() does.
function harness(t, { type = "latinsquare", layout = { rows: 4, cols: 4, boxRows: 2, boxCols: 2 }, late = false,
  holdReads = false, failLine = false } = {}) {
  const globals = ["document", "window", "navigator", "createImageBitmap", "Image"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const noop = () => {};
  // Every canvas records what is drawn into it.
  const canvas = (width = 600, height = 600) => {
    const draws = [], ctx = new Proxy({ drawImage(source) { draws.push(source); } }, { get: (o, k) => o[k] ?? noop });
    return { width, height, draws, getContext: () => ctx, toDataURL: () => "data:image/jpeg;base64,aA==" };
  };
  const nodes = new Map(), $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { ...canvas(300, 150), id, value: "", textContent: "", checked: false, hidden: false,
      disabled: false, open: false, style: {}, dataset: {}, scrollIntoView: noop, focus: noop, setAttribute: noop,
      removeAttribute: noop, addEventListener: noop, pause: noop, load: noop, async play() {} });
    return nodes.get(id);
  };
  for (const id of ["scan-diagnostics", "live-diagnostics"])
    $(id).querySelector = (selector) => $(id + "/" + selector.match(/"(.+)"/)[1]);
  globalThis.document = { createElement: () => canvas(), addEventListener: noop, removeEventListener: noop,
    body: { classList: { add: noop, remove: noop } } };
  globalThis.window = { addEventListener: noop };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: noop, addEventListener: noop }] }) } } });
  globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close: noop });
  const puzzle = makePuzzle("latinsquare", 4);
  const state = { puzzle, photo: null, corners: null, history: [], uncertain: new Set(), cageUncertain: new Set(),
    blackReadings: [], needsReview: false, notes: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [] };
  const fields = [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]];
  const setLayout = (layout) => {
    state.layout = Object.fromEntries(fields.map(([key, id]) => { $(id).value = String(layout[key]); return [key, layout[key]]; }));
  };
  setLayout(layout);
  $("puzzle-type").value = type; $("auto-solve").checked = true; $("auto-capture").checked = true;
  // Each detection waits for the test to answer it. Stopping a task cancels
  // the scanner, which, as the real one does, rejects the detection it runs.
  const detections = [], reads = [], errors = [], statuses = [];
  let cancels = 0, solves = 0, saved, capture = null, flow = null, release = null;
  // app.js status(): the two lines the page shows, whose second the task
  // controller's elapsed time rewrites while a task runs.
  const status = (text, detail = "") => {
    statuses.push([text, detail]);
    $("status-text").textContent = text; $("status-detail").textContent = detail;
  };
  // As app.js's, the task controller tells the flow when it stops a task, and
  // counts what app.js's onStop ends the page's warm solver on: a stop of a
  // running task that was not a photograph being opened.
  let solverEnds = 0;
  const tasks = createTaskController({ $, status,
    onStop: (busy) => { flow?.stopCamera(); const opened = flow?.taskStopped?.(); if (busy && !opened) solverEnds++; },
    scanner: { cancel() { cancels++; if (!late) for (const job of detections) job.reject(aborted()); } } });
  const stopTask = (message) => tasks.stop(message);
  const storage = { set: (_key, value) => { saved = value; }, get: () => saved };
  flow = setupPhotoFlow({ $, state, scanner: {
    detect(image) { const job = deferred(); job.image = image; detections.push(job); return job.promise; },
    async read(image, corners, type, rows, cols, onProgress) {
      reads.push({ image, corners: corners.map((p) => ({ ...p })), type, rows, cols });
      onProgress("Straightening the photograph…", null);
      if (holdReads) await new Promise((resolve) => { release = resolve; });
      const reading = makePuzzle(type, rows, cols); reading.cells[0] = 1;
      return { puzzle: reading, cellUncertain: [], uncertain: [], cageUncertain: [], blackReadings: [], needsReview: false,
        notes: [], rectified: canvas(200, 200) };
    },
  }, stopTask, invalidate: () => { stopTask(); status("Puzzle changed.", "Solve again to check the updated clues and rules."); },
  begin: () => tasks.begin(), finish: () => tasks.finish(), render: noop, status,
  fail(e) {
    errors.push(e.message);
    if (failLine && e?.name !== "AbortError") status(e.message, "Nothing was uploaded or sent to a remote solver.");
  },
  remember: () => rememberEdit(state), persist: () => saveSession(storage, state), drawBoard: noop,
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() { solves++; }, boxDefault: boxShape,
  setLayout, getJobId: () => tasks.id, setDeadline: (callback, ms) => tasks.setDeadline(callback, ms),
  keepDetail: (detail) => tasks.keep(detail), savePicture: async () => true,
  liveFactory: () => ({ start: noop, stop: noop, capture: () => capture,
    diagnosticSource: () => ({ image: capture.photo, verified: true }) }) });
  // A decode still held open is let go once the task is stopped, before the
  // globals go: imports and reads share one decode queue (photo-detail.js).
  const held = [];
  t.after(async () => {
    tasks.stop(); flow.stopCamera();
    for (const decode of held) decode.resolve();
    await settle();
    for (const [key, d] of globals) {
      if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key];
    }
  });
  const crop = $("crop-canvas");
  crop.getBoundingClientRect = () => ({ left: 0, top: 0, width: crop.width, height: crop.height });
  crop.setPointerCapture = noop;
  return { $, state, tasks, detections, reads, errors, statuses, storage, canvas, setLayout,
    get cancels() { return cancels; }, get solves() { return solves; }, get solverEnds() { return solverEnds; },
    get status() { return statuses.at(-1)?.[0]; },
    // A held reading answers (`holdReads`).
    releaseRead() { release(); },
    // A status the rest of the app sets.
    say: status,
    // A photograph imported from a file; resolves once its grid is being found.
    async photograph() {
      const before = detections.length;
      const imported = $("photo-file").onchange({ target: { files: [png(800, 600)], value: "photo" } });
      for (let i = 0; i < 50 && detections.length === before; i++) await tick();
      assert.equal(detections.length, before + 1, "the photograph's grid is being found");
      assert.deepEqual(state.corners, fallback(state.photo.width, state.photo.height), "shown on the fallback crop");
      return { imported, detection: detections.at(-1) };
    },
    // A photograph chosen from a file input (`input`) whose decode the test
    // holds open: it is being decoded when this resolves (or, `queued`, once
    // `decoding` resolves: its decode waits for an earlier one), and is
    // decoded once released (`open` also waits until its grid is being
    // found), or fails (`fail`: the decode, then the full decode the import
    // tries next). Later decodes answer at once, at the size the file gives.
    async choose({ input = "photo-file", width = 640, height = 480, queued = false } = {}) {
      const decode = deferred(), before = detections.length;
      let asked = false;
      held.push(decode);
      globalThis.createImageBitmap = async (blob) => {
        const size = new DataView(await blob.slice(16, 24).arrayBuffer()),
          bitmap = { width: size.getUint32(0), height: size.getUint32(4), close: noop };
        if (asked) return bitmap;
        asked = true;
        await decode.promise;
        return bitmap;
      };
      const imported = $(input).onchange({ target: { files: [png(width, height)], value: "photo" } });
      const chosen = { imported,
        async decoding() {
          for (let i = 0; i < 50 && !asked; i++) await tick();
          assert.ok(asked, "the chosen photograph is being decoded");
        },
        release: () => decode.resolve(),
        async open() {
          decode.resolve();
          for (let i = 0; i < 50 && detections.length === before; i++) await tick();
          assert.equal(detections.length, before + 1, "the chosen photograph's grid is being found");
        },
        fail(error) {
          globalThis.Image = class { decode() { return Promise.reject(error); } };
          decode.reject(error);
        } };
      if (!queued) await chosen.decoding();
      return chosen;
    },
    async tapRead() { $("read-photo").onclick(); await tick(); },
    stop: () => stopTask("Stopped."),
    // The camera opened, a picture taken and handed to the editor (with a
    // live reading: reviewed on the board; without one: to the crop editor),
    // or, with `handOver` false, left for the test to hand over.
    async capture(picture, { handOver = true } = {}) {
      capture = { photo: canvas(800, 600), annotated: canvas(800, 600), createdAt: 1, ...picture };
      await $("camera").onclick(); $("take-photo").onclick(); await tick();
      if (!handOver) return;
      $("use-live-capture").onclick(); await tick();
    },
    // The task is running: Stop shown, Solve, Check and Hint disabled.
    running() {
      assert.equal(tasks.busy, true, "a task runs"); assert.equal($("stop").hidden, false);
      assert.equal($("solve").disabled, true); assert.equal($("check-play").disabled, true);
      assert.equal($("hint-play").disabled, true);
    },
    // No task runs: Stop hidden, Solve, Check and Hint available.
    ended() {
      assert.equal(tasks.busy, false, "no task runs"); assert.equal($("stop").hidden, true);
      assert.equal($("solve").disabled, false); assert.equal($("check-play").disabled, false);
      assert.equal($("hint-play").disabled, false);
    },
  };
}
// A Read tapped while the grid is found: answered, and nothing else happens.
async function waiting(h, detection) {
  const cancels = h.cancels, before = h.reads.length, uncertain = h.state.uncertain, errors = [...h.errors];
  await h.tapRead();
  assert.deepEqual(h.statuses.at(-1), ["Still finding the grid…", "The puzzle is read as soon as the grid is found."]);
  assert.equal(h.reads.length, before, "nothing is read yet");
  assert.equal(h.cancels, cancels, "the detection is not stopped");
  assert.equal(h.detections.at(-1), detection, "no other detection started");
  assert.equal(h.state.uncertain, uncertain, "the board is untouched");
  assert.deepEqual(h.errors, errors);
  h.running();
}
// The board after a Read through the corners a confident detection found: the
// reader's own review (none here), solved automatically.
function readThroughGrid(h) {
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.reads[0].corners, GRID);
  assert.deepEqual([h.reads[0].type, h.reads[0].rows, h.reads[0].cols], ["latinsquare", 4, 4]);
  assert.equal(h.state.puzzle.cells[0], 1);
  assert.deepEqual([...h.state.uncertain], []); assert.equal(h.state.needsReview, false);
  assert.deepEqual(h.state.notes, []);
  assert.equal(h.solves, 1, "a clean Read solves automatically, as after a tapped Read");
  assert.equal(h.status, "Puzzle read.");
  h.ended();
}
// The board after a Read through a crop nobody confirmed: every cell under
// review with the note that says why, never solved automatically.
function readThroughUnconfirmed(h, corners) {
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.reads[0].corners, corners);
  assert.equal(h.state.puzzle.cells[0], 1);
  assert.deepEqual(sorted(h.state.uncertain), ALL); assert.equal(h.state.needsReview, true);
  assert.match(h.state.notes[0], UNCONFIRMED);
  assert.equal(h.solves, 0);
  assert.equal(h.status, "Puzzle read.");
  const reloaded = restoreSession(h.storage);
  assert.deepEqual(sorted(reloaded.uncertain), ALL); assert.equal(reloaded.needsReview, true);
  h.ended();
}
// The line that leads into the waiting Read, right before the Read's own
// progress: it replaces the detection's own line, which asks for a Read.
const leadIn = (h, line) => {
  const at = h.statuses.findIndex(([text]) => text === "Straightening the photograph…");
  assert.ok(at > 0, "the Read reports its progress");
  assert.deepEqual(h.statuses[at - 1], line);
};
const FOUND_LINE = ["Grid found.", "Reading the puzzle…"],
  FALLBACK_LINE = ["The grid was not found automatically.", "Reading the puzzle through the crop as it is, so every cell will be highlighted…"];

test("a Read tapped while a new photograph's grid is found waits, then reads through the corners found", async (t) => {
  const h = harness(t), { imported, detection } = await h.photograph();
  h.running();
  assert.equal(h.status, "Finding the grid…");
  await waiting(h, detection);
  detection.resolve(found()); await imported; await settle();
  assert.deepEqual(h.errors, []);
  leadIn(h, FOUND_LINE);
  readThroughGrid(h);
  assert.deepEqual(h.state.corners, GRID);
  assert.equal(h.$("photo-panel").hidden, true, "the board shows the reading, as after a tapped Read");
});

// Exactly two taps as well as three: a second tap must neither queue another
// Read nor take the first one back.
for (const [taps, name] of [[2, "a double tap"], [3, "a triple tap"]])
  test(`${name} while it waits reads once`, async (t) => {
    const h = harness(t), { imported, detection } = await h.photograph();
    for (let tap = 0; tap < taps; tap++) await waiting(h, detection);
    detection.resolve(found()); await imported; await settle();
    leadIn(h, FOUND_LINE);
    readThroughGrid(h);
    await settle();
    assert.equal(h.reads.length, 1);
  });

// Each way the detection can end on its own, with the Read tapped while it
// ran and with the Read tapped once it ended: the same reading, board, notes,
// crop, layout, saved session and automatic solve. The 6 × 6 Sudoku found
// with the controls at 9 × 9 takes the size's suggested boxes, which the
// reading notes and asks to confirm.
const endings = {
  "finds the grid": [(job) => job.resolve(found())],
  "finds a 6 × 6 Sudoku whose boxes it suggests": [(job) => job.resolve({ ...found(), rows: 6, cols: 6 }),
    { type: "sudoku", layout: { rows: 9, cols: 9, boxRows: 3, boxCols: 3 } }],
  "finds an unconfident lattice": [(job) => job.resolve({ ...found(), confidence: 0.6 })],
  "finds no grid": [(job) => job.resolve({ rows: 0, cols: 0, confidence: 0, corners: fallback(800, 600) })],
  "fails": [(job) => job.reject(Error("Image processing failed"))],
  "runs out of time": [(job) => job.reject(Error("Image processing timed out. Go online and retry."))],
  "is given up by the scanner": [(job) => job.reject(aborted())],
};
for (const [how, [end, page]] of Object.entries(endings))
  test(`a waiting Read is the Read tapped once the detection ends, when the detection ${how}`, async (t) => {
    // Each page in its own subtest, so that each is torn down before the next.
    const outcome = (early) => async (t) => {
      const h = harness(t, page), { imported, detection } = await h.photograph();
      if (early) await waiting(h, detection);
      end(detection); await imported; await settle();
      if (!early) { h.ended(); await h.tapRead(); await settle(); }
      h.ended();
      return { reads: h.reads.map(({ corners, type, rows, cols }) => ({ corners, type, rows, cols })),
        puzzle: h.state.puzzle, uncertain: sorted(h.state.uncertain), notes: h.state.notes,
        needsReview: h.state.needsReview, corners: h.state.corners, layout: h.state.layout, solves: h.solves,
        errors: h.errors, status: h.statuses.at(-1), session: restoreSession(h.storage) };
    };
    let tapped, waited;
    await t.test("Read tapped once the detection ended", async (t) => { tapped = await outcome(false)(t); });
    await t.test("Read tapped while it ran", async (t) => { waited = await outcome(true)(t); });
    assert.equal(waited.reads.length, 1);
    assert.deepEqual(waited, tapped);
    if (page) {
      assert.deepEqual([waited.puzzle.boxRows, waited.puzzle.boxCols], [2, 3]);
      assert.match(waited.notes.at(-1), /^Box layout 2 rows × 3 columns was suggested from the grid size/);
      assert.equal(waited.needsReview, true);
    }
  });

// The Read takes the settings as they are when it starts, as a Read tapped
// then would: a type chosen while it waits is the type it reads.
test("a waiting Read reads with the settings of the moment it starts", async (t) => {
  const h = harness(t), { imported, detection } = await h.photograph();
  await waiting(h, detection);
  h.$("puzzle-type").value = "futoshiki";
  detection.resolve(found()); await imported; await settle();
  assert.equal(h.reads.length, 1);
  assert.deepEqual([h.reads[0].type, h.reads[0].rows, h.reads[0].cols], ["futoshiki", 4, 4]);
  assert.equal(h.state.puzzle.type, "futoshiki");
  h.ended();
});

for (const [how, end] of [["fails", (job) => job.reject(Error("Image processing failed"))],
  ["is given up by the scanner while its task runs", (job) => job.reject(aborted())]])
  test(`a waiting Read goes on through the fallback crop, every cell highlighted, when the detection ${how}`, async (t) => {
    const h = harness(t), { imported, detection } = await h.photograph();
    await waiting(h, detection);
    end(detection); await imported; await settle();
    leadIn(h, FALLBACK_LINE);
    readThroughUnconfirmed(h, fallback(800, 600));
    assert.deepEqual(h.state.corners, fallback(800, 600));
  });

test("a waiting Read goes through the corners of a detection that asks for them to be set, every cell highlighted", async (t) => {
  const h = harness(t), { imported, detection } = await h.photograph();
  await waiting(h, detection);
  detection.resolve({ ...found(), confidence: 0.6 }); await imported; await settle();
  leadIn(h, FALLBACK_LINE);
  readThroughUnconfirmed(h, GRID);
  assert.deepEqual(h.state.layout, { rows: 4, cols: 4, boxRows: 2, boxCols: 2 });
});

// `late`: the stopped detection has not answered yet when Read is tapped
// again, and answers after that Read.
for (const late of [false, true])
  test(`Stop while a Read waits stops both: no Read, the fallback crop stays, and a later Read reads it${late ? ", before the stopped detection answers" : ""}`, async (t) => {
    const h = harness(t, { late }), { imported, detection } = await h.photograph();
    await waiting(h, detection);
    h.stop();
    h.ended();
    await settle();
    assert.equal(h.status, "Stopped.");
    assert.equal(h.reads.length, 0);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.state.corners, fallback(800, 600));
    // No detection runs now, so a Read reads the crop as it stands at once.
    await h.tapRead(); await settle();
    readThroughUnconfirmed(h, fallback(800, 600));
    // The stopped detection's answer, if it comes now, changes nothing.
    detection.resolve(found(STRAY)); await imported; await settle();
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.state.corners, fallback(800, 600));
    h.ended();
  });

// Everything that stops the detection's task, or closes the crop editor,
// drops the waiting Read; each also checks what it leaves. With the scanner
// rejecting a stopped detection, as the real one does, and with its answer
// coming late, after the stop.
const interruptions = {
  async "a new photograph"(h) {
    const next = await h.photograph();
    next.detection.resolve(found()); await next.imported; await settle();
    assert.equal(h.status, "Grid found."); h.ended();
  },
  async "a live capture handed to the editor"(h) {
    const reading = makePuzzle("latinsquare", 4); reading.cells[5] = 3;
    await h.capture({ corners: GRID, found: { puzzle: reading, notes: [], rectified: h.canvas(200, 200),
      cellUncertain: [], cageUncertain: [], needsReview: true } });
    assert.deepEqual(h.state.puzzle.cells, reading.cells, "the capture is on the board");
    assert.equal(h.status, "Captured clues ready for review."); h.ended();
  },
  async "a picture taken without a reading and sent to the crop editor"(h) {
    await h.capture({ corners: null, found: null });
    assert.equal(h.detections.length, 2, "its grid is being found");
    assert.deepEqual(h.state.corners, fallback(800, 600));
    h.detections[1].resolve(found()); await settle();
    assert.equal(h.status, "Grid found."); h.ended();
  },
  async Rotate(h) {
    h.$("rotate-photo").onclick(); await settle();
    assert.equal(h.detections.length, 2, "the turned photograph's grid is being found");
    assert.deepEqual([h.state.photo.width, h.state.photo.height], [600, 800]);
    h.detections[1].resolve(found(fallback(600, 800))); await settle();
    assert.equal(h.status, "Grid found."); h.ended();
  },
  async "a corner moved with the pointer"(h) {
    const crop = h.$("crop-canvas"), [first] = fallback(800, 600);
    crop.onpointerdown({ clientX: first.x, clientY: first.y, pointerId: 1, preventDefault() {} });
    crop.onpointermove({ clientX: first.x + 20, clientY: first.y + 10 }); crop.onpointerup();
    await settle();
    assert.deepEqual(h.state.corners[0], { x: first.x + 20, y: first.y + 10 }); h.ended();
  },
  async "a corner moved with the keyboard"(h) {
    const crop = h.$("crop-canvas"), [, , third] = fallback(800, 600);
    crop.onkeydown({ key: "3", preventDefault() {} });
    crop.onkeydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
    await settle();
    assert.deepEqual(h.state.corners[2], { x: third.x - 10, y: third.y }); h.ended();
  },
  async "Hide photo, which leaves the detection running"(h, cancels) {
    h.$("hide-photo").onclick();
    assert.equal(h.$("photo-panel").hidden, true);
    // The detection itself goes on, and its grid is taken as before.
    h.running();
    assert.equal(h.cancels, cancels, "the detection is not stopped");
    h.detections[0].resolve(found()); await settle();
    assert.deepEqual(h.state.corners, GRID);
    assert.equal(h.status, "Grid found."); h.ended();
    assert.equal(h.$("photo-panel").hidden, true, "the crop editor stays closed");
  },
  async "Stop"(h) {
    h.stop(); await settle();
    assert.equal(h.status, "Stopped."); h.ended();
  },
  // Opening a cell to edit stops a running task (app.js openCell).
  async "an edit"(h) {
    h.tasks.stop("Stopped for editing."); await settle();
    assert.equal(h.status, "Stopped for editing."); h.ended();
  },
  async "Find grid, another detection"(h) {
    const again = h.$("detect-photo").onclick();
    assert.equal(h.detections.length, 2); h.running();
    h.detections[1].resolve(found()); await again; await settle();
    assert.equal(h.status, "Grid found."); h.ended();
  },
};
for (const late of [false, true])
  for (const [what, interrupt] of Object.entries(interruptions))
    test(`${what} drops a waiting Read${late ? ", and the stopped detection's late answer changes nothing" : ""}`, async (t) => {
      const h = harness(t, { late }), { detection } = await h.photograph();
      await waiting(h, detection);
      await interrupt(h, h.cancels);
      const corners = h.state.corners;
      // The first detection's answer, if it comes now, changes nothing.
      detection.resolve(found(STRAY)); await settle();
      assert.equal(h.reads.length, 0, "nothing is read");
      assert.equal(h.solves, 0);
      assert.deepEqual(h.errors, []);
      assert.equal(h.state.corners, corners);
      h.ended();
    });

// Find grid on a photograph whose grid has not been found yet (its first
// detection failed or was stopped, no corner moved): the crop is still the
// fallback crop, so the same reasoning holds and a Read waits for it too. A
// corner handle touched but not moved stops the detection as Stop does and
// leaves the crop untouched.
const firstEndings = {
  failed: (h, job) => job.reject(Error("Image processing failed")),
  "was stopped": (h) => h.stop(),
  "was stopped by a touch on a corner handle"(h) {
    const crop = h.$("crop-canvas"), [corner] = fallback(800, 600);
    crop.onpointerdown({ clientX: corner.x, clientY: corner.y, pointerId: 1, preventDefault() {} });
    crop.onpointerup();
  },
};
for (const [how, first] of Object.entries(firstEndings))
  test(`a Read waits for Find grid when the first detection ${how} and no corner moved`, async (t) => {
    const h = harness(t), { imported, detection } = await h.photograph();
    first(h, detection);
    await imported; await settle();
    h.ended(); assert.deepEqual(h.state.corners, fallback(800, 600));
    const again = h.$("detect-photo").onclick();
    assert.equal(h.detections.length, 2); h.running();
    await waiting(h, h.detections[1]);
    h.detections[1].resolve(found()); await again; await settle();
    leadIn(h, FOUND_LINE);
    readThroughGrid(h);
  });

// A Read during Find grid on a crop that a detection, a moved corner or a
// live capture set keeps its behaviour: it stops the detection and reads that
// crop at once (these pass before this change too).
const setCrops = {
  async "a detection found"(h, { detection, imported }) {
    detection.resolve(found()); await imported; await settle();
    return GRID;
  },
  async "a detection asked to be set"(h, { detection, imported }) {
    const unsure = [{ x: 50, y: 40 }, { x: 750, y: 40 }, { x: 750, y: 560 }, { x: 50, y: 560 }];
    detection.resolve({ rows: 0, cols: 0, confidence: 0.3, corners: unsure }); await imported; await settle();
    return unsure;
  },
  async "the user moved with the keyboard after a failed detection"(h, { detection, imported }) {
    detection.reject(Error("Image processing failed")); await imported; await settle();
    const crop = h.$("crop-canvas");
    crop.onkeydown({ key: "1", preventDefault() {} });
    crop.onkeydown({ key: "ArrowRight", preventDefault() {} });
    const moved = fallback(800, 600); moved[0] = { x: moved[0].x + 1, y: moved[0].y };
    assert.deepEqual(h.state.corners, moved);
    return moved;
  },
  async "the user moved with the pointer after a failed detection"(h, { detection, imported }) {
    detection.reject(Error("Image processing failed")); await imported; await settle();
    const crop = h.$("crop-canvas"), moved = fallback(800, 600), [, second] = moved;
    crop.onpointerdown({ clientX: second.x, clientY: second.y, pointerId: 1, preventDefault() {} });
    crop.onpointermove({ clientX: second.x - 30, clientY: second.y + 5 }); crop.onpointerup();
    moved[1] = { x: second.x - 30, y: second.y + 5 };
    assert.deepEqual(h.state.corners, moved);
    return moved;
  },
  async "a live capture brought, after a failed detection"(h, { detection, imported }) {
    detection.reject(Error("Image processing failed")); await imported; await settle();
    await h.capture({ corners: GRID.map((p) => ({ ...p })), found: { puzzle: makePuzzle("latinsquare", 4), notes: [],
      rectified: h.canvas(200, 200), cellUncertain: [], cageUncertain: [], needsReview: true } });
    assert.deepEqual(h.state.corners, GRID);
    return GRID;
  },
};
for (const late of [false, true])
  for (const [how, setCrop] of Object.entries(setCrops))
    test(`a Read during Find grid on a crop ${how} stops it and reads that crop at once${late ? ", whatever it answers late" : ""}`, async (t) => {
      const h = harness(t, { late }), photo = await h.photograph();
      const corners = await setCrop(h, photo);
      h.ended();
      const reads = h.reads.length, again = h.$("detect-photo").onclick(), job = h.detections.at(-1);
      h.running();
      await h.tapRead(); await settle();
      assert.equal(h.reads.length, reads + 1, "read at once");
      assert.deepEqual(h.reads.at(-1).corners, corners);
      assert.equal(h.status, "Puzzle read."); h.ended();
      job.resolve(found(STRAY)); await again; await settle();
      assert.equal(h.reads.length, reads + 1);
      assert.notDeepEqual(h.state.corners[0], STRAY[0], "the stopped detection's answer is not taken");
    });

test("a picture sent to the crop editor without a reading waits for its grid like a new photograph", async (t) => {
  const h = harness(t);
  await h.capture({ corners: null, found: null });
  assert.equal(h.detections.length, 1);
  assert.deepEqual(h.state.corners, fallback(800, 600));
  await waiting(h, h.detections[0]);
  h.detections[0].resolve(found()); await settle();
  leadIn(h, FOUND_LINE);
  readThroughGrid(h);
});

// Such a picture taken while the live help line named a turn carries it
// (photo-capture-orientation.test.js), and a Read of it that leaves it the way
// it lies says the turn in a first note. A Read that waited for the grid and
// one tapped once the detection ended are the same Read here too, note and
// all, with the same plain line leading into the waiting one. The note moves
// no flag: through the corners found, the clean reading solves automatically;
// through a crop nobody confirmed, every cell waits for review under the
// crop's note, after the turn's.
const KEPT = "The live view suggested that the page may be sideways, but Read puzzle's check kept the captured picture the way it lies. If its numbers do not stand upright, Adjust scan → Rotate until they do, then Read puzzle.";
for (const how of ["finds the grid", "finds no grid", "fails"])
  test(`a waiting Read of a picture taken while the help line named a turn is the Read tapped once the detection ends, the turn's note first, when the detection ${how}`, async (t) => {
    const [end] = endings[how];
    const outcome = (early) => async (t) => {
      const h = harness(t);
      await h.capture({ corners: null, found: null, turn: "sideways" });
      assert.equal(h.detections.length, 1);
      const [detection] = h.detections;
      if (early) await waiting(h, detection);
      end(detection); await settle();
      if (early) leadIn(h, how === "finds the grid" ? FOUND_LINE : FALLBACK_LINE);
      else { h.ended(); await h.tapRead(); await settle(); }
      h.ended();
      return { reads: h.reads.map(({ corners, type, rows, cols }) => ({ corners, type, rows, cols })),
        puzzle: h.state.puzzle, uncertain: sorted(h.state.uncertain), notes: h.state.notes,
        needsReview: h.state.needsReview, corners: h.state.corners, solves: h.solves, errors: h.errors,
        status: h.statuses.at(-1), session: restoreSession(h.storage) };
    };
    let tapped, waited;
    await t.test("Read tapped once the detection ended", async (t) => { tapped = await outcome(false)(t); });
    await t.test("Read tapped while it ran", async (t) => { waited = await outcome(true)(t); });
    assert.equal(waited.reads.length, 1);
    assert.deepEqual(waited, tapped);
    const found = how === "finds the grid";
    assert.deepEqual(waited.notes, found ? [KEPT] : [KEPT, waited.notes[1]]);
    if (!found) assert.match(waited.notes[1], UNCONFIRMED);
    assert.deepEqual(waited.uncertain, found ? [] : ALL);
    assert.equal(waited.needsReview, !found);
    assert.equal(waited.solves, found ? 1 : 0);
    assert.deepEqual(waited.session.notes, waited.notes);
  });

test("a rotated photograph's Read waits for the turned photograph's grid", async (t) => {
  const h = harness(t), { detection, imported } = await h.photograph();
  detection.resolve(found()); await imported; await settle();
  h.$("rotate-photo").onclick(); await settle();
  assert.equal(h.detections.length, 2);
  assert.deepEqual(h.state.corners, fallback(600, 800));
  await waiting(h, h.detections[1]);
  h.detections[1].resolve(found(TURNED)); await settle();
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.reads[0].corners, TURNED);
  assert.equal(h.status, "Puzzle read."); h.ended();
});

// Rotate or Find grid tapped while the first detection still runs (a sideways
// photograph turned at once, say) stops it and starts the next detection on
// the fallback crop. The stopped detection settles only after the next one
// has begun, whether the scanner rejects it at the stop or it answers late,
// and must leave the next one's search alone: a Read tapped during the next
// detection waits for it, with or without a Read that waited for the first,
// and reads once through the corners it finds.
const restarts = {
  Rotate: [(h) => h.$("rotate-photo").onclick(), fallback(600, 800), TURNED],
  "Find grid": [(h) => void h.$("detect-photo").onclick(), fallback(800, 600), GRID],
};
for (const late of [false, true])
  for (const [what, [restart, crop, corners]] of Object.entries(restarts))
    for (const tapped of [false, true])
      test(`${what} tapped while the first detection runs${tapped ? " with a Read waiting" : ""}: a Read tapped during the next detection waits for it${late ? ", also when the first answers late" : ""}`, async (t) => {
        const h = harness(t, { late }), { imported, detection } = await h.photograph();
        if (tapped) await waiting(h, detection);
        const cancels = h.cancels;
        restart(h); await settle();
        assert.ok(h.cancels > cancels, "the first detection is stopped");
        assert.equal(h.detections.length, 2, "the next detection runs");
        assert.deepEqual(h.state.corners, crop, "on the fallback crop");
        h.running();
        await waiting(h, h.detections[1]);
        // The first detection's answer, coming now, neither reads nor drops the Read.
        detection.resolve(found(STRAY)); await imported; await settle();
        assert.equal(h.reads.length, 0, "nothing is read yet");
        assert.deepEqual(h.state.corners, crop);
        h.running();
        h.detections[1].resolve(found(corners)); await settle();
        leadIn(h, FOUND_LINE);
        assert.equal(h.reads.length, 1);
        assert.deepEqual(h.reads[0].corners, corners);
        assert.deepEqual(h.errors, []);
        assert.equal(h.status, "Puzzle read."); h.ended();
        await settle();
        assert.equal(h.reads.length, 1);
      });

// Hide photo drops the waiting Read and lets the detection go on, so a Read
// tapped again after Adjust scan, while it still runs, waits for it again.
test("after Hide photo and Adjust scan, a Read tapped while the detection still runs waits again and reads once", async (t) => {
  const h = harness(t), { imported, detection } = await h.photograph();
  await waiting(h, detection);
  h.$("hide-photo").onclick();
  h.running();
  h.$("show-crop").onclick();
  assert.equal(h.$("photo-panel").hidden, false);
  await waiting(h, detection);
  detection.resolve(found()); await imported; await settle();
  leadIn(h, FOUND_LINE);
  readThroughGrid(h);
});

// ---- On screen ------------------------------------------------------------
// What the page shows while a Read waits and once something drops it: the
// two status lines as app.js's status() writes them and as the task
// controller's elapsed time rewrites the second every half second while a
// task runs, sampled from a 10 ms timer between tasks, as a paint sees them
// (only changes are kept). Before, the elapsed time replaced the answer's
// promise within half a second, and a stop that sets no status of its own (a
// moved corner, a Play cell, a change of editing tool) left the answer on
// screen, promising a Read that never came.
const STILL = "Still finding the grid…", PROMISE = "The puzzle is read as soon as the grid is found.",
  TIME = String.raw`\d+\.\d seconds elapsed · Stop cancels this task\.`,
  ELAPSED = new RegExp(`^${TIME}$`), TIMED = new RegExp(`^${PROMISE.replaceAll(".", "\\.")} ${TIME}$`),
  DROPPED = ["Stopped.", "Read puzzle reads the crop as it is."],
  FINDING = ["Finding the grid…", "Photo processing stays on this device."],
  UNFINISHED = "Search unfinished. No claim about uniqueness or impossibility has been made.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function screen(t, h) {
  const painted = [], now = () => [h.$("status-text").textContent, h.$("status-detail").textContent];
  const sample = () => {
    const line = now(), last = painted.at(-1);
    if (!last || last[0] !== line[0] || last[1] !== line[1]) painted.push(line);
  };
  const timer = setInterval(sample, 10);
  t.after(() => clearInterval(timer));
  return {
    painted, now,
    // A point to count from: since(point) is what was painted after it.
    mark() { sample(); return painted.length; },
    since(point) { sample(); return painted.slice(point); },
    // Waits, as the page goes on, until the line on screen passes `check`.
    async until(check, what) {
      for (const started = Date.now(); !check(now()); await sleep(10))
        if (Date.now() - started > 10000) assert.fail(`never painted: ${what}\n${JSON.stringify(painted, null, 1)}`);
      sample();
    },
  };
}
// The answer, bare or with the elapsed time after its promise.
const answer = ([text, detail]) => text === STILL && (detail === PROMISE || TIMED.test(detail));
const noPromise = (lines) => assert.ok(lines.every(([, detail]) => !detail.includes(PROMISE)), JSON.stringify(lines, null, 1));

test("on screen, the answer's promise stays while the Read waits, with the elapsed time after it, and the detection's and the Read's own lines are as before", async (t) => {
  const h = harness(t, { holdReads: true }), s = screen(t, h), { imported, detection } = await h.photograph();
  // The detection alone: its own line, then its elapsed time alone.
  await s.until(([text, detail]) => text === FINDING[0] && ELAPSED.test(detail), "the detection's elapsed time");
  const tapped = s.mark();
  await h.tapRead();
  // The promise through two ticks of the elapsed time, and through a second tap.
  const ticks = () => new Set(s.painted.slice(tapped).flatMap(([, detail]) => (TIMED.test(detail) ? [detail] : []))).size;
  await s.until(() => ticks() >= 2, "the promise with two elapsed times");
  await h.tapRead();
  await s.until(() => ticks() >= 3, "the promise with the elapsed time after a second tap");
  const waited = s.since(tapped);
  assert.deepEqual(waited[0], [STILL, PROMISE], "the answer as it is set");
  assert.ok(waited.every(answer), JSON.stringify(waited, null, 1));
  assert.equal(h.reads.length, 0); h.running();
  // The detection answers, and the Read runs as a task of its own: none of
  // its lines carries the promise, and its elapsed time stands alone.
  const answered = s.mark();
  detection.resolve(found()); await imported;
  await s.until(([text, detail]) => text === "Straightening the photograph…" && ELAPSED.test(detail), "the Read's elapsed time");
  h.releaseRead();
  await s.until(([text]) => text === "Puzzle read.", "the reading");
  await sleep(600);
  const read = s.since(answered);
  noPromise(read);
  assert.ok(read.slice(0, -1).every(([text, detail]) => (text === FOUND_LINE[0] ? detail === FOUND_LINE[1]
    : text === "Straightening the photograph…" && (detail === "" || ELAPSED.test(detail)))), JSON.stringify(read, null, 1));
  assert.equal(read.at(-1)[0], "Puzzle read.", "the elapsed time ends with the Read");
  readThroughGrid(h);
});

// app.js's own handlers for a tap on a board cell (cellAction, which opens a
// Play cell, answers a tap on a clue cell or selects a cell for a cage or an
// inequality) and for a change of editing tool, taken from app.js as they
// are (as play-actions.test.js does) and run against this harness's flow,
// task controller and status lines.
function appHandlers(h) {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const section = (first, last) => {
    const start = app.indexOf(first), end = app.indexOf(last, start);
    assert.ok(start >= 0 && end > start, `app.js has ${first}`);
    return app.slice(start, end);
  };
  const noop = () => {};
  Object.assign(h.$("board"), { querySelector: () => null });
  Object.assign(h.$("cell-dialog"), { showModal() { this.open = true; } });
  Object.assign(h.$("cell-value"), { select: noop });
  const context = vm.createContext({ $: h.$, state: h.state, status: h.say, isPlayableCell, maxValue,
    stopTask: (message) => h.tasks.stop(message), clueReread: { open: noop, cancel: noop }, drawBoard: noop, render: noop,
    openCell() { assert.fail("only the Clues tool opens a cell to edit"); } });
  vm.runInContext(["let editing = null, focused = null, playEditing = false;",
    section("function playMode()", "function savePlayCell()"),
    section("function cellAction(", '$("board").onclick ='),
    section('$("edit-tool").onchange =', '$("clear-selection").onclick ='),
    "globalThis.app = { cellAction };"].join("\n"), context);
  return context.app;
}
// A tap on board cell `i` with the editing tool `tool`, through app.js.
const tapCell = (h, tool, i) => { h.$("edit-tool").value = tool; appHandlers(h).cellAction(i); };

// Stops that set no status of their own: a corner moved or touched in the
// crop editor; app.js's own handlers when a Play cell opens and when the
// editing tool changes; and any other task stop without a message (as a
// puzzle file chosen stops it, until the file is read; a photograph chosen
// has a line of its own, below). Each
// drops the waiting Read, and the answer goes with it, before the page paints
// again; the line in its place says what a Read does now, which a Read then
// does. (A cell selected with the Cages or Inequalities tool stops the task
// too, but says how many cells are selected: below.)
const silentStops = {
  "a corner moved with the pointer"(h) {
    const crop = h.$("crop-canvas"), [first] = fallback(800, 600);
    crop.onpointerdown({ clientX: first.x, clientY: first.y, pointerId: 1, preventDefault() {} });
    crop.onpointermove({ clientX: first.x + 20, clientY: first.y + 10 }); crop.onpointerup();
  },
  "a corner moved with the keyboard"(h) {
    const crop = h.$("crop-canvas");
    crop.onkeydown({ key: "3", preventDefault() {} });
    crop.onkeydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
  },
  "a corner handle touched but not moved"(h) {
    const crop = h.$("crop-canvas"), [corner] = fallback(800, 600);
    crop.onpointerdown({ clientX: corner.x, clientY: corner.y, pointerId: 1, preventDefault() {} });
    crop.onpointerup();
  },
  "a Play cell opened"(h) {
    tapCell(h, "play", 5);
    assert.equal(h.$("cell-dialog").open, true, "the cell opens for an answer");
  },
  "a change of editing tool"(h) {
    appHandlers(h);
    h.$("edit-tool").value = "play"; h.$("edit-tool").onchange();
  },
  "a task stop without a message"(h) { h.tasks.stop(); },
};
for (const [what, stop] of Object.entries(silentStops))
  for (const ticked of [false, true])
    test(`on screen, ${what} drops the waiting Read ${ticked ? "once the elapsed time follows the promise" : "right after the tap"}: "Stopped.", and Read puzzle reads the crop as it is, at once`, async (t) => {
      const h = harness(t), s = screen(t, h), { imported } = await h.photograph();
      await h.tapRead();
      if (ticked) await s.until(([, detail]) => TIMED.test(detail), "the promise with the elapsed time");
      assert.ok(answer(s.now()), JSON.stringify(s.now()));
      const stopped = s.mark();
      stop(h); await settle(); await sleep(100);
      assert.deepEqual(s.since(stopped), [DROPPED], "painted after the stop: this line alone, which stays");
      h.ended(); assert.equal(h.reads.length, 0);
      await imported;
      const corners = h.state.corners.map((p) => ({ ...p }));
      await h.tapRead(); await settle();
      assert.equal(h.reads.length, 1, "read at once"); assert.deepEqual(h.reads[0].corners, corners);
      assert.equal(h.status, "Puzzle read."); h.ended();
    });

// A stop or another task that sets a status of its own keeps it: the flow
// replaces its own answer only, also when the stopped detection answers late.
// A cell selected with the Cages or Inequalities tool is such a stop: app.js's
// handler stops the task and then, in the same handler, says how many cells
// are selected.
const ownLines = {
  Stop: [(h) => h.stop(), ["Stopped.", UNFINISHED]],
  "an edit": [(h) => h.tasks.stop("Stopped for editing."), ["Stopped for editing.", UNFINISHED]],
  "Find grid": [(h) => void h.$("detect-photo").onclick(), FINDING],
  Rotate: [(h) => h.$("rotate-photo").onclick(), FINDING],
  "the camera": [(h) => h.$("camera").onclick(), ["Camera ready.", "Hold a clear grid steady; the shutter saves the view."]],
  "a cell selected with the Cages tool": [(h) => { tapCell(h, "cage", 5); h.ended(); },
    ["1 cells selected.", "Enter the target and save the cage."]],
  "a cell selected with the Inequalities tool": [(h) => { tapCell(h, "inequality", 5); h.ended(); },
    ["1 cells selected.", "Select the smaller cell first, then the larger adjacent cell."]],
};
for (const late of [false, true])
  for (const [what, [stop, line]] of Object.entries(ownLines))
    test(`on screen, ${what} drops the waiting Read with a status of its own, which stays${late ? ", also when the stopped detection answers late" : ""}`, async (t) => {
      const h = harness(t, { late }), s = screen(t, h), { detection } = await h.photograph();
      await h.tapRead();
      const stopped = s.mark();
      await stop(h); await settle();
      if (late) { detection.resolve(found(STRAY)); await settle(); }
      await sleep(50);
      const after = s.since(stopped);
      assert.deepEqual(s.now(), line);
      noPromise(after);
      assert.ok(!after.some(([text, detail]) => text === DROPPED[0] && detail === DROPPED[1]), JSON.stringify(after, null, 1));
      assert.equal(h.reads.length, 0);
    });

// Hide photo drops the waiting Read and lets the detection go on: the line
// that detection started with comes back (with a capture's turn, if its help
// line named one), and then its elapsed time alone, as before the tap.
for (const turn of [null, "sideways"])
  test(`on screen, Hide photo drops the waiting Read: the detection's own line${turn ? ", naming the capture's turn," : ""} comes back, then its elapsed time alone`, async (t) => {
    const h = harness(t), s = screen(t, h);
    let detection, imported;
    if (turn) { await h.capture({ corners: null, found: null, turn }); [detection] = h.detections; }
    else ({ detection, imported } = await h.photograph());
    const start = h.statuses.findLast(([text]) => text === FINDING[0]);
    assert.deepEqual(start, turn ? [FINDING[0], `${FINDING[1]} The grid looked ${turn} in the live view.`] : FINDING);
    await h.tapRead();
    await s.until(([, detail]) => TIMED.test(detail), "the promise with the elapsed time");
    const hidden = s.mark();
    h.$("hide-photo").onclick();
    assert.deepEqual(h.statuses.at(-1), start, "the line the detection started with, at once");
    await s.until(([text, detail]) => text === FINDING[0] && ELAPSED.test(detail), "the detection's elapsed time");
    h.running();
    detection.resolve(found()); await imported; await settle();
    const after = s.since(hidden);
    noPromise(after);
    assert.ok(after.slice(0, -1).every(([text, detail]) => text === FINDING[0] && (detail === start[1] || ELAPSED.test(detail))),
      JSON.stringify(after, null, 1));
    assert.equal(h.status, "Grid found."); assert.equal(h.reads.length, 0); h.ended();
  });

// A status set while the Read waits by something that does not stop it (app.js
// answers a Play tap on a clue cell that way, run here as it is) replaces the
// answer: the elapsed time then replaces that status's second line, as any
// status's, and the Read still follows the detection. A stop without a
// status or Hide photo leaves that status as it is, since no answer is on
// screen to take back.
const CLUE = ["That cell holds a printed clue.", "Pick a blank cell for your answer, or switch Editing to Clues to change the clue."];
test("on screen, a status set while the Read waits (a Play tap on a clue cell) replaces the answer, its elapsed time alone, and the Read still follows the detection", async (t) => {
  const h = harness(t), s = screen(t, h), { imported, detection } = await h.photograph();
  h.state.puzzle.cells[0] = 1;
  await h.tapRead();
  const said = s.mark();
  tapCell(h, "play", 0);
  assert.deepEqual(h.statuses.at(-1), CLUE, "app.js's answer to the tap");
  await s.until(([text, detail]) => text === CLUE[0] && ELAPSED.test(detail), "the elapsed time under that status");
  const after = s.since(said);
  assert.ok(after.every(([text, detail]) => text === CLUE[0] && (detail === CLUE[1] || ELAPSED.test(detail))), JSON.stringify(after, null, 1));
  h.running(); assert.equal(h.reads.length, 0);
  detection.resolve(found()); await imported; await settle();
  leadIn(h, FOUND_LINE);
  readThroughGrid(h);
});
for (const [what, drop] of [["a stop without a status", (h) => h.tasks.stop()], ["Hide photo", (h) => h.$("hide-photo").onclick()]])
  test(`on screen, ${what} leaves a status set while the Read waited as it is`, async (t) => {
    const h = harness(t), s = screen(t, h), { detection } = await h.photograph();
    await h.tapRead();
    h.say(...CLUE);
    const dropped = s.mark();
    drop(h); await settle(); await sleep(50);
    detection.resolve(found()); await settle();
    const after = s.since(dropped).filter(([text]) => text !== "Grid found.");
    assert.ok(after.every(([text, detail]) => text === CLUE[0] && (detail === CLUE[1] || ELAPSED.test(detail))), JSON.stringify(after, null, 1));
    assert.equal(h.reads.length, 0);
  });

// The real scanner rejects a stopped detection at once, so the answer goes
// one microtask after a stop without a status. A detection that answers only
// later has the answer replaced when it does, never a line set since; and
// Hide photo meanwhile says what a stop says, since no detection runs.
test("a stop without a status whose detection answers late: the answer goes when it answers, and never a line set since", async (t) => {
  const line = (h) => [h.$("status-text").textContent, h.$("status-detail").textContent];
  await t.test("nothing set meanwhile", async (t) => {
    const h = harness(t, { late: true }), { detection } = await h.photograph();
    await h.tapRead(); h.tasks.stop(); await settle();
    assert.equal(line(h)[0], STILL, "the stopped detection has not answered yet");
    detection.resolve(found(STRAY)); await settle();
    assert.deepEqual(line(h), DROPPED); assert.equal(h.reads.length, 0);
  });
  await t.test("a Read tapped meanwhile", async (t) => {
    const h = harness(t, { late: true }), { detection } = await h.photograph();
    await h.tapRead(); h.tasks.stop(); await settle();
    await h.tapRead(); await settle();
    assert.equal(h.reads.length, 1, "read at once"); assert.equal(line(h)[0], "Puzzle read.");
    const read = line(h);
    detection.resolve(found(STRAY)); await settle();
    assert.deepEqual(line(h), read); assert.equal(h.reads.length, 1);
  });
  await t.test("Hide photo meanwhile", async (t) => {
    const h = harness(t, { late: true }), { detection } = await h.photograph();
    await h.tapRead(); h.tasks.stop(); await settle();
    h.$("hide-photo").onclick();
    assert.deepEqual(line(h), DROPPED, "no detection runs, so not its line");
    detection.resolve(found(STRAY)); await settle();
    assert.deepEqual(line(h), DROPPED); assert.equal(h.reads.length, 0); h.ended();
  });
});

// ---- A photograph chosen while another is in the crop editor --------------
// The file inputs open a chosen photograph (read, check and decode it,
// photo-import.js) as a task of its own before it replaces the one in the crop
// editor; here its decode is held open. Before, they stopped the running task
// and set no status until the photograph was decoded ("Stopped." over "Read
// puzzle reads the crop as it is." after a dropped waiting Read; Stop hidden,
// Solve available), and a Read tapped meanwhile read the photograph before
// it, through its crop as it stood, while the chosen one was dropped without
// a word; Find grid, Rotate and a corner acted on that one too, and any other
// stop dropped the chosen one without a word.
const OPENING = ["Opening the photo…", "Photo processing stays on this device."],
  STILL_OPENING = ["Still opening the photo…", PROMISE],
  OPENING_EDITOR = ["Still opening the photo…", "The crop editor switches to it as soon as it is open."],
  OPEN_DROPPED = ["Stopped.", "The new photo was not opened."];
// The corners the detector finds on the 640 × 480 photograph chosen.
const CHOSEN = [{ x: 80, y: 60 }, { x: 560, y: 70 }, { x: 550, y: 410 }, { x: 90, y: 420 }];
const copy = (corners) => corners.map((p) => ({ ...p }));
// A first photograph whose grid was found: the crop editor shows it, with the
// corners found.
async function inEditor(h) {
  const { detection, imported } = await h.photograph();
  detection.resolve(found()); await imported; await settle();
  assert.equal(h.status, "Grid found."); h.ended();
  return { photo: h.state.photo, corners: copy(h.state.corners), layout: { ...h.state.layout } };
}

for (const [input, from] of [["photo-file", "from the photo library"], ["native-file", "with the phone's camera app"]])
  test(`a photograph chosen ${from} while a Read waits for the grid of the one before it has a status of its own while it opens, "Opening the photo…", then its elapsed time, as a task (Stop shown, Solve, Check and Hint disabled); then it opens as before`, async (t) => {
    const h = harness(t), s = screen(t, h), first = await h.photograph(), photo = h.state.photo;
    await h.tapRead();
    const chosen = s.mark(), next = await h.choose({ input }), ends = h.solverEnds;
    h.running();
    await s.until(([text, detail]) => text === OPENING[0] && ELAPSED.test(detail), "the opening's elapsed time");
    const opening = s.since(chosen);
    assert.deepEqual(opening[0], OPENING, "its own line, at once");
    assert.ok(opening.every(([text, detail]) => text === OPENING[0] && (detail === OPENING[1] || ELAPSED.test(detail))),
      JSON.stringify(opening, null, 1));
    assert.equal(h.state.photo, photo, "the crop editor keeps the photograph before it until the new one opens");
    assert.equal(h.reads.length, 0);
    // Opened, it is shown on its fallback crop while its grid is found, as a
    // photograph chosen while no task ran is.
    await next.open();
    assert.deepEqual([h.state.photo.width, h.state.photo.height], [640, 480]);
    assert.equal(h.detections[1].image, h.state.photo);
    assert.deepEqual(h.state.corners, fallback(640, 480));
    assert.deepEqual(h.statuses.at(-1), FINDING);
    h.running();
    h.detections[1].resolve(found(CHOSEN)); await next.imported; await settle();
    assert.equal(h.status, "Grid found."); assert.deepEqual(h.state.corners, CHOSEN);
    assert.equal(h.reads.length, 0, "the Read that waited for the first photograph's grid went with it");
    assert.deepEqual(h.errors, []); h.ended();
    assert.equal(h.solverEnds, ends, "the opening's task ended before the photograph was taken: no running task was stopped");
    first.detection.resolve(found(STRAY)); await first.imported; await settle();
    assert.deepEqual(h.state.corners, CHOSEN, "the first detection's answer, if it comes now, changes nothing");
  });

// The case #161's confirmer measured: a photograph chosen while a Read waits,
// and Read puzzle tapped while it is decoded. The tap is answered, its promise
// kept with the elapsed time after it, and nothing of the photograph before it
// is read or changed; once the new photograph has opened, the Read is the
// Read tapped then, which waits for its grid: the same reading, board, notes,
// crop, saved session and automatic solve.
test("a Read tapped while a chosen photograph opens reads nothing of the one before it: it is answered, and is the Read tapped as soon as the new one opened, which waits for its grid", async (t) => {
  const outcome = (early) => async (t) => {
    const h = harness(t), s = screen(t, h);
    await h.photograph();
    await h.tapRead();
    const photo = h.state.photo, corners = copy(h.state.corners), next = await h.choose();
    if (early) {
      const tapped = s.mark();
      await h.tapRead();
      assert.deepEqual(h.statuses.at(-1), STILL_OPENING, "the tap is answered");
      await s.until(([text, detail]) => text === STILL_OPENING[0] && TIMED.test(detail), "the promise with the elapsed time after it");
      await h.tapRead();
      const answered = s.since(tapped);
      assert.ok(answered.every(([text, detail]) => text === STILL_OPENING[0] && (detail === PROMISE || TIMED.test(detail))),
        JSON.stringify(answered, null, 1));
      assert.equal(h.reads.length, 0, "nothing is read");
      assert.equal(h.state.photo, photo); assert.deepEqual(h.state.corners, corners, "the crop before it is untouched");
      assert.equal(h.detections.length, 1, "no detection starts");
      h.running();
    }
    await next.open();
    if (!early) await h.tapRead();
    assert.deepEqual(h.statuses.at(-1), [STILL, PROMISE], "the Read waits for the new photograph's grid");
    assert.equal(h.reads.length, 0); h.running();
    h.detections[1].resolve(found(CHOSEN)); await next.imported; await settle();
    leadIn(h, FOUND_LINE);
    assert.equal(h.reads[0]?.image, h.state.photo, "the new photograph is read");
    assert.deepEqual([h.state.photo.width, h.state.photo.height], [640, 480]);
    h.ended();
    return { reads: h.reads.map(({ corners, type, rows, cols }) => ({ corners, type, rows, cols })),
      puzzle: h.state.puzzle, uncertain: sorted(h.state.uncertain), notes: h.state.notes,
      needsReview: h.state.needsReview, corners: h.state.corners, layout: h.state.layout, solves: h.solves,
      errors: h.errors, status: h.statuses.at(-1), session: restoreSession(h.storage) };
  };
  let tapped, waited;
  await t.test("Read tapped as soon as it opened", async (t) => { tapped = await outcome(false)(t); });
  await t.test("Read tapped while it opened", async (t) => { waited = await outcome(true)(t); });
  assert.equal(waited.reads.length, 1);
  assert.deepEqual(waited.reads[0].corners, CHOSEN);
  assert.equal(waited.puzzle.cells[0], 1); assert.deepEqual(waited.uncertain, []);
  assert.equal(waited.solves, 1); assert.equal(waited.status[0], "Puzzle read.");
  assert.deepEqual(waited, tapped);
});

// Find grid, Rotate and the corners would act on the photograph the crop
// editor still shows: each is answered instead, and the new one goes on
// opening and opens as before.
const editorTaps = {
  "Find grid": (h) => h.$("detect-photo").onclick(),
  Rotate: (h) => h.$("rotate-photo").onclick(),
  "a corner moved with the pointer"(h) {
    const crop = h.$("crop-canvas"), [corner] = GRID;
    crop.onpointerdown({ clientX: corner.x, clientY: corner.y, pointerId: 1, preventDefault() {} });
    crop.onpointermove({ clientX: corner.x + 20, clientY: corner.y + 10 }); crop.onpointerup();
  },
  "a corner moved with the keyboard"(h) {
    const crop = h.$("crop-canvas");
    crop.onkeydown({ key: "3", preventDefault() {} });
    crop.onkeydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
  },
};
for (const [what, tap] of Object.entries(editorTaps))
  test(`${what} tapped while a chosen photograph opens is answered and leaves the photograph before it as it is; the new one opens as before`, async (t) => {
    const h = harness(t), before = await inEditor(h), next = await h.choose(), cancels = h.cancels;
    h.running();
    await tap(h); await settle();
    assert.deepEqual(h.statuses.at(-1), OPENING_EDITOR, "the tap is answered");
    assert.equal(h.state.photo, before.photo); assert.deepEqual([before.photo.width, before.photo.height], [800, 600]);
    assert.deepEqual(h.state.corners, before.corners, "its crop is untouched");
    assert.deepEqual(h.state.layout, before.layout);
    assert.equal(h.detections.length, 1, "no detection starts"); assert.equal(h.cancels, cancels, "nothing is stopped");
    assert.equal(h.reads.length, 0); h.running();
    await next.open();
    assert.deepEqual([h.state.photo.width, h.state.photo.height], [640, 480]);
    assert.deepEqual(h.state.corners, fallback(640, 480)); assert.deepEqual(h.statuses.at(-1), FINDING);
    h.detections[1].resolve(found(CHOSEN)); await next.imported; await settle();
    assert.equal(h.status, "Grid found."); assert.deepEqual(h.state.corners, CHOSEN);
    assert.equal(h.reads.length, 0); assert.deepEqual(h.errors, []); h.ended();
    assert.equal(h.solverEnds, 0, "no running task was stopped");
  });

// Hide photo drops a Read waiting for a photograph being opened, as it drops
// one waiting for a grid: the opening's own line comes back, then its elapsed
// time alone, and the photograph opens and shows the crop editor as before.
test("Hide photo while a chosen photograph opens drops a Read waiting for it: the opening's own line comes back, and the photograph opens as before, without a Read", async (t) => {
  const h = harness(t), s = screen(t, h);
  await inEditor(h);
  const next = await h.choose();
  await h.tapRead();
  assert.deepEqual(h.statuses.at(-1), STILL_OPENING);
  await s.until(([text, detail]) => text === STILL_OPENING[0] && TIMED.test(detail), "the promise with the elapsed time after it");
  const hidden = s.mark();
  h.$("hide-photo").onclick();
  assert.equal(h.$("photo-panel").hidden, true);
  assert.deepEqual(h.statuses.at(-1), OPENING, "the opening's own line, at once");
  await s.until(([text, detail]) => text === OPENING[0] && ELAPSED.test(detail), "the opening's elapsed time alone");
  noPromise(s.since(hidden)); h.running();
  await next.open();
  assert.equal(h.$("photo-panel").hidden, false, "the new photograph shows the crop editor, as before");
  assert.deepEqual(h.statuses.at(-1), FINDING, "no Read waits for its grid");
  h.detections[1].resolve(found(CHOSEN)); await next.imported; await settle();
  assert.equal(h.status, "Grid found."); assert.equal(h.reads.length, 0); h.ended();
});

// Whatever stops the opening drops the photograph, and the line says so: a
// stop or task with a status of its own keeps that one; one without (a Play
// cell, a change of editing tool, any other task stop without a message)
// leaves "Stopped." over "The new photo was not opened." at once, before the
// page paints, though the decode itself cannot be stopped, also in place of
// the promise of a Read that waited for the photograph. The photograph before
// it stays in the crop editor, and a Read then reads it at once.
const openingStops = {
  Stop: [(h) => h.stop(), ["Stopped.", UNFINISHED]],
  "an edit": [(h) => h.tasks.stop("Stopped for editing."), ["Stopped for editing.", UNFINISHED]],
  "a cell selected with the Cages tool": [(h) => tapCell(h, "cage", 5), ["1 cells selected.", "Enter the target and save the cage."]],
  "the camera": [(h) => h.$("camera").onclick(), ["Camera ready.", "Hold a clear grid steady; the shutter saves the view."]],
  "a Play cell opened": [(h) => { tapCell(h, "play", 5); assert.equal(h.$("cell-dialog").open, true); }, OPEN_DROPPED],
  "a change of editing tool": [(h) => { appHandlers(h); h.$("edit-tool").value = "play"; h.$("edit-tool").onchange(); }, OPEN_DROPPED],
  "a task stop without a message": [(h) => h.tasks.stop(), OPEN_DROPPED],
};
for (const [what, [stop, line]] of Object.entries(openingStops))
  for (const read of [false, true])
    test(`${what} while a chosen photograph opens${read ? ", with a Read waiting for it," : ""} drops it, and ${line === OPEN_DROPPED ? 'leaves "Stopped." over "The new photo was not opened." at once' : "its own line stays"}; a Read then reads the photograph before it`, async (t) => {
      const h = harness(t), s = screen(t, h), before = await inEditor(h), next = await h.choose();
      h.running();
      if (read) { await h.tapRead(); assert.deepEqual(h.statuses.at(-1), STILL_OPENING); }
      const stopped = s.mark();
      await stop(h); await settle(); await sleep(50);
      assert.deepEqual(s.now(), line);
      const after = s.since(stopped);
      noPromise(after);
      if (line === OPEN_DROPPED) assert.deepEqual(after, [OPEN_DROPPED], "painted after the stop: this line alone");
      else assert.ok(!after.some(([text, detail]) => text === OPEN_DROPPED[0] && detail === OPEN_DROPPED[1]), JSON.stringify(after, null, 1));
      h.ended();
      assert.equal(h.solverEnds, 0, "the opening used no solver: the page's warm one stays");
      // The decode ends; the photograph is not taken, and the line stays.
      next.release(); await next.imported; await settle();
      assert.equal(h.state.photo, before.photo, "the photograph before it stays");
      assert.deepEqual(h.state.corners, before.corners);
      assert.equal(h.detections.length, 1, "the chosen photograph's grid is not searched");
      assert.deepEqual(s.now(), line);
      assert.equal(h.reads.length, 0); assert.deepEqual(h.errors, []);
      if (what === "the camera") return; // It covers the page.
      await h.tapRead(); await settle();
      assert.equal(h.reads.length, 1, "read at once"); assert.equal(h.reads[0].image, before.photo);
      assert.deepEqual(h.reads[0].corners, before.corners);
      assert.equal(h.status, "Puzzle read."); h.ended();
    });

// Another photograph chosen while the first opens is a stop with a status of
// its own: its own opening line, never the line that says the first was not
// opened, and a Read that waited for the first goes with it. Its decode waits
// for the first's, which the browser cannot stop (photo-detail.js).
test("another photograph chosen while the first opens drops the first: the second's own line, never the first's drop, and the second opens", async (t) => {
  const h = harness(t), s = screen(t, h), before = await inEditor(h), first = await h.choose();
  await h.tapRead();
  const chosen = s.mark(), second = await h.choose({ width: 480, height: 640, queued: true });
  assert.deepEqual(h.statuses.at(-1), OPENING); h.running();
  await settle(); await sleep(50);
  first.release(); await first.imported; await second.decoding();
  assert.equal(h.state.photo, before.photo, "the first chosen photograph is not taken");
  await second.open();
  assert.deepEqual([h.state.photo.width, h.state.photo.height], [480, 640]);
  assert.deepEqual(h.statuses.at(-1), FINDING, "no Read waits for its grid");
  const painted = s.since(chosen);
  assert.ok(!painted.some(([text, detail]) => text === OPEN_DROPPED[0] && detail === OPEN_DROPPED[1]), JSON.stringify(painted, null, 1));
  noPromise(painted);
  h.detections[1].resolve(found(fallback(480, 640))); await second.imported; await settle();
  assert.equal(h.status, "Grid found."); assert.equal(h.reads.length, 0); assert.deepEqual(h.errors, []); h.ended();
  assert.equal(h.solverEnds, 0, "the first opening used no solver: the page's warm one stays");
});

// A photograph that cannot be decoded ends its opening with the failure's own
// line, and a Read that waited for it reads nothing: a Read then reads the
// photograph before it.
test("a chosen photograph that cannot be decoded ends its opening with the failure, and a Read that waited for it reads nothing", async (t) => {
  const h = harness(t, { failLine: true }), before = await inEditor(h), next = await h.choose();
  await h.tapRead();
  assert.deepEqual(h.statuses.at(-1), STILL_OPENING);
  next.fail(Error("The source image cannot be decoded.")); await next.imported; await settle();
  assert.deepEqual(h.errors, ["The source image cannot be decoded."]);
  assert.deepEqual(h.statuses.at(-1), ["The source image cannot be decoded.", "Nothing was uploaded or sent to a remote solver."]);
  h.ended(); assert.equal(h.reads.length, 0);
  assert.equal(h.state.photo, before.photo); assert.deepEqual(h.state.corners, before.corners);
  await h.tapRead(); await settle();
  assert.equal(h.reads.length, 1); assert.equal(h.reads[0].image, before.photo);
  assert.equal(h.status, "Puzzle read."); h.ended();
});

// The other ways a new picture arrives have no such window: a picture taken
// without a reading and handed to the crop editor, and the photograph Rotate
// makes of the one shown, are pictures already, so their grid is searched
// from the tap itself, and a Read tapped then waits for it (above). The app
// takes no file by drag and drop or paste.
test("a picture handed from the camera to the crop editor, and the photograph Rotate makes, have their grid searched from the tap itself", async (t) => {
  const h = harness(t), before = await inEditor(h);
  h.$("rotate-photo").onclick();
  assert.equal(h.detections.length, 2, "in the tap itself"); assert.equal(h.detections[1].image, h.state.photo);
  assert.notEqual(h.state.photo, before.photo); assert.deepEqual(h.statuses.at(-1), FINDING); h.running();
  h.detections[1].resolve(found(TURNED)); await settle();
  await h.capture({ corners: null, found: null }, { handOver: false });
  h.$("use-live-capture").onclick();
  assert.equal(h.detections.length, 3, "in the tap itself"); assert.equal(h.detections[2].image, h.state.photo);
  assert.deepEqual(h.state.corners, fallback(800, 600)); assert.deepEqual(h.statuses.at(-1), FINDING); h.running();
  h.detections[2].resolve(found()); await settle();
  assert.equal(h.status, "Grid found."); h.ended();
});

// The page itself hands the photo flow the task controller's keep.
test("app.js gives the photo flow the task controller's keep", () => {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /setupPhotoFlow\(\{[^]*?\bkeepDetail: \(detail\) => tasks\.keep\(detail\),[^]*?\}\);/);
});

// And tells it whenever the task controller stops a task: app.js's onStop,
// run as it is, ends the page's warm solver when a running task is stopped,
// unless that task was a photograph being opened, which used none.
test("app.js tells the photo flow when a task stops, and keeps the warm solver when that task was a photograph being opened", () => {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /const \{ stopCamera, taskStopped \} = setupPhotoFlow\(\{/);
  const rest = app.slice(Math.max(0, app.indexOf("onStop: (wasBusy) => {"))), end = rest.search(/\r?\n  \},\r?\n\}\);/);
  assert.ok(rest.startsWith("onStop: (wasBusy) => {") && end > 0, "app.js has the task controller's onStop, its last option");
  const onStop = rest.slice("onStop: ".length, end) + "\n}";
  const outcome = (busy, opening) => {
    const calls = [], worker = { terminate() { calls.push("terminate"); } };
    const context = vm.createContext({ cancelSolver: null, worker, state: { solverWarm: true },
      stopCamera() { calls.push("stopCamera"); }, taskStopped() { calls.push("taskStopped"); return opening; } });
    vm.runInContext(`(${onStop})(${busy})`, context);
    return { calls, warm: context.worker === worker && context.state.solverWarm };
  };
  assert.deepEqual(outcome(true, false), { calls: ["stopCamera", "taskStopped", "terminate"], warm: false }, "a running task's stop ends it");
  assert.deepEqual(outcome(true, true), { calls: ["stopCamera", "taskStopped"], warm: true }, "a photograph's opening stopped leaves it");
  assert.deepEqual(outcome(false, false), { calls: ["stopCamera", "taskStopped"], warm: true }, "a stop with no task running leaves it");
});
