import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { restoreSession, saveSession } from "../session.js";
import { boxShape, conflicts, fitPlay, makePuzzle } from "../model.js";
import { confidentDigits, turnCue } from "../turn-cues.js";
import { turnedPage } from "../live-session.js";
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
// reading gets its own review back under a note that the page may still be
// turned; stopped or failed, the check leaves the highlight and the note. A
// grid that is not square is never turned by a reading: its capture keeps its
// own review under a note that points to Rotate. A capture without a reading
// goes to the crop editor, whose status repeats the turn the live help line
// named, and each Read of its picture that leaves it the way it lies, a Read
// that waited for its grid or one tapped later, says the turn in a first note.
// A cage puzzle's capture gets the same notes.

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

// The live help line's turn (turnedPage) is the still check's cue with more
// confident digits needed for a half turn, so every reading whose help line
// names a turn shows the cue the handoff goes by, the same turn: random 4 × 4
// to 9 × 9 readings of 6 to 20 value regions, any glyph shapes and confidence.
test("every reading the help line names a turn for shows the still check's cue for the same turn", () => {
  let seed = 7;
  const random = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const counts = { sideways: 0, "upside-down": 0, cueOnly: 0 };
  for (let n = 0; n < 20000; n++) {
    const size = 4 + Math.floor(random() * 6), regions = 6 + Math.floor(random() * 15), cells = new Set();
    while (cells.size < Math.min(regions, size * size)) cells.add(Math.floor(random() * size * size));
    // Half the readings have no digit with a 2, 3 or 5 at all.
    const digits = {}, flagged = [], wide = random() < 0.4, plain = random() < 0.5;
    for (const cell of cells) {
      digits[cell] = random() < 0.1 ? null : plain ? [1, 4, 6, 7, 8, 9, 11][Math.floor(random() * 7)] : 1 + Math.floor(random() * size);
      if (random() < 0.6) flagged.push(cell);
    }
    const found = reading({ digits, flagged, rows: size, cols: size, type: "latinsquare",
      size: wide ? [20 + random() * 10, 25 + random() * 10] : [30, 15 + random() * 20] });
    const turn = turnedPage(found), cue = turnCue(found);
    if (turn) {
      counts[turn]++;
      assert.equal(cue, turn === "sideways" ? "quarter" : "half", JSON.stringify(digits));
    } else if (cue) counts.cueOnly++;
  }
  // Each kind occurs, and the cue alone (a half turn from fewer digits).
  assert.ok(counts.sideways > 1000 && counts["upside-down"] > 1000 && counts.cueOnly > 1000, JSON.stringify(counts));
});

