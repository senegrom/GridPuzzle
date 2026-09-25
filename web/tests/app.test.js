// app.js and the page it drives: the Play view's photo and solution-only
// controls, production handler wiring, saved settings, and the HTML/CSS shell.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as model from "../model.js";

const read = (name) =>
  fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("production handlers use the shared helpers and solve-ready gate", () => {
  const source = read("app.js");
  assert.match(source, /moveIndex\(i, e\.key, state\.puzzle\.rows, state\.puzzle\.cols\)/);
  assert.match(source, /hasCageRemoval\(state\.puzzle, state\.selected\)/);
  assert.match(source, /hasInequalityRemoval\(state\.puzzle, state\.selected\)/);
  assert.ok((source.match(/checkSolveReady\(state\.puzzle\)/g) || []).length >= 2);
});

test("loading a board keeps the scan type preference; settings persist as v2", () => {
  const source = read("app.js");
  assert.equal(source.includes('$("puzzle-type").value = p.type'), false);
  assert.match(source, /storage\.set\("gridpuzzle-settings-v2"/);
  assert.match(source, /storage\.get\("gridpuzzle-settings-v2"\)/);
});

test("core HTML owns the safe-area and security polish without patch files", () => {
  const html = read("index.html"),
    css = read("style.css");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /accessibility\.js|polish\.css/);
  assert.match(css, /safe-area-inset-top/);
});

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function section(first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, `Missing production section: ${first}`);
  return source.slice(start, end);
}

function viewHarness() {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", hidden: false, disabled: false, textContent: "", attributes: {},
      options: [], selectedOptions: [], setAttribute(k, v) { this.attributes[k] = v; },
    });
    return nodes.get(id);
  };
  const state = { puzzle: model.demo("latinsquare"), layout: null, history: [],
    uncertain: new Set(), cageUncertain: new Set(), notes: [], needsReview: false,
    selected: [], photo: {}, corners: [], rectified: {}, puzzleSource: 7, photoSource: 7,
    photoRows: 4, photoCols: 4, view: "photo", play: [], result: { solutions: [{ cells: [] }, { cells: [] }] } };
  let overlays = 0, exports = 0;
  $("solution-photo").toBlob = () => exports++;
  $("edit-tool").value = "value";
  const context = vm.createContext({ ...model, $, state, setLayout() {}, typeControl() {},
    reviewCells: () => state.uncertain, drawBoard() {}, stopTask() {}, status() {},
    drawOverlay: () => overlays++, download() {}, renderedJson: "" });
  vm.runInContext([
    section("function playMode()", "function openPlayCell("),
    section("function canOverlay()", "function clearPhotoMapping("),
    section("function render(", "const boxDefault ="),
    section('$("edit-tool").onchange =', '$("clear-selection").onclick ='),
    section('$("clean-view").onclick =', '$("example").onclick ='),
    section('$("save-photo").onclick =', '$("import-json").onclick ='),
    "globalThis.api = { render, canOverlay };",
  ].join("\n"), context);
  return { $, state, ...context.api, counts: () => ({ overlays, exports }) };
}

test("entering Play hides the solved photo and disables solution-only controls", () => {
  const h = viewHarness(); h.render();
  assert.equal(h.$("solution-photo").hidden, false);
  assert.equal(h.canOverlay(), true);
  h.$("edit-tool").value = "play"; h.$("edit-tool").onchange();
  assert.equal(h.state.view, "board");
  assert.equal(h.$("solution-photo").hidden, true);
  assert.equal(h.$("board-scroll").hidden, false);
  assert.equal(h.$("photo-view").disabled, true);
  assert.equal(h.$("save-photo").hidden, true);
  assert.equal(h.$("next-solution").hidden, true);
});

test("Play cannot redraw or export a retained full solution through photo controls", () => {
  const h = viewHarness(); h.render(); const before = h.counts();
  h.$("edit-tool").value = "play"; h.$("edit-tool").onchange();
  h.$("photo-view").onclick(); h.$("save-photo").onclick();
  assert.equal(h.canOverlay(), false);
  assert.equal(h.state.view, "board");
  assert.deepEqual(h.counts(), before);
});

test("leaving Play can show the retained solution photo again without losing answers", () => {
  const h = viewHarness(); h.state.play = [2];
  const result = h.state.result;
  h.$("edit-tool").value = "play"; h.$("edit-tool").onchange();
  h.$("edit-tool").value = "value"; h.$("edit-tool").onchange();
  assert.equal(h.canOverlay(), true);
  assert.equal(h.$("photo-view").disabled, false);
  assert.equal(h.$("next-solution").hidden, false);
  h.$("photo-view").onclick();
  assert.equal(h.$("solution-photo").hidden, false);
  assert.equal(h.state.result, result);
  assert.deepEqual(h.state.play, [2]);
});
