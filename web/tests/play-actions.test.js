// Execute the production action/worker handlers with controlled browser I/O.
// Real DOM, dialogs and Pyodide are exercised by play_safety_regressions.cjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as model from "../model.js";
import { captureEdit, restoreEdit, rememberEdit, prepareEdit } from "../edit-history.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function section(first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, `Missing production section: ${first}`);
  return source.slice(start, end).replace(/export function /g, "function ");
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(t, failure = "") {
  const nodes = new Map(), workers = [], timers = new Map(), events = [];
  let timerId = 0;
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === "edit-tool" ? "play" : id === "time-limit" ? "30" : "",
      textContent: "", hidden: false, disabled: false, open: false, dataset: {},
      setAttribute() {}, removeAttribute() {}, focus() {}, select() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector: (selector) => $(`${id}/${selector}`),
    });
    return nodes.get(id);
  };
  class Worker {
    constructor() {
      if (failure === "constructor") throw Error("Worker unavailable");
      this.messages = []; this.terminated = false; workers.push(this);
    }
    postMessage(message) {
      if (failure === "post") throw Error("Message failed");
      this.messages.push(message);
    }
    terminate() { this.terminated = true; }
    result(result) {
      const message = this.messages.findLast((m) => m.puzzle);
      this.onmessage({ data: { id: message.id, type: "result", result } });
    }
  }
  const context = vm.createContext({
    ...model, $, Worker, URL, console, performance, clueReread: { cancel() {}, open() {} },
    captureEdit, restoreEdit, prepareEdit, scanner: { cancel() {} }, stopCamera() {},
    render() { events.push("render"); }, persist() { events.push("persist"); }, setLayout() {}, savePrefs() {}, remember: () => rememberEdit(context.api.state),
    setInterval: () => 0, clearInterval() {},
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const code = [
    fs.readFileSync(new URL("../task-controller.js", import.meta.url), "utf8").replace("export function ", "function "),
    section("const state =", "const storage ="),
    section("function reviewCells()", '$("puzzle-type").addEventListener("change", typeControl);'),
    section("function status(", "function remember()"),
    section("const tasks =", "function svg("),
    section("function playMode()", "function cellAction("),
    section("function numberInput(", "function saveCell("),
    section('$("save-cage").onclick =', '$("stop").onclick ='),
    section("function drawBoard()", "  focused = Math.min(focused,") + "return { bad, sol }; }",
    section('$("edit-tool").onchange =', '$("clear-selection").onclick ='),
    'const applyType = $("apply-type");',
    section("applyType.onclick =", "function openCell("),
    section("function ensureWorker()", '$("next-solution").onclick ='),
    "globalThis.api = { state, tasks, requestSolve, playSolution, hintPlay, checkPlayAnswers, reportPlayProgress, loadPuzzle, drawBoard };",
  ].join("\n").replaceAll("import.meta.url", '"http://localhost/app.js"');
  vm.runInContext(code, context);
  const { state, tasks } = context.api;
  state.puzzle = model.makePuzzle("latinsquare", 2);
  state.puzzle.cells[0] = 1;
  state.play = [null, 1, null, null];
  const unique = { status: "unique", complete: true, elapsed: 0.1, solutions: [{ cells: [1, 2, 2, 1], edges: [] }] };
  t.after(() => tasks.stop());
  return { ...context.api, $, workers, timers, unique, events,
    worker: () => workers.at(-1), text: () => $("status-text").textContent };
}

for (const action of ["check", "hint"]) {
  for (const flag of ["needsReview", "uncertain", "cageUncertain"]) {
    test(`${action} requires confirmation for ${flag}, even with a cached solution`, (t) => {
      const h = harness(t);
      if (flag === "needsReview") h.state.needsReview = true;
      else h.state[flag].add(1);
      h.state.playSolution = h.unique.solutions[0].cells;
      const before = [...h.state.play];
      h.$(`${action}-play`).onclick();
      assert.equal(h.$("confirm-dialog").open, true);
      assert.equal(h.workers.length, 0);
      assert.deepEqual(h.state.play, before);
      assert.match(h.$("confirm-solve").textContent, action === "check" ? /check answers/ : /one hint/);
      h.$("confirm-back").onclick();
      assert.equal(h.$("confirm-dialog").open, false);
      assert.ok(flag === "needsReview" ? h.state.needsReview : h.state[flag].has(1));
      assert.deepEqual(h.state.play, before);
    });
  }
  test(`confirming ${action} resumes only that private action`, async (t) => {
    const h = harness(t);
    h.state.needsReview = true; h.state.uncertain.add(1);
    h.requestSolve(action); h.$("confirm-solve").onclick();
    assert.equal(h.state.needsReview, false);
    assert.equal(h.state.uncertain.size, 0);
    h.worker().result(h.unique); await flush();
    assert.equal(h.state.result, null);
    assert.equal(h.$("edit-tool").value, "play");
    if (action === "check") {
      assert.match(h.text(), /0 right · 1 wrong · 2 to go/);
      assert.deepEqual([...h.state.playFeedback.wrong], [1]);
    } else {
      assert.match(h.text(), /^Hint:/);
      assert.equal(h.state.play[1], 2);
      assert.deepEqual([...h.state.hints], [1]);
    }
  });
  test(`Escape cancels ${action} confirmation without accepting any reading`, async (t) => {
    const h = harness(t); h.state.needsReview = true;
    h.requestSolve(action); h.$("confirm-dialog").oncancel();
    h.$("confirm-solve").onclick(); await flush();
    assert.equal(h.state.needsReview, true); assert.equal(h.workers.length, 0);
  });
  test(`replacing the board invalidates a pending ${action} confirmation`, async (t) => {
    const h = harness(t); h.state.needsReview = true;
    h.requestSolve(action);
    h.loadPuzzle(model.makePuzzle("latinsquare", 3));
    const before = plain(h.state.puzzle);
    h.$("confirm-solve").onclick(); await flush();
    assert.deepEqual(plain(h.state.puzzle), before);
    assert.ok(h.workers.every((w) => !w.messages.some((m) => m.puzzle)));
    assert.equal(h.state.result, null);
    assert.match(h.text(), /Puzzle changed/);
  });
}

test("automatic completion checking uses the same review gate", async (t) => {
  const h = harness(t); h.state.needsReview = true; h.state.play = [null, 2, 2, 1];
  await h.reportPlayProgress();
  assert.equal(h.$("confirm-dialog").open, true);
  assert.match(h.$("confirm-solve").textContent, /check answers/);
  assert.equal(h.workers.length, 0);
});
for (const cells of [[1, 2, 2, 1], [2, 1, 1, 2]]) {
  test(`a valid alternative ${cells.join("")} is never compared to the first completion`, async (t) => {
    const h = harness(t); h.state.puzzle = model.makePuzzle("latinsquare", 2); h.state.play = [...cells];
    const multiple = { status: "multiple", complete: true, solutions: [
      { cells: [1, 2, 2, 1] }, { cells: [2, 1, 1, 2] },
    ] };
    for (const action of ["check", "hint"]) {
      h.requestSolve(action); h.worker().result(multiple); await flush();
      assert.match(h.text(), /Multiple solutions/);
      assert.deepEqual(h.state.play, cells);
      assert.equal(h.state.playFeedback, null); assert.equal(h.state.playSolution, null);
      assert.equal(h.state.hints.size, 0); assert.equal(h.state.result, null);
    }
  });
}
for (const result of [
  { status: "unique", complete: false, solutions: [{ cells: [1, 2, 2, 1] }] },
  { status: "no-solution" }, { status: "invalid" }, { status: "error" },
]) {
  test(`a ${result.status}/${result.complete} result cannot produce a hint or verdict`, async (t) => {
    const h = harness(t), before = [...h.state.play];
    h.requestSolve("hint"); h.worker().result(result); await flush();
    assert.deepEqual(h.state.play, before); assert.equal(h.state.hints.size, 0);
    assert.equal(h.state.playSolution, null); assert.equal(h.state.playFeedback, null);
  });
}

test("Stop settles an in-flight private request and ignores its late worker result", async (t) => {
  const h = harness(t), pending = h.playSolution(), worker = h.worker();
  h.tasks.stop("Stopped.");
  assert.equal(await pending, null); assert.equal(worker.terminated, true);
  worker.result(h.unique); await flush();
  assert.equal(h.state.playSolution, null); assert.match(h.text(), /Stopped/);
});
test("worker errors settle the private request and restore idle controls", async (t) => {
  const h = harness(t), pending = h.playSolution();
  h.worker().onerror({ message: "No memory" });
  assert.equal(await pending, null); assert.equal(h.tasks.busy, false);
  assert.equal(h.$("solve").disabled, false);
  assert.match(h.text(), /stopped unexpectedly/);
});
for (const failure of ["constructor", "post"]) {
  test(`${failure} failure settles the private request rather than leaking a busy task`, async (t) => {
    const h = harness(t, failure);
    assert.equal(await h.playSolution(), null);
    assert.equal(h.tasks.busy, false); assert.equal(h.$("solve").disabled, false);
  });
}
test("deadline cancellation settles the private request without a correctness claim", async (t) => {
  const h = harness(t), pending = h.playSolution();
  [...h.timers.values()][0]();
  assert.equal(await pending, null); assert.equal(h.tasks.busy, false);
  assert.match(h.text(), /timed out/);
});
test("changing mode cancels a pending hint and ignores a delayed result", async (t) => {
  const h = harness(t), before = [...h.state.play];
  h.requestSolve("hint"); const w = h.worker();
  h.$("edit-tool").value = "value"; h.$("edit-tool").onchange();
  w.result(h.unique); await flush();
  assert.deepEqual(h.state.play, before); assert.equal(h.state.hints.size, 0);
  assert.equal(h.tasks.busy, false);
});
test("a cached hint cannot cross a task generation at its await", async (t) => {
  const h = harness(t), before = [...h.state.play]; h.state.playSolution = h.unique.solutions[0].cells;
  h.requestSolve("hint"); h.tasks.stop(); await flush();
  assert.deepEqual(h.state.play, before); assert.equal(h.state.hints.size, 0);
});
test("a superseded worker cannot complete the newer request", async (t) => {
  const h = harness(t);
  h.requestSolve("hint"); const first = h.worker();
  h.requestSolve("check"); const second = h.worker();
  first.result(h.unique); await flush();
  assert.equal(h.state.hints.size, 0); assert.equal(h.tasks.busy, true);
  second.result(h.unique); await flush();
  assert.equal(h.state.hints.size, 0); assert.match(h.text(), /1 wrong/);
});
test("invalid cage structure is rejected before confirmation or clearing warnings", (t) => {
  const h = harness(t); h.state.puzzle = model.makePuzzle("kenken", 2); h.state.needsReview = true;
  h.requestSolve("hint");
  assert.equal(h.$("confirm-dialog").open, false); assert.equal(h.state.needsReview, true);
  assert.equal(h.workers.length, 0); assert.match(h.text(), /cover every cell/);
});
test("Reveal still confirms the transcription then leaves Play and displays the result", async (t) => {
  const h = harness(t); h.state.needsReview = true;
  h.$("solve").onclick(); h.$("confirm-solve").onclick(); h.worker().result(h.unique); await flush();
  assert.equal(h.$("edit-tool").value, "value"); assert.equal(h.state.result.status, "unique");
  assert.match(h.text(), /Solved · unique/);
});

test("Reveal does not paint conflicts from hidden Play answers onto a valid solution", (t) => {
  const h = harness(t); h.state.result = h.unique;
  assert.ok(h.drawBoard().bad.size > 0, "Play still marks the user's conflicting answer");
  h.$("edit-tool").value = "value";
  assert.equal(h.drawBoard().bad.size, 0, "Revealed valid solution must not inherit hidden answer conflicts");
});

function solvedCage(h) {
  h.state.puzzle = model.makePuzzle("kenken", 2);
  h.state.puzzle.cells[0] = 1;
  h.state.puzzle.cages = [
    { cells: [0, 1], target: 3, op: "+" },
    { cells: [2, 3], target: 3, op: "+" },
  ];
  h.state.layout = { rows: 2, cols: 2, boxRows: 1, boxCols: 2 };
  h.state.result = h.unique;
  h.state.playSolution = h.unique.solutions[0].cells;
  h.state.playFeedback = { wrong: new Set([1]) };
  h.state.solution = 1;
  h.state.view = "photo";
  h.state.puzzleSource = 7;
  h.state.uncertain = new Set([1]);
  h.state.cageUncertain = new Set([0, 3]);
  h.state.needsReview = true;
  h.state.notes = ["Retain review evidence"];
  h.state.hints = new Set([1]);
  h.state.selected = [0, 3];
  h.$("cage-target").value = "3";
  h.$("cage-op").value = "+";
}

test("rejected disconnected cage preserves the solved board, caches, metadata and task generation", (t) => {
  const h = harness(t); solvedCage(h);
  // At the undo limit a failed edit must not evict the oldest accepted edit.
  for (let i = 0; i < 30; i++) rememberEdit(h.state);
  const before = { ...h.state }, snapshot = plain(captureEdit(h.state)), id = h.tasks.id;
  const history = [...h.state.history];
  h.$("save-cage").onclick();
  assert.match(h.text(), /orthogonally connected/);
  for (const key of Object.keys(before))
    assert.equal(h.state[key], before[key], `${key} must retain its identity`);
  assert.deepEqual(plain(captureEdit(h.state)), snapshot);
  assert.deepEqual([...h.state.history], history);
  assert.equal(h.tasks.id, id);
  assert.deepEqual(h.events, [], "rejected edits must neither persist nor rerender an unchanged board");
});

test("a rejected cage does not cancel a compatible in-flight private solve", async (t) => {
  const h = harness(t); solvedCage(h);
  h.state.playSolution = null;
  const pending = h.playSolution(), worker = h.worker(), id = h.tasks.id;
  h.$("save-cage").onclick();
  assert.match(h.text(), /orthogonally connected/);
  assert.equal(h.tasks.id, id);
  assert.equal(h.tasks.busy, true);
  assert.equal(worker.terminated, false);
  worker.result(h.unique);
  assert.deepEqual(await pending, h.unique.solutions[0].cells);
});

test("accepted cage edits invalidate once, retain one undo snapshot and undo restores clues", (t) => {
  const h = harness(t); solvedCage(h);
  const before = plain(captureEdit(h.state)), id = h.tasks.id;
  h.state.selected = [0, 1]; h.$("cage-target").value = "4";
  h.$("save-cage").onclick();
  assert.match(h.text(), /Cage saved/);
  assert.equal(h.tasks.id, id + 1);
  assert.equal(h.state.result, null); assert.equal(h.state.playSolution, null);
  assert.equal(h.state.playFeedback, null); assert.equal(h.state.solution, 0);
  assert.equal(h.state.view, "board"); assert.deepEqual(plain(h.state.selected), []);
  assert.equal(h.state.puzzle.cages.find((q) => q.cells.includes(0)).target, 4);
  assert.equal(h.state.history.length, 1);
  assert.deepEqual(plain(h.state.history[0]), before);
  assert.deepEqual(h.events, ["persist", "render"]);
  h.$("undo").onclick();
  assert.deepEqual(plain(captureEdit(h.state)), before);
  assert.equal(h.state.result, null, "Undo must not revive the old result");
});

test("accepted cage edits cancel private requests and ignore stale worker completions", async (t) => {
  const h = harness(t); solvedCage(h); h.state.playSolution = null;
  const pending = h.playSolution(), worker = h.worker();
  h.state.selected = [0, 1]; h.$("cage-target").value = "4";
  h.$("save-cage").onclick();
  assert.equal(await pending, null); assert.equal(worker.terminated, true);
  worker.result(h.unique); await flush();
  assert.equal(h.state.playSolution, null); assert.equal(h.state.result, null);
  assert.match(h.text(), /Cage saved/);
});


test("saved signs leave sign review in place, so a chain's unread middle stays highlighted", (t) => {
  // A-B, B-C and C-D all unread along the top row of a 4 x 4 board.
  const h = harness(t);
  h.state.puzzle = model.makePuzzle("futoshiki", 4);
  h.state.cageUncertain = new Set([0, 1, 2, 3]); h.state.uncertain = new Set([1]);
  for (const pair of [[0, 1], [3, 2]]) { h.state.selected = pair; h.$("save-inequality").onclick(); }
  assert.deepEqual(plain(h.state.puzzle.inequalities), [{ less: 0, greater: 1 }, { less: 3, greater: 2 }]);
  assert.ok(h.state.cageUncertain.has(1) && h.state.cageUncertain.has(2), "B-C still has no sign and must stay visible");
  assert.deepEqual([...h.state.cageUncertain].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...h.state.uncertain], [1], "a doubtful digit stays doubtful");
});