// `progress: false`: the still's reader reports no progress before it answers,
// so the status shown is the handoff's own. `detect(canvas)` answers the
// crop editor's grid detection (by default it fails).
function harness(t, { type = "sudoku", progress = true, detect = null } = {}) {
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
    detect: async (image) => { if (!detect) throw Error("no detection here"); return detect(image); },
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
    // A capture without a reading (no fresh verified frame), taken while the
    // help line named `turn` (live-camera.js capture), taken to the crop
    // editor; its grid detection has run once this returns, unless it waits,
    // with the errors `failures` reported.
    async still(turn, failures = []) {
      capture = { photo: canvas(), annotated: canvas(), found: null, corners: null, createdAt: 1, frozen: false, turn };
      await $("camera").onclick(); $("take-photo").onclick(); await tick();
      assert.equal($("use-live-capture").textContent, "Crop and read in the editor");
      $("use-live-capture").onclick(); await settle();
      assert.deepEqual(errors, failures);
      assert.equal(state.photo, capture.photo);
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
// digit its rules see twice (the numbrix below repeats four), with its notes,
// after `first` when given; in the editor and in the saved session.
function ownReview(h, found, first = null) {
  const review = sorted(new Set([...found.cellUncertain, ...conflicts(found.puzzle)])),
    notes = first ? [first, ...found.notes] : found.notes;
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
  assert.deepEqual(sorted(h.state.uncertain), review); assert.deepEqual(h.state.notes, notes);
  assert.equal(h.state.needsReview, true);
  const reloaded = restoreSession(h.storage);
  assert.deepEqual(sorted(reloaded.uncertain), review); assert.deepEqual(reloaded.notes, notes);
  assert.equal(reloaded.needsReview, true);
}
// The first note of a capture whose still reads the way it lies (no
// highlight), and of a capture of a grid that is not square whose reading
// looks turned (no check): each points to Rotate, since Read puzzle turned
// the page no further or never turns it.
const LIES = (turn) => `The live reading suggested that the page may be ${turn}, but the check kept the captured picture the way it lies. If its numbers do not stand upright, Adjust scan → Rotate until they do, then Read puzzle.`;
const ROTATE = (turn) => `The page may be ${turn} in the captured picture, and Read puzzle turns only square grids. If its numbers do not stand upright, Adjust scan → Rotate until they do, then Read puzzle.`;

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

// The highlight goes with the check, as after a photograph's Read the way it
// lies, but the page may still be turned (the still's half-turn rule cannot
// turn every upside-down page), so a first note says how to turn it: Read
// puzzle has just declined to, so with Rotate, then Read puzzle.
for (const [how, live, cue, words] of [["upside down", upsideDown, "half", "upside down"], ["sideways", sideways, "quarter", "sideways"]])
  test(`a capture read ${how} whose picture reads the way it lies gets its own review back under a note that points to Rotate, and the check's task ends`, async (t) => {
    const h = harness(t), found = live(), answer = h.answer();
    await h.review(found);
    assert.equal(h.reads.length, 1);
    markedForTurn(h, found, cue);
    answer.resolve(stillAsItLies());
    await settle();
    assert.deepEqual(h.errors, []);
    ownReview(h, found, LIES(words));
    assert.deepEqual(h.state.history.length, 1);
    assert.deepEqual(h.state.corners, h.corners);
    assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
    assert.deepEqual(h.solves, []);
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

// A 6 × 7 numbrix read with the clues of `digits`, `flagged` read without
// confidence and glyphs of `size` ([height, width]).
const numbrix = (digits, flagged, size) => reading({ digits, flagged, size, rows: 6, cols: 7, type: "numbrix" });
// Twelve regions, four read with confidence (a 1, an 8, a 9 and a 1), none
// with a 2, 3 or 5.
const NUMBRIX = { 0: 1, 1: 8, 2: 9, 3: 9, 4: 4, 5: 4, 6: null, 7: 7, 8: 1, 9: 6, 10: null, 11: 7 };
const unchecked = {
  "an upright reading": () => upright(),
  // One of three regions confident: poor, but too few glyphs to measure.
  "a reading too poor to show its glyphs": () => {
    const found = reading({ digits: { 0: 1, 10: 8, 20: 9 }, flagged: [10, 20] });
    assert.ok(confidentDigits(found) < 3 / 2, "poor enough for its glyphs to be measured");
    return found;
  },
  // The same numbrix with a confident 2: the way up shows.
  "a grid that is not square, read upright": () => {
    const found = numbrix({ ...NUMBRIX, 2: 2 }, [4, 5, 7, 8, 9, 11]);
    assert.equal(turnCue(found), null);
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

// A reading never turns a grid that is not square (Scanner.read), so such a
// capture is not read again and keeps its own review, without the highlight;
// when its reading shows either cue, the live help line's or the still
// check's, a first note says that Read puzzle cannot turn it and points to
// Rotate, before Read puzzle.
const notSquare = {
  // Five confident numbers (1, 8, 9, 9 and 11), none with a 2, 3 or 5: the
  // help line's cue too (HALF_TURN_BAR).
  "upside down": [() => numbrix({ ...NUMBRIX, 6: 11 }, [4, 5, 7, 8, 9, 11]), "half", "upside-down"],
  // Glyphs wider than tall, two of twelve regions confident.
  sideways: [() => numbrix(NUMBRIX, [2, 3, 4, 5, 7, 8, 9, 11], [20, 30]), "quarter", "sideways"],
  // Four confident digits: the still check's cue, too few for the help line.
  "upside down by the still check's cue alone": [() => numbrix(NUMBRIX, [4, 5, 7, 8, 9, 11]), "half", null],
};
for (const [how, [live, cue, help]] of Object.entries(notSquare))
  test(`a capture of a grid that is not square read ${how} keeps its own review under a note that points to Rotate, without reading its picture again`, async (t) => {
    const h = harness(t, { type: "numbrix" }), found = live();
    assert.equal(turnCue(found), cue); assert.equal(turnedPage(found), help);
    await h.review(found);
    assert.equal(h.reads.length, 0, "not read again: Read puzzle cannot turn it");
    ownReview(h, found, ROTATE(cue === "half" ? "upside down" : "sideways"));
    assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
    h.ended();
  });

// A capture without a reading goes to the crop editor. The status that ends
// each detection repeats the turn the help line named as it was taken, with
// the way to check it at the size a Read then reads at (the size detected, or
// the controls' when no grid is found): Read puzzle on a square grid, Rotate
// first on any other. The status that starts a detection says it too (below):
// alone on the fallback crop a new photograph starts on, where a Read tapped
// meanwhile waits for the grid and reads at the size found, and with the check
// for the controls' size on a crop a detection set. A detection run again on
// the photograph (Find grid) says it again; Rotate makes a new photograph,
// which keeps none.
const DETECTED = (rows, cols) => `Detected ${rows} × ${cols}. Check the corners, then read the puzzle.`;
const detection = (rows, cols) => () => ({ confidence: 0.95, rows, cols,
  corners: [{ x: 10, y: 10 }, { x: 590, y: 10 }, { x: 590, y: 590 }, { x: 10, y: 590 }] });
for (const [turn, words] of [["upside-down", "upside down"], ["sideways", "sideways"]]) {
  test(`a capture without a reading taken while the help line said the grid looks ${words} keeps that turn in the crop editor of a square grid`, async (t) => {
    const h = harness(t, { detect: detection(9, 9) });
    await h.still(turn);
    assert.equal(h.statuses.at(-1), "Grid found.");
    assert.equal(h.details.at(-1), `${DETECTED(9, 9)} The grid looked ${words} in the live view; Read puzzle checks which way up it is.`);
    assert.equal(h.reads.length, 0, "nothing is read before Read puzzle");
    await h.$("detect-photo").onclick();
    assert.equal(h.details.at(-1), `${DETECTED(9, 9)} The grid looked ${words} in the live view; Read puzzle checks which way up it is.`, "Find grid says it again");
    const captured = h.state.photo;
    h.$("rotate-photo").onclick(); await settle();
    assert.notEqual(h.state.photo, captured, "Rotate makes a new photograph");
    assert.equal(h.statuses.at(-1), "Grid found.");
    assert.equal(h.details.at(-1), DETECTED(9, 9), "a rotated photograph keeps no turn");
  });
  test(`a capture without a reading taken while the help line said the grid looks ${words} points to Rotate in the crop editor of a grid that is not square`, async (t) => {
    const h = harness(t, { type: "numbrix", detect: detection(6, 7) });
    await h.still(turn);
    assert.deepEqual(["rows", "cols"].map((id) => h.$(id).value), ["6", "7"]);
    assert.equal(h.details.at(-1), `${DETECTED(6, 7)} The grid looked ${words} in the live view, and Read puzzle turns only square grids: Rotate until its numbers stand upright, then Read puzzle.`);
  });
}
test("a capture without a reading whose help line named no turn says nothing of one in the crop editor", async (t) => {
  const h = harness(t, { detect: detection(9, 9) });
  await h.still(null);
  assert.deepEqual(h.details.slice(h.statuses.indexOf("Finding the grid…")), ["Photo processing stays on this device.", DETECTED(9, 9)]);
});
const READ_HINT = (words) => `The grid looked ${words} in the live view; Read puzzle checks which way up it is.`;
const ROTATE_HINT = (words) => `The grid looked ${words} in the live view, and Read puzzle turns only square grids: Rotate until its numbers stand upright, then Read puzzle.`;
// The controls before the capture: the harness's 9 × 9 Sudoku, or a 6 × 7
// numbrix, with the hint each gets.
const CONTROLS = [["sudoku", 9, 9, READ_HINT], ["numbrix", 6, 7, ROTATE_HINT]];
function sized(t, type, rows, cols, detect) {
  const h = harness(t, { type, detect });
  h.$("rows").value = String(rows); h.$("cols").value = String(cols);
  return h;
}
// A grid the detector does not find leaves the controls' size, which Read
// puzzle reads at, to tell a square grid. Such a detection reports 0 × 0,
// which would count as square, so only the 6 × 7 controls tell its size from
// theirs.
const NOT_FOUND = () => ({ confidence: 0.4, rows: 0, cols: 0,
  corners: [{ x: 48, y: 48 }, { x: 552, y: 48 }, { x: 552, y: 552 }, { x: 48, y: 552 }] });
for (const [type, rows, cols, hint] of CONTROLS)
  test(`a capture without a reading whose grid is not found gets the turn for the size the controls hold: ${rows} × ${cols}`, async (t) => {
    const h = sized(t, type, rows, cols, NOT_FOUND);
    await h.still("sideways");
    assert.deepEqual(["rows", "cols"].map((id) => h.$(id).value), [String(rows), String(cols)], "the controls keep their size");
    assert.equal(h.statuses.at(-1), "Set the four crop corners.");
    assert.equal(h.details.at(-1), `Drag the numbered handles. Set rows and columns in Grid size & settings. ${hint("sideways")}`);
  });
// The hint for a grid of `rows` × `cols`.
const hintFor = (rows, cols) => (rows === cols ? READ_HINT : ROTATE_HINT);
const STILL_FINDING = ["Still finding the grid…", "The puzzle is read as soon as the grid is found."];
// A Read tapped while the capture's grid is being found waits for it
// (photo-read-waits.test.js): answered with "Still finding the grid…", which
// names no turn, nothing read, the detection's task still running. Returns
// where the statuses after that answer start, and the Read's reply.
async function waitingRead(h) {
  const reply = h.answer();
  h.$("read-photo").onclick(); await settle();
  assert.deepEqual([h.statuses.at(-1), h.details.at(-1)], STILL_FINDING, "the answer names no turn");
  assert.deepEqual(h.reads, [], "the Read waits for the grid");
  h.running();
  return { from: h.statuses.length, reply };
}
// The turn alone, without a check.
const TURN_ONLY = (words) => `The grid looked ${words} in the live view.`;
// The first note of a Read that leaves the picture of a capture without a
// reading the way it lies when its help line named a turn: on a square grid,
// Read puzzle checked which way up it is; on any other, Read puzzle turns none,
// and the note is the capture's Rotate note (ROTATE, above).
const KEPT = (words) => `The live view suggested that the page may be ${words}, but Read puzzle's check kept the captured picture the way it lies. If its numbers do not stand upright, Adjust scan → Rotate until they do, then Read puzzle.`;
const noteFor = (rows, cols) => (rows === cols ? KEPT : ROTATE);
const UNCONFIRMED = "The grid was not found automatically and the crop corners were not adjusted, so every cell is highlighted. Set the corners on the grid and read again, or check each cell against the photograph.";
// What Read puzzle answers for the picture read the way it lies (no turns) at
// `rows` × `cols`: four clues, two of them flagged, with the reading's own
// note; `clean`: none flagged, no note, nothing to review.
function asItLies(type, rows, cols, clean = false) {
  const found = reading({ digits: { 0: 1, 1: 6, 2: 4, 3: 5 }, flagged: clean ? [] : [2, 3], rows, cols, type });
  return clean ? { ...found, notes: [], needsReview: false } : found;
}
// The board after such a Read: `first` (none: null) before the note of a crop
// nobody confirmed (`unconfirmed`, whose Read highlights every cell) and the
// reading's own notes, with the reading's flags and nothing else, in the
// editor and the saved session; the Read's task ended.
function readWithNote(h, found, first, { unconfirmed = false } = {}) {
  const notes = [...(first ? [first] : []), ...(unconfirmed ? [UNCONFIRMED] : []), ...found.notes],
    flagged = unconfirmed ? [...found.puzzle.cells.keys()] : sorted(new Set([...found.cellUncertain, ...conflicts(found.puzzle)]));
  assert.deepEqual(h.state.puzzle.cells, found.puzzle.cells);
  assert.deepEqual(h.state.notes, notes);
  assert.deepEqual(sorted(h.state.uncertain), flagged);
  assert.equal(h.state.needsReview, unconfirmed || found.needsReview);
  assert.equal(h.statuses.at(-1), "Puzzle read.");
  const reloaded = restoreSession(h.storage);
  assert.deepEqual(reloaded.notes, notes); assert.deepEqual(sorted(reloaded.uncertain), flagged);
  h.ended();
}
// A Read tapped while the grid is found on the fallback crop waits for it and
// reads at the size it finds, which may be square where the controls' is not,
// or the other way round, so neither the status that starts the detection nor
// the Read's answer names a check: the first says the turn alone, the second
// names none. The status that ends the detection says it with the check for
// the size found; the line that leads into the Read ("Grid found.", "Reading
// the puzzle…") names no turn, since the Read's first progress replaces it
// before it is painted. The Read, leaving the picture the way it lies, says
// the turn in a first note for the size it read at.
const SIZES = [["sudoku", 9, 9, 9, 9], ["numbrix", 6, 7, 6, 7], ["numbrix", 9, 9, 6, 7], ["numbrix", 6, 7, 9, 9]];
for (const [type, rows, cols, foundRows, foundCols] of SIZES)
  test(`a capture without a reading says the turn as its grid is being found, and a Read that waited for it says it in a first note for the size found: ${rows} × ${cols} controls, ${foundRows} × ${foundCols} found`, async (t) => {
    const search = deferred(), h = sized(t, type, rows, cols, () => search.promise);
    await h.still("upside-down");
    assert.equal(h.statuses.at(-1), "Finding the grid…");
    assert.equal(h.details.at(-1), `Photo processing stays on this device. ${TURN_ONLY("upside down")}`,
      "no check before the size a waiting Read reads at is known");
    const { from, reply } = await waitingRead(h);
    search.resolve(detection(foundRows, foundCols)()); await settle();
    assert.deepEqual(h.errors, []);
    // The status that ends the detection, the line that leads into the Read,
    // and the Read's own progress.
    assert.deepEqual(h.statuses.slice(from), ["Grid found.", "Grid found.", "Straightening the photograph…"]);
    assert.deepEqual(h.details.slice(from), [`${DETECTED(foundRows, foundCols)} ${hintFor(foundRows, foundCols)("upside down")}`,
      "Reading the puzzle…", ""]);
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, foundRows, foundCols]]);
    assert.deepEqual(["rows", "cols"].map((id) => h.$(id).value), [String(foundRows), String(foundCols)]);
    const found = asItLies(type, foundRows, foundCols);
    reply.resolve(found); await settle();
    assert.deepEqual(h.errors, []);
    readWithNote(h, found, noteFor(foundRows, foundCols)("upside down"));
  });
// A grid not found, or a detection that fails, leaves the controls' size, so a
// Read that waited for it reads through the crop as it is at that size, every
// cell highlighted, and leaving the picture the way it lies says the turn for
// that size in its first note, before the note on the crop.
const ENDINGS = {
  "finds no grid": [(search) => search.resolve(NOT_FOUND()), []],
  fails: [(search) => search.reject(Error("detector failed")), ["detector failed"]],
};
for (const [how, [end, failures]] of Object.entries(ENDINGS))
  for (const [type, rows, cols] of CONTROLS)
    test(`a Read that waited for a capture's grid says the turn in a first note for the size the controls hold when the detection ${how}: ${rows} × ${cols}`, async (t) => {
      const search = deferred(), h = sized(t, type, rows, cols, () => search.promise);
      await h.still("sideways");
      const { from, reply } = await waitingRead(h);
      end(search); await settle();
      assert.deepEqual(h.errors, failures);
      const lead = h.statuses.indexOf("The grid was not found automatically.", from);
      assert.ok(lead >= from, "the Read is led in through the crop as it is");
      assert.equal(h.details[lead], "Reading the puzzle through the crop as it is, so every cell will be highlighted…");
      assert.equal(h.statuses[lead + 1], "Straightening the photograph…");
      assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, rows, cols]]);
      const found = asItLies(type, rows, cols);
      reply.resolve(found); await settle();
      assert.deepEqual(h.errors, failures);
      readWithNote(h, found, noteFor(rows, cols)("sideways"), { unconfirmed: true });
    });
