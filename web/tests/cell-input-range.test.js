// The editor's number fields keep each caller's own range check and message.
// Runs the production openCell/openPlayCell dialogs, the Blocked checkbox and
// the cell-form and Save cage handlers with controlled browser I/O, as
// play-actions.test.js does.
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
function harness(t) {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: id === "edit-tool" ? "clues" : id === "time-limit" ? "30" : "",
      textContent: "", hidden: false, disabled: false, open: false, checked: false, dataset: {},
      setAttribute() {}, removeAttribute() {}, focus() {}, select() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector: (selector) => $(`${id}/${selector}`),
    });
    return nodes.get(id);
  };
  class Worker { postMessage() {} terminate() {} }
  const context = vm.createContext({
    ...model, $, Worker, URL, console, performance, clueReread: { cancel() {}, open() {} },
    captureEdit, restoreEdit, prepareEdit, scanner: { cancel() {} }, stopCamera() {},
    render() {}, persist() {}, setLayout() {}, savePrefs() {}, remember: () => rememberEdit(context.api.state),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  });
  const code = [
    fs.readFileSync(new URL("../task-controller.js", import.meta.url), "utf8").replace("export function ", "function "),
    section("const state =", "const storage ="),
    section("function reviewCells()", '$("puzzle-type").addEventListener("change", typeControl);'),
    section("function status(", "function remember()"),
    section("const tasks =", "function svg("),
    section("function playMode()", "function cellAction("),
    section("function openCell(", "function numberInput("),
    section("function numberInput(", '$("close-cell").onclick ='),
    section('$("save-cage").onclick =', '$("stop").onclick ='),
    section('$("edit-tool").onchange =', '$("clear-selection").onclick ='),
    'const applyType = $("apply-type");',
    section("applyType.onclick =", "function openCell("),
    section("function ensureWorker()", '$("next-solution").onclick ='),
    "globalThis.api = { state, tasks, loadPuzzle, openCell, openPlayCell };",
  ].join("\n").replaceAll("import.meta.url", '"http://localhost/app.js"');
  vm.runInContext(code, context);
  t.after(() => context.api.tasks.stop());
  return { ...context.api, $, submit: () => $("cell-form").onsubmit({ preventDefault() {} }),
    error: () => $("cell-error").textContent };
}

test("a Play answer above the puzzle's values gets the Play range message", (t) => {
  const h = harness(t); h.loadPuzzle(model.makePuzzle("sudoku", 9));
  h.$("edit-tool").value = "play"; h.openPlayCell(0);
  h.$("cell-value").value = "1000"; h.submit();
  assert.equal(h.error(), "Answers must be from 1 to 9.");
  assert.equal(h.$("cell-dialog").open, true); assert.equal(h.state.play[0], null);
});
test("a clue above the puzzle's values gets the clue range message", (t) => {
  const h = harness(t); h.loadPuzzle(model.makePuzzle("sudoku", 9));
  h.openCell(0); h.$("cell-value").value = "1000"; h.submit();
  assert.equal(h.error(), "Cell 1 is outside the allowed range.");
  assert.equal(h.$("cell-dialog").open, true); assert.equal(h.state.puzzle.cells[0], null);
});
// Values numberInput refuses: a blocked cell's disabled field is not read.
for (const [type, name] of [["hidato", "Hidato"], ["kakuro", "Kakuro"]]) for (const stale of ["12a", "99999999999999999999"])
  test(`a value left in the disabled field (${stale}) cannot stop a ${name} cell being blocked`, (t) => {
    const h = harness(t); h.loadPuzzle(model.makePuzzle(type, 3));
    h.openCell(0); h.$("cell-value").value = stale;
    h.$("blocked-cell").checked = true; h.$("blocked-cell").onchange();
    assert.equal(h.$("cell-value").disabled, true, "Blocked disables the value field");
    h.submit();
    assert.equal(h.error(), ""); assert.equal(h.$("cell-dialog").open, false);
    assert.equal(h.state.puzzle.cells[0], "#");
  });
test("a KenKen target above the limit names the range without blank advice", (t) => {
  const h = harness(t); h.loadPuzzle(model.makePuzzle("kenken", 2));
  const before = JSON.stringify(h.state.puzzle);
  h.state.selected = [0]; h.$("cage-target").value = "1000000000001"; h.$("cage-op").value = "=";
  h.$("save-cage").onclick();
  assert.equal(h.$("status-text").textContent, "Use a whole number from 1 to 1000000000000.");
  assert.equal(JSON.stringify(h.state.puzzle), before);
});