test("re-applying Futoshiki keeps its sign review and notes; another family clears it", (t) => {
  const h = harness(t);
  h.state.puzzle = model.makePuzzle("futoshiki", 4);
  const note = "2 possible inequality signs could not be read. Their cells are highlighted: add each printed sign with Inequality under Editing.";
  h.state.cageUncertain = new Set([0, 1, 2]); h.state.notes = [note];
  h.$("puzzle-type").value = "futoshiki"; h.$("apply-type").onclick();
  assert.equal(h.state.puzzle.type, "futoshiki");
  assert.deepEqual([...h.state.cageUncertain].sort(), [0, 1, 2]);
  assert.ok(h.state.notes.includes(note), "the note explaining the kept highlights stays");
  h.$("puzzle-type").value = "latinsquare"; h.$("apply-type").onclick();
  assert.equal(h.state.puzzle.type, "latinsquare");
  assert.deepEqual([...h.state.cageUncertain], []);
  assert.ok(!h.state.notes.includes(note));
});

test("cage review survives a change between cage families and nothing else", (t) => {
  const h = harness(t);
  h.state.puzzle = model.makePuzzle("kenken", 4);
  h.state.cageUncertain = new Set([5, 6]);
  h.$("puzzle-type").value = "kenken"; h.$("apply-type").onclick();
  assert.deepEqual([...h.state.cageUncertain].sort(), [5, 6]);
  h.$("puzzle-type").value = "futoshiki"; h.$("apply-type").onclick();
  assert.deepEqual([...h.state.cageUncertain], [], "cage review means nothing on a Futoshiki board");
});