// A detection that fails reports the failure in place of the status that
// ends it, so the turn was said as it started, alone, since the crop is the
// fallback crop; Find grid on it, still the fallback crop, says it alone again
// as it starts, and with the check once the grid is found.
test("a capture without a reading whose grid detection fails has said the turn as it started, and Find grid says it again", async (t) => {
  let calls = 0;
  const h = harness(t, { detect: () => { if (calls++ === 0) throw Error("detector failed"); return detection(9, 9)(); } });
  await h.still("sideways", ["detector failed"]);
  // The statuses since the handoff (the camera's own come first).
  const from = h.statuses.indexOf("Finding the grid…");
  assert.deepEqual(h.statuses.slice(from), ["Finding the grid…"]);
  assert.deepEqual(h.details.slice(from), [`Photo processing stays on this device. ${TURN_ONLY("sideways")}`]);
  await h.$("detect-photo").onclick();
  assert.deepEqual(h.statuses.slice(from + 1), ["Finding the grid…", "Grid found."]);
  assert.deepEqual(h.details.slice(from + 1), [`Photo processing stays on this device. ${TURN_ONLY("sideways")}`,
    `${DETECTED(9, 9)} ${READ_HINT("sideways")}`]);
});
// Find grid on a crop that a detection set: a Read tapped while it runs stops
// it and reads that crop at once, at the controls' size (photo-read-waits.test.js),
// so the status that starts it says the turn with the check for that size.
for (const [type, rows, cols, hint] of CONTROLS)
  test(`Find grid on a capture's crop that a detection set says the turn with the check for the controls' size, which a Read tapped meanwhile reads at: ${rows} × ${cols}`, async (t) => {
    let again = null;
    const h = sized(t, type, rows, cols, () => again?.promise ?? detection(rows, cols)());
    await h.still("upside-down");
    assert.equal(h.details.at(-1), `${DETECTED(rows, cols)} ${hint("upside down")}`);
    again = deferred();
    void h.$("detect-photo").onclick(); await settle();
    assert.deepEqual([h.statuses.at(-1), h.details.at(-1)],
      ["Finding the grid…", `Photo processing stays on this device. ${hint("upside down")}`]);
    h.answer();
    h.$("read-photo").onclick(); await settle();
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, rows, cols]],
      "read at once, at the size the check was named for");
    assert.equal(h.statuses.at(-1), "Straightening the photograph…");
  });
