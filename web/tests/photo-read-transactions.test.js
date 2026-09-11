// Exercise production photo handlers with controlled OCR completion/failure.
import test from "node:test";
import assert from "node:assert/strict";
import { setupPhotoFlow } from "../photo-flow.js";
import { makePuzzle, boxShape } from "../model.js";
import { rememberEdit, restoreEdit } from "../edit-history.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => descriptor ? Object.defineProperty(globalThis, "document", descriptor) : delete globalThis.document);
  globalThis.document = { addEventListener() {} };
  const nodes = new Map(), events = [], requests = [], errors = [];
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", checked: false, hidden: false, disabled: false, style: {},
      scrollIntoView() {}, setAttribute() {},
    });
    return nodes.get(id);
  };
  const puzzle = makePuzzle("latinsquare", 2);
  puzzle.cells[0] = 1;
  const solved = [1, 2, 2, 1];
  const state = {
    puzzle, layout: { rows: 2, cols: 2, boxRows: 1, boxCols: 2 },
    photo: { width: 600, height: 600 }, rectified: { width: 400, height: 400 },
    corners: [{ x: 0, y: 0 }, { x: 599, y: 0 }, { x: 599, y: 599 }, { x: 0, y: 599 }],
    puzzleSource: 7, photoSource: 7, photoRows: 2, photoCols: 2, view: "photo",
    result: { status: "unique", complete: true, solutions: [{ cells: solved }] },
    solution: 0, play: [null, 2, null, null], hints: new Set([1]), playSolution: solved,
    playFeedback: { wrong: new Set([2]) }, selected: [0], uncertain: new Set([0]),
    cageUncertain: new Set(), blackReadings: [], needsReview: true, notes: ["Retained review"], history: [],
  };
  rememberEdit(state);
  for (const [id, value] of Object.entries({ rows: 2, cols: 2, "box-rows": 1, "box-cols": 2, "puzzle-type": "latinsquare" }))
    $(id).value = String(value);
  let epoch = 0, busy = false, deadline = null, currentStatus = "Solved", saves = 0, clears = 0, solves = 0;
  const stopTask = (message) => { epoch++; busy = false; deadline = null; if (message) currentStatus = message; };
  setupPhotoFlow({
    $, state, scanner: { read: (...args) => { const job = deferred(); requests.push({ ...job, progress: args.at(-1) }); return job.promise; } },
    stopTask, invalidate: stopTask,
    begin: () => { stopTask(); busy = true; return epoch; },
    finish: () => { busy = false; deadline = null; },
    fail: (e) => { errors.push(e.message); currentStatus = e.message; },
    render: () => events.push("render"), drawBoard: () => events.push("draw"),
    status: (text) => { currentStatus = text; },
    remember: () => rememberEdit(state), persist: () => saves++,
    clearPhotoMapping: () => { clears++; state.rectified = state.photoSource = null; state.photoRows = state.photoCols = 0; state.view = "board"; },
    solveNow: () => solves++, boxDefault: boxShape, setLayout() {},
    getJobId: () => epoch, setDeadline: (callback) => { deadline = callback; },
  });
  return {
    $, state, requests, events, errors, stopTask,
    read: () => $("read-photo").onclick(),
    timeout: () => deadline?.(),
    status: () => currentStatus,
    metrics: () => ({ saves, clears, solves, busy, epoch }),
  };
}
function proposal() {
  const puzzle = makePuzzle("latinsquare", 2); puzzle.cells[0] = 2;
  return { puzzle, cellUncertain: [0], cageUncertain: [], needsReview: true,
    notes: ["New review"], rectified: { width: 300, height: 300 } };
}
function unchanged(h, before) {
  for (const [key, value] of Object.entries(before)) assert.equal(h.state[key], value, `${key} identity changed`);
  assert.equal(h.metrics().saves, 0);
  assert.equal(h.metrics().clears, 0);
}
for (const failure of ["rejected", "invalid-puzzle", "invalid-metadata", "cancelled", "timeout"])
  test(`${failure} OCR preserves the accepted puzzle, solution, mapping, answers and history`, async (t) => {
    const h = harness(t), before = { ...h.state };
    h.read(); assert.equal(h.requests.length, 1); unchanged(h, before);
    if (failure === "rejected") h.requests[0].reject(Error("OCR unavailable"));
    else if (failure === "invalid-puzzle") { const p = proposal(); p.puzzle.cells[0] = 99; h.requests[0].resolve(p); }
    else if (failure === "invalid-metadata") { const p = proposal(); p.notes = null; h.requests[0].resolve(p); }
    else { if (failure === "timeout") h.timeout(); else h.stopTask("Stopped"); h.requests[0].resolve(proposal()); }
    await tick(); unchanged(h, before); assert.equal(h.metrics().busy, false);
    assert.deepEqual(h.events, []);
    assert.equal(h.errors.length, ["cancelled", "timeout"].includes(failure) ? 0 : 1);
  });
