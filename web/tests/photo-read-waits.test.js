import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { restoreSession, saveSession } from "../session.js";
import { boxShape, fitPlay, makePuzzle } from "../model.js";
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
// starts on the fallback crop waits for that one in turn. The flow runs with
// the app's own task controller, so Stop shown and Solve, Check and Hint
// disabled are checked throughout.

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
function harness(t, { type = "latinsquare", layout = { rows: 4, cols: 4, boxRows: 2, boxCols: 2 }, late = false } = {}) {
  const globals = ["document", "window", "navigator", "createImageBitmap"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
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
  let cancels = 0, solves = 0, saved, capture = null, flow = null;
  const status = (text, detail = "") => statuses.push([text, detail]);
  const tasks = createTaskController({ $, status, onStop: () => flow?.stopCamera(),
    scanner: { cancel() { cancels++; if (!late) for (const job of detections) job.reject(aborted()); } } });
  const stopTask = (message) => tasks.stop(message);
  const storage = { set: (_key, value) => { saved = value; }, get: () => saved };
  flow = setupPhotoFlow({ $, state, scanner: {
    detect(image) { const job = deferred(); job.image = image; detections.push(job); return job.promise; },
    async read(image, corners, type, rows, cols, onProgress) {
      reads.push({ image, corners: corners.map((p) => ({ ...p })), type, rows, cols });
      onProgress("Straightening the photograph…", null);
      const reading = makePuzzle(type, rows, cols); reading.cells[0] = 1;
      return { puzzle: reading, cellUncertain: [], uncertain: [], cageUncertain: [], blackReadings: [], needsReview: false,
        notes: [], rectified: canvas(200, 200) };
    },
  }, stopTask, invalidate: () => { stopTask(); status("Puzzle changed.", "Solve again to check the updated clues and rules."); },
  begin: () => tasks.begin(), finish: () => tasks.finish(), fail: (e) => errors.push(e.message), render: noop, status,
  remember: () => rememberEdit(state), persist: () => saveSession(storage, state), drawBoard: noop,
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() { solves++; }, boxDefault: boxShape,
  setLayout, getJobId: () => tasks.id, setDeadline: (callback, ms) => tasks.setDeadline(callback, ms),
  savePicture: async () => true,
  liveFactory: () => ({ start: noop, stop: noop, capture: () => capture,
    diagnosticSource: () => ({ image: capture.photo, verified: true }) }) });
  t.after(() => { tasks.stop(); flow.stopCamera(); for (const [key, d] of globals) {
    if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key];
  } });
  const crop = $("crop-canvas");
  crop.getBoundingClientRect = () => ({ left: 0, top: 0, width: crop.width, height: crop.height });
  crop.setPointerCapture = noop;
  return { $, state, tasks, detections, reads, errors, statuses, storage, canvas, setLayout,
    get cancels() { return cancels; }, get solves() { return solves; },
    get status() { return statuses.at(-1)?.[0]; },
    // A photograph imported from a file; resolves once its grid is being found.
    async photograph() {
      const before = detections.length;
      const imported = $("photo-file").onchange({ target: { files: [png(800, 600)], value: "photo" } });
      for (let i = 0; i < 50 && detections.length === before; i++) await tick();
      assert.equal(detections.length, before + 1, "the photograph's grid is being found");
      assert.deepEqual(state.corners, fallback(state.photo.width, state.photo.height), "shown on the fallback crop");
      return { imported, detection: detections.at(-1) };
    },
    async tapRead() { $("read-photo").onclick(); await tick(); },
    stop: () => stopTask("Stopped."),
    // The camera opened, a picture taken and handed to the editor (with a
    // live reading: reviewed on the board; without one: to the crop editor).
    async capture(picture) {
      capture = { photo: canvas(800, 600), annotated: canvas(800, 600), createdAt: 1, ...picture };
      await $("camera").onclick(); $("take-photo").onclick(); await tick();
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