// So does Find grid on the crop a detection proposed without finding a grid:
// its corners are unconfirmed, but it is no longer the fallback crop, so a Read
// tapped during Find grid stops it and reads at once, at the controls' size.
for (const [type, rows, cols, hint] of CONTROLS)
  test(`Find grid on a capture's crop that a detection proposed without finding a grid says the turn with the check for the controls' size, which a Read tapped meanwhile reads at: ${rows} × ${cols}`, async (t) => {
    let again = null;
    const h = sized(t, type, rows, cols, () => again?.promise ?? NOT_FOUND());
    await h.still("upside-down");
    assert.equal(h.statuses.at(-1), "Set the four crop corners.");
    again = deferred();
    void h.$("detect-photo").onclick(); await settle();
    assert.deepEqual([h.statuses.at(-1), h.details.at(-1)],
      ["Finding the grid…", `Photo processing stays on this device. ${hint("upside down")}`]);
    h.answer();
    h.$("read-photo").onclick(); await settle();
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, rows, cols]],
      "read at once, at the size the check was named for");
  });

// A Read tapped once the detection has ended is the same Read as one that
// waited for it (above): leaving the picture the way it lies, it says the turn
// in a first note for the size it reads at, square or not.
for (const [type, rows, cols] of CONTROLS)
  test(`a Read tapped once a capture's grid was found says the turn in a first note when it leaves the picture the way it lies: ${rows} × ${cols}`, async (t) => {
    const h = sized(t, type, rows, cols, detection(rows, cols));
    await h.still("upside-down");
    h.ended();
    const reply = h.answer(), found = asItLies(type, rows, cols);
    h.$("read-photo").onclick(); await settle();
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, rows, cols]]);
    reply.resolve(found); await settle();
    assert.deepEqual(h.errors, []);
    readWithNote(h, found, noteFor(rows, cols)("upside down"));
  });
