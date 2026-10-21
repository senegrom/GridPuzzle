import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { restoreSession, saveSession } from "../session.js";
import { boxShape, conflicts, fitPlay, makePuzzle } from "../model.js";
import { confidentDigits, turnCue } from "../turn-cues.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";
import { createTaskController } from "../task-controller.js";

// The live camera reads each frame the way it lies (orient: false), so a
// capture of a page held upside down or sideways reaches the editor turned,
// with confident wrong clues: upside down, 6s and 9s read as each other and
// 2s as 4s. When the capture's reading shows what makes Scanner.orient try a
// turn (turnCue), Review captured clues hands it over with every digit
// highlighted under a first note naming the possible turn, and reads the still
// again as Read puzzle reads a photograph: a reading taken turned replaces the
// live one, under review like every capture; read the way it lies, the live
// reading gets its own review back; stopped or failed, the check leaves the
// highlight and the note.

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await tick(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function canvas(width = 600, height = 600) {
  const ctx = new Proxy({}, { get: (o, k) => o[k] ?? (() => {}) });
  return { width, height, getContext: () => ctx, toDataURL: () => "data:image/jpeg;base64,aA==" };
}
function node(id) {
  return { ...canvas(), id, value: "", textContent: "", checked: false, hidden: false, disabled: false, open: false,
    style: {}, dataset: {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, pause() {}, load() {}, async play() {} };
}
const sorted = (cells) => [...cells].sort((a, b) => a - b);

// The value regions of a 9 × 9 reading: `size` gives each glyph's height and
// width, `digits` the digit read in each region (null: unread), and `flagged`
// the regions read without confidence.
function reading({ digits, flagged = [], size = [30, 20], rows = 9, cols = 9, type = "sudoku" }) {
  const puzzle = makePuzzle(type, rows, cols), cells = Object.keys(digits).map(Number);
  for (const cell of cells) puzzle.cells[cell] = digits[cell];
  const uncertain = [...new Set([...flagged, ...cells.filter((cell) => digits[cell] === null)])];
  return { puzzle, entries: cells.map((cell) => ({ kind: "value", cell, text: String(digits[cell] ?? ""),
    confidence: uncertain.includes(cell) ? 40 : 95, h: size[0], w: size[1] })),
  cellUncertain: uncertain, uncertain, cageUncertain: [], blackReadings: [], noteSized: [],
  notes: ["12 cells need checking."], rectified: canvas(300, 300), needsReview: true };
}
// An upside-down page as the live camera reads it: twelve regions, four read
// with confidence (a 1, an 8 and two 9s that are printed 6s), none with a 2, 3
// or 5, glyphs taller than wide.
const UPSIDE_DOWN = { 0: 1, 10: 8, 20: 9, 30: 9, 40: 4, 50: 4, 60: null, 70: 7, 80: 1, 8: 6, 16: null, 24: 7 };
const upsideDown = () => reading({ digits: UPSIDE_DOWN, flagged: [40, 50, 70, 8, 24, 80] });
// A sideways page: glyphs wider than tall, two of twelve regions confident.
const sideways = () => reading({ digits: UPSIDE_DOWN, flagged: [20, 30, 40, 50, 70, 8, 24, 80], size: [20, 30] });
// The same page read upright: confident clues with a 2, 3 or 5.
const upright = () => reading({ digits: { 0: 2, 10: 3, 20: 6, 30: 5, 40: 1, 50: 9, 60: 8, 70: 7, 80: 4, 8: 9, 16: 2, 24: 5 } });

test("the cue: an upside-down reading asks for a half turn, a sideways one for a quarter turn, an upright one for none", () => {
  assert.equal(turnCue(upsideDown()), "half");
  assert.equal(turnCue(sideways()), "quarter");
  assert.equal(turnCue(upright()), null);
  // One confident number with a 2, 3 or 5 shows the way up; no confident
  // digit shows nothing either way.
  assert.equal(turnCue(reading({ digits: { ...UPSIDE_DOWN, 20: 5 }, flagged: [40, 50, 70, 8, 24, 80] })), null);
  assert.equal(turnCue(reading({ digits: UPSIDE_DOWN, flagged: Object.keys(UPSIDE_DOWN).map(Number) })), null);
  // Nor do fewer than six measurable glyphs, however poor the reading: here
  // two of five regions are confident, so the glyphs are measured, and found
  // too few, whether wider or taller than wide.
  for (const size of [[20, 30], [30, 20]]) {
    const few = reading({ digits: { 0: 1, 10: 8, 20: 9, 30: null, 40: null }, flagged: [20], size });
    assert.ok(confidentDigits(few) < 5 / 2, "poor enough for its glyphs to be measured");
    assert.equal(turnCue(few), null);
  }
  assert.equal(turnCue({ puzzle: makePuzzle("sudoku", 9), notes: [] }), null);
});

// `progress: false`: the still's reader reports no progress before it answers,
// so the status shown is the handoff's own.
function harness(t, { type = "sudoku", progress = true } = {}) {
  const globals = ["document", "window", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const nodes = new Map(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
  for (const id of ["scan-diagnostics", "live-diagnostics"])
    $(id).querySelector = (selector) => $(id + "/" + selector.match(/"(.+)"/)[1]);
  globalThis.document = { createElement: () => canvas(), addEventListener() {}, removeEventListener() {},
    body: { classList: { add() {}, remove() {} } } };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) } } });
  const puzzle = makePuzzle("sudoku", 9);
  const state = { puzzle, photo: null, corners: null, uncertain: new Set(), cageUncertain: new Set(), blackReadings: [],
    needsReview: false, notes: [], play: fitPlay(puzzle, []), hints: new Set(), selected: [], history: [] };
  let capture = null, saved, answer = null, flow = null, deadline = null;
  const reads = [], errors = [], statuses = [], details = [], solves = [];
  const status = (text, detail = "") => { statuses.push(text); details.push(detail); };
  // The app's own task controller (app.js): the check is a task like a Read,
  // with Stop shown, Solve, Check and Hint disabled and a deadline armed until
  // it ends. Stopping a task turns the camera off, as in the app.
  const tasks = createTaskController({ $, scanner: { cancel() {} }, status, onStop: () => flow?.stopCamera() });
  const stopTask = (message) => tasks.stop(message);
  const storage = { set: (_key, value) => { saved = value; }, get: () => saved };
  const fields = [["rows", "rows"], ["cols", "cols"], ["boxRows", "box-rows"], ["boxCols", "box-cols"]];
  const setLayout = (layout) => {
    state.layout = Object.fromEntries(fields.map(([key, id]) => { $(id).value = String(layout[key]); return [key, layout[key]]; }));
  };
  setLayout(puzzle); $("puzzle-type").value = type; $("auto-capture").checked = true; $("auto-solve").checked = true;
  flow = setupPhotoFlow({ $, state, scanner: {
    read: (image, corners, readType, rows, cols, onProgress, options = {}) => {
      reads.push({ image, corners, type: readType, rows, cols, options });
      if (progress) onProgress("Straightening the photograph…", null);
      return answer.promise;
    },
    detect: async () => { throw Error("no detection here"); },
  }, stopTask, invalidate: () => stopTask(), begin: () => tasks.begin(), finish: () => tasks.finish(),
  fail: (e) => errors.push(e.message), render() {}, status, remember: () => rememberEdit(state),
  persist: () => saveSession(storage, state), drawBoard() {},
  clearPhotoMapping() { state.rectified = state.photoSource = null; }, solveNow() { solves.push(state.puzzle.cells); },
  boxDefault: boxShape, setLayout, getJobId: () => tasks.id,
  setDeadline: (callback, ms) => { deadline = callback; tasks.setDeadline(callback, ms); },
  savePicture: async () => true,
  liveFactory: () => ({ start() {}, stop() {}, capture: () => capture,
    diagnosticSource: () => ({ image: capture.photo, verified: true }) }) });
  t.after(() => { tasks.stop(); flow.stopCamera(); for (const [key, d] of globals) {
    if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key];
  } });
  const corners = [{ x: 60, y: 50 }, { x: 540, y: 60 }, { x: 550, y: 540 }, { x: 50, y: 550 }];
  return { $, state, reads, errors, statuses, details, solves, storage, corners, stopTask, tasks,
    // The deadline the latest task armed, fired as if it had run out.
    expire: () => deadline(),
    // The still read again answers with `found` (or rejects), when released.
    answer(found) { answer = deferred(); answer.found = found; return answer; },
    async review(found) {
      capture = { photo: canvas(), annotated: canvas(), corners: corners.map((p) => ({ ...p })), createdAt: 1, found };
      await $("camera").onclick(); $("take-photo").onclick(); await tick();
      $("use-live-capture").onclick();
      assert.deepEqual(errors, []);
    },
    // The check is a running task: Stop shown, Solve, Check and Hint disabled.
    running() {
      assert.equal(tasks.busy, true); assert.equal($("stop").hidden, false);
      assert.equal($("solve").disabled, true); assert.equal($("check-play").disabled, true);
      assert.equal($("hint-play").disabled, true);
    },
    // Its task is over (finish or stop also clears its deadline): Stop hidden,
    // Solve, Check and Hint available again.
    ended() {
      assert.equal(tasks.busy, false); assert.equal($("stop").hidden, true);
      assert.equal($("solve").disabled, false); assert.equal($("check-play").disabled, false);
      assert.equal($("hint-play").disabled, false);
    },
  };
}
// The still read again the right way up: the page's clues, clean, and the
// scanner's note naming the turn.
function turned(turns) {
  const found = upright();
  return { ...found, cellUncertain: [], uncertain: [], needsReview: false, turns,
    notes: [turns === 2 ? "The photograph was upside down: its digits read clearly better turned half a turn, so the crop corners were turned with it. Check the clues against the photograph."
      : "The photograph was read turned a quarter turn: check the clues against the photograph."] };
}
const stillAsItLies = () => ({ ...upright(), cellUncertain: [], uncertain: [], needsReview: false });
// The capture's live reading on the board, every value region highlighted (the
// flagged ones and the confident digits alike) under a first note that names
// the turn its cue asks for, before the reading's own notes; in the editor and
// in the saved session.
function markedForTurn(h, found, cue) {
  const regions = sorted(found.entries.map((entry) => entry.cell));
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
  assert.ok(found.entries.some((entry) => !found.cellUncertain.includes(entry.cell)), "the reading has confident digits");
  assert.deepEqual(sorted(h.state.uncertain), regions);
  assert.match(h.state.notes[0], new RegExp(`^The page may be ${cue === "half" ? "upside down" : "sideways"} in the captured picture, so every digit read is highlighted\\. Adjust scan → Read puzzle checks which way up it is\\.$`));
  assert.deepEqual(h.state.notes.slice(1), found.notes);
  assert.equal(h.state.needsReview, true);
  const reloaded = restoreSession(h.storage);
  assert.deepEqual(sorted(reloaded.uncertain), regions); assert.deepEqual(reloaded.notes, h.state.notes);
  assert.equal(reloaded.needsReview, true);
}
// The capture's live reading with its own review: its flagged clues, and any
// digit its rules see twice (the numbrix below repeats four), with its notes.
function ownReview(h, found) {
  const review = sorted(new Set([...found.cellUncertain, ...conflicts(found.puzzle)]));
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
  assert.deepEqual(sorted(h.state.uncertain), review); assert.deepEqual(h.state.notes, found.notes);
  assert.equal(h.state.needsReview, true);
  const reloaded = restoreSession(h.storage);
  assert.deepEqual(sorted(reloaded.uncertain), review); assert.deepEqual(reloaded.notes, found.notes);
}

