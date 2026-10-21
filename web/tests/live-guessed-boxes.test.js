// The live camera on a Sudoku whose size the grid settings are not for: its
// boxes are then guessed from the grid's size (boxShape in model.js), and a
// guess that is not square can be the wrong one, since a 6 × 6 grid's boxes
// are 2 rows × 3 columns or 3 × 2. The solver is given the guess, so the
// camera says so wherever the reading shows a result: in the frozen help, in
// what it says of no or several solutions, and in a note for the editor. The
// production camera, session, tracker and tracking core run on a fake clock
// with a printed n × n grid; the reader returns a Sudoku with one clue, and
// the solver the answer the test gives.
import test from "node:test";
import assert from "node:assert/strict";
import { createLiveCamera } from "../live-camera.js";
import { createLiveTracker } from "../live-tracker.js";
import { createTrackingCore } from "../live-tracking-core.js";
import { makePuzzle } from "../model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const SIZE = 700, GRID = 540, X = 80, Y = 80;
// A printed n × n grid with a different glyph in every cell (bits of its
// index pick the strokes), so that the tracking core tells the cells apart.
function scene(n) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  const rect = (left, top, w, h, value) => {
    for (let yy = Math.max(0, top); yy < Math.min(SIZE, top + h); yy++)
      for (let xx = Math.max(0, left); xx < Math.min(SIZE, left + w); xx++) {
        const at = 4 * (yy * SIZE + xx); data[at] = data[at + 1] = data[at + 2] = value;
      }
  };
  const cell = GRID / n, s = cell / 90;
  for (let i = 0; i <= n; i++) { rect(Math.round(X + i * cell) - 1, Y - 1, 3, GRID + 3, 20); rect(X - 1, Math.round(Y + i * cell) - 1, GRID + 3, 3, 20); }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const k = r * n + c + 1, left = Math.round(X + c * cell + 30 * s), top = Math.round(Y + r * cell + 18 * s);
    rect(left, top, Math.round(6 * s), Math.round(52 * s), 30);
    if (k & 1) rect(left, top, Math.round(28 * s), Math.round(6 * s), 30);
    if (k & 2) rect(left + Math.round(22 * s), top, Math.round(6 * s), Math.round(26 * s), 30);
    if (k & 4) rect(left, top + Math.round(23 * s), Math.round(28 * s), Math.round(6 * s), 30);
    if (k & 8) rect(left + Math.round(22 * s), top + Math.round(26 * s), Math.round(6 * s), Math.round(26 * s), 30);
    if (k & 16) rect(left, top + Math.round(46 * s), Math.round(28 * s), Math.round(6 * s), 30);
    if (k & 32) rect(left + Math.round(10 * s), top + Math.round(10 * s), Math.round(8 * s), Math.round(8 * s), 30);
  }
  return { width: SIZE, height: SIZE, data };
}
// The default grid settings: Sudoku is chosen here, 9 × 9 with 3 × 3 boxes.
const NINE = { type: "sudoku", rows: 9, cols: 9, boxRows: 3, boxCols: 3, enabled: true, autoSolve: true };
function live(t, { n = 6, settings = NINE, answer = "unique" } = {}) {
  let time = 0, serial = 0;
  const timers = new Map(), nodes = new Map(), writes = [], solved = [], picture = scene(n);
  const setTimer = (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; };
  const clearTimer = (id) => { timers.delete(id); };
  function canvas() {
    const c = { width: SIZE, height: SIZE, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    const ctx = { canvas: c, drawImage() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
      fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      getImageData: (_x, _y, width, height) => width === SIZE && height === SIZE ? { width, height, data: new Uint8ClampedArray(picture.data) }
        : { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) } };
    c.getContext = () => ctx;
    return c;
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => canvas() };
  const view = canvas(), $ = (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: true }); return nodes.get(id); };
  let help = "";
  nodes.set("camera-help", { get textContent() { return help; }, set textContent(value) { help = value; writes.push(value); } });
  const tracker = createLiveTracker({ setTimer, clearTimer, makeWorker() {
    const core = createTrackingCore(), worker = {
      postMessage(message) {
        setTimer(() => {
          if (worker.dead) return;
          let data;
          try { data = { id: message.id, result: core.run(message), milliseconds: 20 }; }
          catch (error) { data = { id: message.id, error: error.message }; }
          worker.onmessage?.({ data });
        }, 20);
      },
      terminate() { worker.dead = true; },
    };
    return worker;
  } });
  const small = (p) => ({ x: p.x * 639 / (SIZE - 1), y: p.y * 639 / (SIZE - 1) });
  const corners = [{ x: X, y: Y }, { x: X + GRID, y: Y }, { x: X + GRID, y: Y + GRID }, { x: X, y: Y + GRID }];
  const video = { videoWidth: SIZE, videoHeight: SIZE, get currentTime() { return time / 1000; } };
  const camera = createLiveCamera({ tracker, $, canvas: view, video, getSettings: () => ({ ...settings }),
    // Detection measures the printed lattice: its own size, whatever the settings say.
    detector: { detect: () => new Promise((resolve) => setTimer(() => resolve({ confidence: .99, rows: n, cols: n, sharpness: 200,
      corners: corners.map(small) }), 50)), cancel() {} },
    reader: { read(_image, _corners, type, rows, cols) {
      return new Promise((resolve) => setTimer(() => {
        const puzzle = makePuzzle(type, rows, cols); puzzle.cells[0] = 1;
        resolve({ puzzle, markedCells: [0], cellUncertain: [], uncertain: [], cageUncertain: [], notes: [] });
      }, 500));
    }, cancel() {} },
    solver: { solve(puzzle) {
      solved.push([puzzle.boxRows, puzzle.boxCols]);
      return Promise.resolve(answer === "unique" ? { status: "unique", complete: true, solutions: [{ cells: Array(n * n).fill(1) }] }
        : { status: answer, complete: true, solutions: [] });
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
  async function until(predicate, limit = 10000) {
    for (let waited = 0; !predicate() && waited < limit; waited += 50) await advance(50);
    return predicate();
  }
  t.after(() => { camera.stop(); globalThis.document = previous; });
  camera.start();
  return { camera, solved, writes, until, get help() { return help; }, frozen: () => camera.view === "frozen" };
}
const SET_BOXES = "If the printed boxes differ, close the camera and set Rows, Columns, Box height and Box width in Grid size & settings.";
const GUESS = "boxes of 2 rows × 3 columns, guessed from the grid size";
const NOTE = "Box layout 2 rows × 3 columns was suggested from the grid size, not read from the photograph. Confirm it before solving.";
const FROZEN_HELP = "Solution preview — frozen. Check the clues and rules. Save picture keeps it; Clear returns to the live camera.";

test("a 6 × 6 Sudoku seen with 9 × 9 settings is solved with guessed 2 × 3 boxes, and the freeze says so", async (t) => {
  const h = live(t);
  assert.ok(await h.until(() => h.frozen()), "the solved reading freezes");
  assert.deepEqual(h.solved, [[2, 3]], "the solver was given the guess");
  assert.equal(h.help, `Solution preview — frozen, solved with ${GUESS}. ${SET_BOXES} Save picture keeps this picture; Clear returns to the live camera.`);
  const shot = h.camera.capture();
  assert.equal(shot.frozen, true);
  assert.deepEqual([shot.found.puzzle.boxRows, shot.found.puzzle.boxCols], [2, 3]);
  assert.ok(shot.found.notes.includes(NOTE), "the reading carries the note the photo flow gives a suggested box layout");
});

test("no solution, or several, with guessed boxes that are not square names them and the settings, never asks to move closer", async (t) => {
  for (const [answer, start] of [["no-solution", "No solution"], ["multiple", "More than one solution"]]) {
    const h = live(t, { answer });
    assert.ok(await h.until(() => h.help.startsWith(start)), `${answer}: ${h.help}`);
    assert.equal(h.help, `${start} with ${GUESS}. ${SET_BOXES}`);
    assert.ok(!h.writes.some((line) => /move closer/i.test(line)), `nothing asked to move closer: ${JSON.stringify(h.writes)}`);
    assert.equal(h.camera.view, "live");
  }
});

test("boxes from the settings, and a square guess, are not flagged", async (t) => {
  const chosen = live(t, { settings: { ...NINE, rows: 6, cols: 6, boxRows: 3, boxCols: 2 } });
  assert.ok(await chosen.until(() => chosen.frozen()));
  assert.deepEqual(chosen.solved, [[3, 2]], "the chosen boxes are the solver's");
  assert.equal(chosen.help, FROZEN_HELP);
  assert.ok(!chosen.camera.capture().found.notes.includes(NOTE.replace("2 rows × 3 columns", "3 rows × 2 columns")));
  const square = live(t, { n: 4 });
  assert.ok(await square.until(() => square.frozen()));
  assert.deepEqual(square.solved, [[2, 2]], "a 4 × 4 grid's guess is square");
  assert.equal(square.help, FROZEN_HELP);
  assert.deepEqual(square.camera.capture().found.notes, []);
  const unsolved = live(t, { settings: { ...NINE, rows: 6, cols: 6, boxRows: 3, boxCols: 2 }, answer: "no-solution" });
  assert.ok(await unsolved.until(() => unsolved.help.startsWith("No solution")));
  assert.equal(unsolved.help, "No solution to these readings — move closer or review the clues.");
});