// The turn stays with the picture, so each later Read of it (Adjust scan →
// Read puzzle, here after a corner was moved) that leaves it the way it lies
// says the turn again, once.
test("a later Read of a capture's picture that leaves it the way it lies says the turn again, once", async (t) => {
  const h = harness(t, { detect: detection(9, 9) });
  await h.still("sideways");
  for (let read = 0; read < 2; read++) {
    if (read) {
      h.$("show-crop").onclick();
      h.$("crop-canvas").onkeydown({ key: "1", preventDefault() {} });
      h.$("crop-canvas").onkeydown({ key: "ArrowRight", preventDefault() {} });
    }
    const reply = h.answer(), found = asItLies("sudoku", 9, 9);
    h.$("read-photo").onclick(); await settle();
    reply.resolve(found); await settle();
    readWithNote(h, found, KEPT("sideways"));
  }
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.reads[1].corners[0], { x: 11, y: 10 }, "read again through the moved corner");
});
// A Read that turns the picture keeps the turned reading's own notes, which
// name the turn it took (half a turn waits for review; a quarter turn solves
// automatically, as any photograph's), and turns the crop's corners with it.
// A later Read through those corners reads the page upright, and adds no note.
// Once Undo or Find grid has brought back corners in the picture's own frame,
// a Read that leaves it the way it lies says the turn again.
const FOUND_CORNERS = detection(9, 9)().corners;
const BACK = {
  // Undo twice: the later Read, then the turned one, which turned the corners.
  Undo(h) {
    for (let undo = 0; undo < 2; undo++) { h.stopTask(); restoreEdit(h.state, h.state.history.pop()); saveSession(h.storage, h.state); }
  },
  // Corners the detector finds, in the picture's own frame.
  "Find grid": (h) => h.$("detect-photo").onclick(),
};
for (const [turns, turn, words] of [[2, "upside-down", "upside down"], [1, "sideways", "sideways"], [3, "sideways", "sideways"]])
  for (const [back, undo] of Object.entries(BACK))
    test(`a Read that turns a capture's picture by ${turns} quarter turns keeps the turned reading's notes, a later Read through its corners adds none, and after ${back} a Read the way it lies says the turn again`, async (t) => {
      const h = harness(t, { detect: detection(9, 9) });
      await h.still(turn);
      let reply = h.answer();
      h.$("read-photo").onclick(); await settle();
      reply.resolve(turned(turns)); await settle();
      assert.deepEqual(h.errors, []);
      const turnedCorners = FOUND_CORNERS.map((_, i) => FOUND_CORNERS[(i + turns) % 4]);
      assert.deepEqual(h.state.notes, turned(turns).notes, "the turned reading's own notes, which name its turn");
      assert.deepEqual(h.state.corners, turnedCorners);
      assert.equal(h.state.needsReview, turns === 2);
      assert.equal(h.solves.length, turns === 2 ? 0 : 1);
      assert.equal(h.statuses.at(-1), "Puzzle read.");
      reply = h.answer();
      h.$("show-crop").onclick(); h.$("read-photo").onclick(); await settle();
      assert.deepEqual(h.reads.at(-1).corners, turnedCorners);
      const upright = asItLies("sudoku", 9, 9);
      reply.resolve(upright); await settle();
      readWithNote(h, upright, null);
      await undo(h); await settle();
      assert.deepEqual(h.state.corners, FOUND_CORNERS);
      reply = h.answer();
      h.$("read-photo").onclick(); await settle();
      assert.deepEqual(h.reads.at(-1).corners, FOUND_CORNERS);
      const lies = asItLies("sudoku", 9, 9);
      reply.resolve(lies); await settle();
      readWithNote(h, lies, KEPT(words));
    });