for (const [how, live, turns, cue] of [["upside down", upsideDown, 2, "half"], ["sideways", sideways, 1, "quarter"], ["sideways", sideways, 3, "quarter"]])
  test(`a capture read ${how} is read again as a photograph, and the reading turned ${turns} replaces it, under review`, async (t) => {
    const h = harness(t), found = live(), answer = h.answer();
    await h.review(found);
    // The live reading is on the board while its picture is read again, every
    // digit highlighted under the note that the page may be turned.
    markedForTurn(h, found, cue);
    h.running();
    assert.equal(h.statuses.at(-1), "Checking which way up the captured picture is…");
    assert.equal(h.reads.length, 1);
    const [read] = h.reads;
    assert.equal(read.image, h.state.photo); assert.deepEqual(read.corners, h.corners);
    assert.deepEqual([read.type, read.rows, read.cols], ["sudoku", 9, 9]);
    assert.notEqual(read.options.orient, false, "read as a photograph, orientation and all");
    answer.resolve(turned(turns)); await settle();
    assert.deepEqual(h.errors, []);
    h.ended();
    assert.deepEqual(h.state.puzzle.cells, upright().puzzle.cells);
    assert.deepEqual([h.state.puzzle.boxRows, h.state.puzzle.boxCols], [3, 3]);
    assert.match(h.state.notes[0], turns === 2 ? /upside down/ : /quarter turn/);
    assert.equal(h.state.notes.length, 1, "the turned reading's own notes");
    // Under review like every capture, also after a quarter turn, which a
    // photograph's Read solves automatically.
    assert.equal(h.state.needsReview, true); assert.deepEqual(h.solves, []);
    assert.deepEqual(h.state.corners, h.corners.map((_, i) => h.corners[(i + turns) % 4]));
    assert.equal(h.statuses.at(-1), "Captured clues read again, turned the right way up.");
    assert.equal(restoreSession(h.storage).needsReview, true);
    // Undo brings the live reading back as the board showed it: the check
    // found its page turned, so every digit stays highlighted under the note.
    // (The Undo button stops tasks, restores the edit and saves the session.)
    h.stopTask(); restoreEdit(h.state, h.state.history.pop()); saveSession(h.storage, h.state);
    markedForTurn(h, found, cue);
  });

