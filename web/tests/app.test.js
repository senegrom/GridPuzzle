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

// The page plays the camera's video itself whenever it starts or resumes it
// (opening, Start preview, Clear). On a video with the autoplay attribute
// WebKit forces its native controls while Low Power Mode keeps its gesture
// restriction, and the live video is visible and tappable: the canvas over
// it is a transparent layer.
test("the camera's video plays muted and inline, without the autoplay attribute", () => {
  const video = read("index.html").match(/<video id="video"[^>]*>/)?.[0];
  assert.ok(video, "the camera's video element");
  assert.doesNotMatch(video, /\sautoplay\b/);
  assert.match(video, /\smuted\b/); assert.match(video, /\splaysinline\b/);
});

// WCAG 2 relative luminance of a #rgb or #rrggbb colour, and the contrast
// ratio of two colours.
function luminance(hex) {
  const digits = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

test("the Frozen chip's text meets WCAG AA contrast for its small bold type", () => {
  const rule = read("style.css").match(/\.view-state\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "the chip's rule");
  const colour = (property) => rule.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\\b`, "i"))?.[1];
  const background = colour("background(?:-color)?"), text = colour("color");
  assert.ok(background && text, rule);
  // 0.8rem bold is not large text, so AA asks for 4.5:1.
  assert.ok(contrast(text, background) >= 4.5, `${text} on ${background} is ${contrast(text, background).toFixed(2)}:1`);
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