// Rotate makes a new photograph, which keeps no turn, and a capture whose help
// line named none carries none: a Read of either adds no note.
test("a Read of a rotated capture's picture adds no note of the turn", async (t) => {
  const h = harness(t, { detect: detection(9, 9) });
  await h.still("upside-down");
  h.$("rotate-photo").onclick(); await settle();
  assert.equal(h.details.at(-1), DETECTED(9, 9));
  const reply = h.answer(), found = asItLies("sudoku", 9, 9);
  h.$("read-photo").onclick(); await settle();
  reply.resolve(found); await settle();
  readWithNote(h, found, null);
});
for (const [type, rows, cols] of CONTROLS)
  test(`a Read of a capture's picture whose help line named no turn adds no note: ${rows} × ${cols}`, async (t) => {
    const h = sized(t, type, rows, cols, detection(rows, cols));
    await h.still(null);
    const reply = h.answer(), found = asItLies(type, rows, cols);
    h.$("read-photo").onclick(); await settle();
    reply.resolve(found); await settle();
    readWithNote(h, found, null);
  });
// A note only: it moves no flag. A reading of the picture the way it lies with
// nothing to review keeps the note first, without a flag, and solves
// automatically as any clean reading does (the app's solve clears the notes),
// or with automatic solving off waits as it is. A reading under review (above)
// shows the note with its review.
for (const autoSolve of [true, false])
  test(`a clean Read of a capture's picture the way it lies moves no flag for the turn and ${autoSolve ? "solves automatically" : "waits, automatic solving off"}`, async (t) => {
    const h = harness(t, { detect: detection(9, 9) });
    h.$("auto-solve").checked = autoSolve;
    await h.still("sideways");
    const reply = h.answer(), found = asItLies("sudoku", 9, 9, true);
    h.$("read-photo").onclick(); await settle();
    reply.resolve(found); await settle();
    readWithNote(h, found, KEPT("sideways"));
    assert.equal(h.solves.length, autoSolve ? 1 : 0);
  });