test("the handoff itself says that the check runs, before the reader reports anything", async (t) => {
  const h = harness(t, { progress: false }), found = upsideDown();
  h.answer();
  await h.review(found);
  assert.equal(h.reads.length, 1);
  assert.equal(h.statuses.at(-1), "Checking which way up the captured picture is…");
  assert.equal(h.details.at(-1), "Its digits may be turned, so every one stays highlighted until the check ends.");
  h.running();
});

test("a capture whose picture reads the way it lies gets its own review back, and the check's task ends", async (t) => {
  const h = harness(t), found = upsideDown(), answer = h.answer();
  await h.review(found);
  assert.equal(h.reads.length, 1);
  markedForTurn(h, found, "half");
  answer.resolve(stillAsItLies());
  await settle();
  assert.deepEqual(h.errors, []);
  ownReview(h, found);
  assert.deepEqual(h.state.history.length, 1);
  assert.deepEqual(h.state.corners, h.corners);
  assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
  h.ended();
});

test("a capture whose check fails keeps every digit highlighted under the turn note, without an error, and the check's task ends", async (t) => {
  const h = harness(t), found = upsideDown(), answer = h.answer();
  await h.review(found);
  answer.reject(Error("No printed clues found. Adjust the crop, dimensions or lighting.")); await settle();
  assert.deepEqual(h.errors, []);
  markedForTurn(h, found, "half");
  assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
  assert.equal(h.details.at(-1), "Which way up the captured picture is could not be checked, so every digit stays highlighted.");
  h.ended();
});