test("inequality saves and removals write the draft, never the captured source puzzle", (t) => {
  const h = harness(t);
  h.state.puzzle = model.makePuzzle("futoshiki", 2);
  h.state.selected = [0, 1];
  const original = h.state.puzzle;
  h.$("save-inequality").onclick();
  assert.deepEqual(original.inequalities, []);
  assert.deepEqual(plain(h.state.puzzle.inequalities), [{ less: 0, greater: 1 }]);
  const saved = h.state.puzzle;
  h.state.selected = [0, 1];
  h.$("remove-inequality").onclick();
  assert.deepEqual(plain(saved.inequalities), [{ less: 0, greater: 1 }]);
  assert.deepEqual(plain(h.state.puzzle.inequalities), []);
  assert.equal(h.state.history.length, 2);
});

test("cage removal commits a detached editable board and invalidates the old solution", (t) => {
  const h = harness(t); solvedCage(h);
  const original = h.state.puzzle;
  h.state.selected = [0]; h.$("remove-cage").onclick();
  assert.equal(original.cages.length, 2);
  assert.equal(h.state.puzzle.cages.length, 1);
  assert.deepEqual(plain(h.state.puzzle.cages[0].cells), [2, 3]);
  assert.equal(h.state.result, null);
  assert.equal(h.state.history.length, 1);
});


