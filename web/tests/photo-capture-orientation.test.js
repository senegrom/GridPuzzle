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
// named, and so does the line that leads into a Read that waited for its
// grid. A cage puzzle's capture gets the same notes.

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

// A capture without a reading goes to the crop editor. Its status, while the
// grid is being found and once it is found, repeats the turn the help line
// named as it was taken, with the way to check it at the size the controls
// hold, which Read puzzle reads at (once found, the size detected): Read
// puzzle on a square grid, Rotate first on any other. A detection run again
// on the photograph (Find grid) says it again; Rotate makes a new photograph,
// which keeps none. A Read tapped while the grid is being found waits for it
// (below).
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
// names no turn, nothing read, the detection's task still running.
async function waitingRead(h) {
  h.answer();
  h.$("read-photo").onclick(); await settle();
  assert.deepEqual([h.statuses.at(-1), h.details.at(-1)], STILL_FINDING, "the answer names no turn");
  assert.deepEqual(h.reads, [], "the Read waits for the grid");
  h.running();
  return h.statuses.length;
}
// The status that starts the detection says the turn for the size the
// controls hold. A Read tapped while the grid is found waits for it and reads
// at the size it finds, which may be square where the controls' is not, or
// the other way round, so its answer names no turn, and the line that leads
// into it once the grid is found ("Grid found.", "Reading the puzzle…") says
// the turn for the size found, as the status that ends the detection did.
const SIZES = [["sudoku", 9, 9, 9, 9], ["numbrix", 6, 7, 6, 7], ["numbrix", 9, 9, 6, 7], ["numbrix", 6, 7, 9, 9]];
for (const [type, rows, cols, foundRows, foundCols] of SIZES)
  test(`a capture without a reading says the turn as its grid is being found, and a Read that waited for it says it for the size found: ${rows} × ${cols} controls, ${foundRows} × ${foundCols} found`, async (t) => {
    const search = deferred(), h = sized(t, type, rows, cols, () => search.promise);
    await h.still("upside-down");
    assert.equal(h.statuses.at(-1), "Finding the grid…");
    assert.equal(h.details.at(-1), `Photo processing stays on this device. ${hintFor(rows, cols)("upside down")}`);
    const from = await waitingRead(h), hint = hintFor(foundRows, foundCols)("upside down");
    search.resolve(detection(foundRows, foundCols)()); await settle();
    assert.deepEqual(h.errors, []);
    // The status that ends the detection, the line that leads into the Read,
    // and the Read's own progress.
    assert.deepEqual(h.statuses.slice(from), ["Grid found.", "Grid found.", "Straightening the photograph…"]);
    assert.deepEqual(h.details.slice(from), [`${DETECTED(foundRows, foundCols)} ${hint}`, `Reading the puzzle… ${hint}`, ""]);
    assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, foundRows, foundCols]],
      "read at the size the hint was for");
    assert.deepEqual(["rows", "cols"].map((id) => h.$(id).value), [String(foundRows), String(foundCols)]);
  });
// A grid not found, or a detection that fails, leaves the controls' size, so a
// Read that waited for it reads through the crop as it is at that size, and the
// line that leads into it says the turn for that size.
const ENDINGS = {
  "finds no grid": [(search) => search.resolve(NOT_FOUND()), []],
  fails: [(search) => search.reject(Error("detector failed")), ["detector failed"]],
};
for (const [how, [end, failures]] of Object.entries(ENDINGS))
  for (const [type, rows, cols, hint] of CONTROLS)
    test(`a Read that waited for a capture's grid says the turn for the size the controls hold when the detection ${how}: ${rows} × ${cols}`, async (t) => {
      const search = deferred(), h = sized(t, type, rows, cols, () => search.promise);
      await h.still("sideways");
      const from = await waitingRead(h);
      end(search); await settle();
      assert.deepEqual(h.errors, failures);
      const lead = h.statuses.indexOf("The grid was not found automatically.", from);
      assert.ok(lead >= from, "the Read is led in through the crop as it is");
      assert.equal(h.details[lead], `Reading the puzzle through the crop as it is, so every cell will be highlighted… ${hint("sideways")}`);
      assert.equal(h.statuses[lead + 1], "Straightening the photograph…");
      assert.deepEqual(h.reads.map(({ type, rows, cols }) => [type, rows, cols]), [[type, rows, cols]]);
    });
// A detection that fails reports the failure in place of the status that
// ends it, so the turn was said as it started; Find grid says it again, and
// once the grid is found.
test("a capture without a reading whose grid detection fails has said the turn as it started, and Find grid says it again", async (t) => {
  let calls = 0;
  const h = harness(t, { detect: () => { if (calls++ === 0) throw Error("detector failed"); return detection(9, 9)(); } });
  await h.still("sideways", ["detector failed"]);
  // The statuses since the handoff (the camera's own come first).
  const from = h.statuses.indexOf("Finding the grid…");
  assert.deepEqual(h.statuses.slice(from), ["Finding the grid…"]);
  assert.deepEqual(h.details.slice(from), [`Photo processing stays on this device. ${READ_HINT("sideways")}`]);
  await h.$("detect-photo").onclick();
  assert.deepEqual(h.statuses.slice(from + 1), ["Finding the grid…", "Grid found."]);
  assert.deepEqual(h.details.slice(from + 1), [`Photo processing stays on this device. ${READ_HINT("sideways")}`,
    `${DETECTED(9, 9)} ${READ_HINT("sideways")}`]);
});

// A cage puzzle (Killer, KenKen) reads no confident digit, so its capture can
// show only the quarter-turn cue, and seldom does (LIVE_CAMERA.md). When it
// does, its still is read again as a photograph of that type, which Read
// puzzle checks by its sums (Scanner.cageTurn, photo-cage-turn.test.js), under
// the notes any square grid gets; a cage grid is always square, so neither
// note for a grid that is not square applies. Without a reading, its crop
// editor says that Read puzzle checks the turn the help line named.
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
  test(`a ${type} capture without a reading taken while the help line said the grid looks sideways says that Read puzzle checks it`, async (t) => {
    const h = harness(t, { type, detect: detection(9, 9) });
    await h.still("sideways");
    assert.equal(h.details.at(-1), `${DETECTED(9, 9)} The grid looked sideways in the live view; Read puzzle checks which way up it is.`);
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