// Opening a cell to edit stops the check (app.js openCell), as do Stop, Undo
// and any other task; Solve, Check and Hint are disabled while it runs.
for (const [how, message] of [["opening a cell to edit", "Stopped for editing."], ["Stop", "Stopped."]])
  test(`a check stopped by ${how} leaves every digit highlighted under the turn note, even if the still then reads turned`, async (t) => {
    const h = harness(t), found = upsideDown(), answer = h.answer();
    await h.review(found);
    h.stopTask(message);
    h.ended();
    answer.resolve(turned(2)); await settle();
    assert.deepEqual(h.errors, []);
    markedForTurn(h, found, "half");
    assert.deepEqual(h.state.corners, h.corners);
    assert.equal(h.statuses.at(-1), message);
  });

test("a check that runs out of time is stopped and leaves every digit highlighted under the turn note", async (t) => {
  const h = harness(t), found = sideways();
  h.answer();
  await h.review(found);
  h.running();
  h.expire();
  h.ended();
  markedForTurn(h, found, "quarter");
  assert.equal(h.statuses.at(-1), "Checking which way up the captured picture is took too long.");
});

const unchecked = {
  "an upright reading": () => upright(),
  // One of three regions confident: poor, but too few glyphs to measure.
  "a reading too poor to show its glyphs": () => {
    const found = reading({ digits: { 0: 1, 10: 8, 20: 9 }, flagged: [10, 20] });
    assert.ok(confidentDigits(found) < 3 / 2, "poor enough for its glyphs to be measured");
    return found;
  },
  "a grid that is not square": () => {
    const found = reading({ digits: { 0: 1, 1: 8, 2: 9, 3: 9, 4: 4, 5: 4, 6: null, 7: 7, 8: 1, 9: 6, 10: null, 11: 7 },
      flagged: [4, 5, 7, 8, 9, 11], rows: 6, cols: 7, type: "numbrix" });
    assert.equal(turnCue(found), "half");
    return found;
  },
};
for (const [what, live] of Object.entries(unchecked))
  test(`a capture of ${what} is handed over as it is, without reading its picture again`, async (t) => {
    const h = harness(t, { type: live().puzzle.type }), found = live();
    await h.review(found);
    assert.equal(h.reads.length, 0);
    ownReview(h, found);
    assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
  });

for (const turns of [0, 2])
  test(`the diagnostic report ${turns ? "takes the turned reading" : "keeps the capture's reading through a check that leaves it"}`, async (t) => {
    const h = harness(t), found = upsideDown(), answer = h.answer();
    await h.review(found);
    answer.resolve(turns ? turned(turns) : stillAsItLies());
    await settle();
    const panel = (key) => h.$("scan-diagnostics/" + key);
    panel("prepare").onclick();
    const report = JSON.parse(panel("preview").textContent);
    assert.equal(report.source, "photo");
    assert.deepEqual(report.lastReading.cells, (turns ? upright() : found).puzzle.cells);
    assert.deepEqual(report.geometry.corners, h.corners);
  });