for (const invalid of ["dimensions", "corners", "boxes"])
  for (const ending of ["result", "error"])
    test(`a newer Read rejected for ${invalid} owns the status over an older OCR ${ending}`, async (t) => {
      const h = harness(t); h.read();
      if (invalid === "dimensions") h.$("rows").value = "0";
      else if (invalid === "corners") h.state.corners[1] = { ...h.state.corners[0] };
      else { h.$("puzzle-type").value = "sudoku"; h.$("box-rows").value = "2"; }
      h.read(); assert.equal(h.requests.length, 1);
      const warning = h.status(); assert.equal(h.errors.length, 1);
      h.requests[0].progress("Obsolete OCR progress", 0.5);
      if (ending === "result") h.requests[0].resolve(proposal()); else h.requests[0].reject(Error("Obsolete OCR error"));
      await tick();
      assert.equal(h.status(), warning); assert.equal(h.state.puzzle.cells[0], 1);
      assert.equal(h.metrics().saves, 0); assert.equal(h.metrics().busy, false);
      assert.equal(h.errors.length, 1);
    });
test("a current successful Read commits once, resets derived solution state, and keeps an undo snapshot", async (t) => {
  const h = harness(t), before = structuredClone(h.state), history = h.state.history, photo = h.state.photo;
  h.state.solution = 1;
  h.read(); h.requests[0].resolve(proposal()); await tick();
  assert.deepEqual(h.errors, []); assert.equal(h.state.puzzle.cells[0], 2);
  assert.equal(h.state.result, null); assert.equal(h.state.playSolution, null);
  assert.equal(h.state.playFeedback, null); assert.equal(h.state.solution, 0);
  assert.deepEqual(h.state.play, Array(4).fill(null)); assert.equal(h.state.hints.size, 0);
  assert.equal(h.state.view, "board"); assert.equal(h.state.photo, photo);
  assert.equal(h.state.rectified.width, 300); assert.equal(h.state.photoSource, h.state.puzzleSource);
  assert.equal(h.state.history, history); assert.equal(history.length, before.history.length + 1);
  assert.equal(h.metrics().saves, 1); assert.equal(h.metrics().clears, 1);
  restoreEdit(h.state, history.pop());
  assert.deepEqual(h.state.puzzle, before.puzzle); assert.deepEqual(h.state.play, before.play);
  assert.deepEqual(h.state.uncertain, before.uncertain);
});
test("a superseded successful Read cannot overwrite the next successful Read", async (t) => {
  const h = harness(t); h.read(); h.read();
  h.requests[1].resolve(proposal()); await tick();
  const accepted = h.state.puzzle;
  const late = proposal(); late.puzzle.cells[0] = 1;
  h.requests[0].resolve(late); await tick();
  assert.equal(h.state.puzzle, accepted); assert.equal(h.metrics().saves, 1);
});
test("a Read with no photograph remains a no-op", (t) => {
  const h = harness(t);
  h.state.photo = null;
  const before = { ...h.state }, metrics = h.metrics();
  h.read();
  unchanged(h, before);
  assert.deepEqual(h.metrics(), metrics);
  assert.equal(h.requests.length, 0);
});
