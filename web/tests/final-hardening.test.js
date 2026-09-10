import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  makePuzzle,
  checkSolveReady,
  moveIndex,
  hasCageRemoval,
  hasInequalityRemoval,
} from "../model.js";

const read = (name) =>
  fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("board navigation never wraps across rows or columns", () => {
  assert.equal(moveIndex(8, "ArrowRight", 9, 9), 8);
  assert.equal(moveIndex(9, "ArrowLeft", 9, 9), 9);
  assert.equal(moveIndex(4, "ArrowUp", 9, 9), 4);
  assert.equal(moveIndex(76, "ArrowDown", 9, 9), 76);
  assert.equal(moveIndex(10, "ArrowRight", 9, 9), 11);
  assert.equal(moveIndex(10, "ArrowDown", 9, 9), 19);
  assert.equal(moveIndex(10, "Enter", 9, 9), 10);
});

test("removal guards depend on puzzle state, not on editor text", () => {
  const p = { cages: [{ cells: [0, 1] }], inequalities: [{ less: 4, greater: 5 }] };
  assert.equal(hasCageRemoval(p, []), false);
  assert.equal(hasCageRemoval(p, [7]), false);
  assert.equal(hasCageRemoval(p, [1]), true);
  assert.equal(hasInequalityRemoval(p, [4]), false);
  assert.equal(hasInequalityRemoval(p, [4, 6]), false);
  assert.equal(hasInequalityRemoval(p, [4, 5]), true);
  assert.equal(hasCageRemoval(makePuzzle("sudoku", 4), [0]), false);
});

test("solve-ready cages require targets and complete coverage", () => {
  const p = makePuzzle("kenken", 4);
  p.cages = [{ cells: [0], target: 1, op: "=" }];
  assert.throws(() => checkSolveReady(p), /cover every cell/);
  p.cages = Array.from({ length: 16 }, (_, i) => ({
    cells: [i],
    target: (i % 4) + 1,
    op: "=",
  }));
  assert.doesNotThrow(() => checkSolveReady(p));
  p.cages[0].target = null;
  assert.throws(() => checkSolveReady(p), /target/);
  assert.doesNotThrow(() => checkSolveReady(makePuzzle("sudoku", 4)));
});

test("solve-ready Kakuro localizes missing and too-short runs before Python loads", () => {
  const p = makePuzzle("kakuro", 3);
  p.cells = ["#", "#", "#", "#", null, null, "#", null, null];
  p.clues = [
    { cell: 1, down: 4 },
    { cell: 2, down: 6 },
    { cell: 3, across: 3 },
    { cell: 6, across: 7 },
  ];
  assert.doesNotThrow(() => checkSolveReady(p));
  p.clues = p.clues.filter((q) => q.cell !== 6);
  assert.throws(() => checkSolveReady(p), /exactly one across and one down run/);
  const q = makePuzzle("kakuro", 2);
  q.cells = ["#", null, "#", "#"];
  q.clues = [{ cell: 0, across: 1 }];
  assert.throws(() => checkSolveReady(q), /2 to 9/);
});

test("production handlers use the shared helpers and solve-ready gate", () => {
  const source = read("app.js");
  assert.match(source, /moveIndex\(i, e\.key, state\.puzzle\.rows, state\.puzzle\.cols\)/);
  assert.match(source, /hasCageRemoval\(state\.puzzle, state\.selected\)/);
  assert.match(source, /hasInequalityRemoval\(state\.puzzle, state\.selected\)/);
  assert.ok((source.match(/checkSolveReady\(state\.puzzle\)/g) || []).length >= 2);
});

test("loading a board keeps the scan type preference; settings migrate to v2", () => {
  const source = read("app.js");
  assert.equal(source.includes('$("puzzle-type").value = p.type'), false);
  assert.match(source, /storage\.set\("gridpuzzle-settings-v2"/);
  assert.match(source, /storage\.get\("gridpuzzle-settings-v1"\)/);
});

test("core HTML owns the safe-area and security polish without patch files", () => {
  const html = read("index.html"),
    css = read("style.css");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /accessibility\.js|polish\.css/);
  assert.match(css, /safe-area-inset-top/);
  assert.equal(fs.existsSync(new URL("../accessibility.js", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../polish.css", import.meta.url)), false);
});
