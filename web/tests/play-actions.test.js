// Execute the production action/worker handlers with controlled browser I/O.
// Real DOM, dialogs and Pyodide are exercised by play_safety_regressions.cjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as model from "../model.js";
import { captureEdit, restoreEdit, rememberEdit } from "../edit-history.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function section(first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, `Missing production section: ${first}`);
  return source.slice(start, end).replace(/export function /g, "function ");
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(t, failure = "") {
  const nodes = new Map(), workers = [], timers = new Map();
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
    ...model, $, Worker, URL, console, performance,
    captureEdit, restoreEdit, scanner: { cancel() {} }, stopCamera() {},
    render() {}, persist() {}, setLayout() {}, remember: () => rememberEdit(context.api.state),
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
    section("function drawBoard()", "  focused = Math.min(focused,") + "return { bad, sol }; }",
    section('$("edit-tool").onchange =', '$("clear-selection").onclick ='),
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
  return { ...context.api, $, workers, timers, unique,
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