test("the maximum legal KenKen target survives import, save unchanged and undo", t => {
  const h = harness(t), p = model.makePuzzle("kenken", 25), cells = [];
  p.cells = Array.from({ length: 625 }, (_, i) => (16 * (i % 25 - Math.floor(i / 25)) + 2509) % 25 + 1);
  for (let r = 0; r < 12; r++) { cells.push(r * 25 + r); if (r < 11) cells.push(r * 25 + r + 1); }
  assert.equal(cells.reduce((n, i) => n * BigInt(p.cells[i]), 1n), 1000000000000n);
  p.cages = [{ cells, target: 1e12, op: "*" }, ...p.cells.flatMap((v, i) => cells.includes(i) ? [] : [{ cells: [i], target: v, op: "=" }])];
  h.loadPuzzle(JSON.parse(JSON.stringify(p)));
  const before = plain(h.state.puzzle);
  h.state.selected = cells.slice(); h.$("cage-target").value = "1000000000000"; h.$("cage-op").value = "*";
  h.$("save-cage").onclick();
  assert.match(h.text(), /Cage saved/);
  assert.equal(h.state.puzzle.cages.find(c => c.cells.length > 1).target, 1e12);
  model.checkSolveReady(h.state.puzzle); assert.equal(model.conflicts(h.state.puzzle).size, 0);
  h.$("undo").onclick(); assert.deepEqual(plain(h.state.puzzle), before);
});
for (const text of ["1000000000001", "9007199254740992", "1.5", "1e12", "0", "-1"])
  test(`invalid cage target ${text} leaves the accepted board and history untouched`, t => {
    const h = harness(t); h.loadPuzzle(model.makePuzzle("kenken", 2));
    h.state.selected = [0]; h.$("cage-target").value = text; h.$("cage-op").value = "=";
    const before = plain(h.state.puzzle), history = h.state.history.length;
    h.$("save-cage").onclick();
    assert.deepEqual(plain(h.state.puzzle), before); assert.equal(h.state.history.length, history);
    assert.doesNotMatch(h.text(), /Cage saved/);
  });