// The note comes before every other: before the note of a crop nobody
// confirmed (above), the reading's own notes, eight at most, and the note of
// boxes suggested from the grid size, last (a 6 × 6 Sudoku found under the
// 9 × 9 controls). fitReviewNotes keeps the first sixteen, so it keeps the
// first note, and such a Read has at most twelve.
test("the note comes before the reading's own notes and a suggested box layout's note", async (t) => {
  const h = harness(t, { detect: detection(6, 6) });
  await h.still("upside-down");
  assert.deepEqual(["rows", "cols", "box-rows", "box-cols"].map((id) => h.$(id).value), ["6", "6", "2", "3"]);
  const reply = h.answer(), found = { ...asItLies("sudoku", 6, 6), notes: Array.from({ length: 8 }, (_, i) => `Reading note ${i + 1}.`) };
  h.$("read-photo").onclick(); await settle();
  reply.resolve(found); await settle();
  const notes = [KEPT("upside down"), ...found.notes,
    "Box layout 2 rows × 3 columns was suggested from the grid size, not read from the photograph. Confirm it before solving."];
  assert.deepEqual(h.state.notes, notes);
  assert.deepEqual(restoreSession(h.storage).notes, notes);
  assert.equal(h.state.needsReview, true);
});

// A cage puzzle (Killer, KenKen) reads no confident digit, so its capture can
// show only the quarter-turn cue, and seldom does (LIVE_CAMERA.md). When it
// does, its still is read again as a photograph of that type, which Read
// puzzle checks by its sums (Scanner.cageTurn, photo-cage-turn.test.js), under
// the notes any square grid gets; a cage grid is always square, so neither
// note for a grid that is not square applies. Without a reading, its crop
// editor says that Read puzzle checks the turn the help line named, and a Read
// that keeps the picture the way it lies says the turn first. Only controls
// left at a size that is not square, with no grid found, give the Rotate hint,
// and Read puzzle refuses that size for the type.
for (const type of ["killersudoku", "kenken"]) {
  test(`a ${type} capture whose reading looks sideways is read again as a ${type} photograph, and read as it lies gets the note that points to Rotate`, async (t) => {
    const h = harness(t, { type }), answer = h.answer(),
      found = reading({ digits: UPSIDE_DOWN, flagged: Object.keys(UPSIDE_DOWN).map(Number), size: [20, 30], type });
    assert.equal(confidentDigits(found), 0); assert.equal(turnCue(found), "quarter");
    await h.review(found);
    assert.deepEqual(sorted(h.state.uncertain), sorted(found.entries.map((entry) => entry.cell)));
    assert.equal(h.state.notes[0], "The page may be sideways in the captured picture, so every digit read is highlighted. Adjust scan → Read puzzle checks which way up it is.");
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, 9, 9]]);
    answer.resolve({ ...found, needsReview: true });
    await settle();
    ownReview(h, found, LIES("sideways"));
    assert.equal(h.statuses.at(-1), "Captured clues ready for review.");
    h.ended();
  });
  test(`a ${type} capture without a reading taken while the help line said the grid looks sideways says that Read puzzle checks it, and a Read that keeps it the way it lies says the turn first`, async (t) => {
    const h = harness(t, { type, detect: detection(9, 9) });
    await h.still("sideways");
    assert.equal(h.details.at(-1), `${DETECTED(9, 9)} The grid looked sideways in the live view; Read puzzle checks which way up it is.`);
    const reply = h.answer(), found = asItLies(type, 9, 9);
    h.$("read-photo").onclick(); await settle();
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, 9, 9]], "read as a photograph of its type");
    reply.resolve(found); await settle();
    assert.deepEqual(h.errors, []);
    readWithNote(h, found, KEPT("sideways"));
  });
  test(`a ${type} capture without a reading whose grid is not found under 6 × 7 controls gets the Rotate hint, and Read puzzle refuses that size, adding no note`, async (t) => {
    const h = sized(t, type, 6, 7, NOT_FOUND);
    await h.still("sideways");
    assert.equal(h.details.at(-1), `Drag the numbered handles. Set rows and columns in Grid size & settings. ${ROTATE_HINT("sideways")}`);
    const notes = h.state.notes;
    h.answer();
    h.$("read-photo").onclick(); await settle();
    assert.deepEqual(h.errors, ["This type needs a square grid."]);
    assert.deepEqual(h.reads, []);
    assert.equal(h.state.notes, notes);
  });
}

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
