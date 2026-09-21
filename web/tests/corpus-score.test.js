import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { puzzleFromReadings } from "../scanner.js";
const { score, isPerfect } = createRequire(import.meta.url)("../../corpus/score.cjs");
const puzzle = (type, extra = {}) => ({ type, rows: 2, cols: 2, cells: [1, null, null, null], ...extra });
const reading = p => ({ read: p, uncertain: [], cageUncertain: [] });
const evaluate = (target, read = target) => score({ puzzle: target }, reading(read));
const signs = [{ less: 0, greater: 1 }, { less: 2, greater: 3 }];
const futo = puzzle("futoshiki", { inequalities: signs });

test("every Futoshiki sign is counted, including its direction", () => {
  const correct = evaluate(futo);
  assert.equal(correct.printed, 3); assert.equal(correct.correct, 3); assert.equal(isPerfect(correct), true);
  const reversed = evaluate(futo, { ...futo, inequalities: signs.map(p => ({ less: p.greater, greater: p.less })) });
  assert.equal(reversed.printed, 3); assert.equal(reversed.correct, 1);
  assert.equal(reversed.wrong, 2); assert.equal(reversed.unsafe, 2); assert.equal(isPerfect(reversed), false);
});
test("unrelated and missing signs are not merged into one map entry", () => {
  const result = evaluate(futo, { ...futo, inequalities: [{ less: 0, greater: 2 }] });
  assert.equal(result.missed, 2); assert.equal(result.invented, 1); assert.equal(isPerfect(result), false);
  assert.equal(evaluate(futo, { ...futo, inequalities: [] }).missed, 2);
});
test("duplicate or contradictory signs count as extra readings in either order", () => {
  for (const extra of [signs[0], { less: 1, greater: 0 }]) for (const atStart of [true, false]) {
    const inequalities = atStart ? [extra, ...signs] : [...signs, extra];
    const result = evaluate(futo, { ...futo, inequalities });
    assert.equal(result.correct, 3); assert.equal(result.invented, 1); assert.equal(isPerfect(result), false);
  }
});
test("flagging suppresses unsafe counts, not errors or imperfect status", () => {
  const result = score({ puzzle: futo }, { read: { ...futo, inequalities: [] }, uncertain: [0, 2] });
  assert.equal(result.missed, 2); assert.equal(result.unsafe, 0); assert.equal(isPerfect(result), false);
});
test("plain singleton labels from the production reader match '=' cage targets", () => {
  const values = [1, 2, 2, 1];
  const target = puzzle("kenken", { cells: [null, null, null, null],
    cages: values.map((target, cell) => ({ cells: [cell], target, op: "=" })) });
  const found = puzzleFromReadings({ entries: values.map((value, cell) => ({ kind: "label", cell, text: String(value), confidence: 99 })),
    black: [false, false, false, false], meta: { rows: 2, cols: 2, boxes: false },
    mask: new Uint8Array(200 * 200).fill(1), width: 200, height: 200 }, "kenken", 2, 2);
  const result = evaluate(target, found.puzzle);
  assert.equal(result.printed, 4); assert.equal(result.correct, 4); assert.equal(isPerfect(result), true);
});
test("cage membership is unordered and operator aliases are semantic", () => {
  for (const [a, b] of [["×", "*"], ["x", "*"], ["X", "*"], ["÷", "/"], ["−", "-"]]) {
    const target = puzzle("kenken", { cages: [{ cells: [0, 1], target: 2, op: a }] });
    const read = { ...target, cages: [{ cells: [1, 0], target: 2, op: b }] };
    assert.equal(isPerfect(evaluate(target, read)), true);
  }
});
test("normalization does not hide wrong targets, multi-cell operators or duplicate cages", () => {
  const target = puzzle("kenken", { cages: [{ cells: [0, 1], target: 3, op: "+" }] });
  for (const cage of [{ cells: [0, 1], target: 3, op: "=" }, { cells: [1, 0], target: 4, op: "+" }]) {
    const result = evaluate(target, { ...target, cages: [cage] });
    assert.equal(result.wrong, 1); assert.equal(isPerfect(result), false);
  }
  assert.equal(evaluate(target, { ...target, cages: [...target.cages, ...target.cages] }).invented, 1);
});
for (const type of ["hidato", "kakuro", "str8ts"]) test(`${type} missing and invented blocks prevent a perfect score`, () => {
  const target = puzzle(type, { cells: [1, "#", null, null], black: type === "str8ts" ? [1] : [] });
  assert.equal(isPerfect(evaluate(target)), true);
  for (const cells of [[1, null, null, null], [1, 2, null, null]]) {
    const result = evaluate(target, { ...target, cells, black: [] });
    assert.equal(result.topologyWrong, 1); assert.equal(result.topologyUnsafe, 1);
    assert.equal(result.invented, cells[1] === 2 ? 1 : 0); assert.equal(isPerfect(result), false);
  }
  const result = evaluate(target, { ...target, cells: [1, "#", "#", null], black: type === "str8ts" ? [1, 2] : [] });
  assert.equal(result.topologyWrong, 1); assert.equal(isPerfect(result), false);
});
test("numbered Str8ts cells retain their black/white status independently of the number", () => {
  const target = puzzle("str8ts", { black: [0] });
  const result = evaluate(target, { ...target, black: [] });
  assert.equal(result.correct, 1); assert.equal(result.topologyWrong, 1); assert.equal(isPerfect(result), false);
  const flagged = score({ puzzle: target }, { read: { ...target, black: [] }, cageUncertain: [0] });
  assert.equal(flagged.topologyWrong, 1); assert.equal(flagged.topologyUnsafe, 0); assert.equal(isPerfect(flagged), false);
});
test("malformed Str8ts block metadata and truncated boards cannot be perfect", () => {
  const target = puzzle("str8ts", { cells: [1, "#", null, null], black: [1] });
  assert.equal(evaluate(target, { ...target, black: [] }).topologyWrong, 1);
  assert.equal(isPerfect(evaluate(target, { ...target, cells: [1, "#"] })), false);
});
test("Sudoku numbers and Slitherlink zero keep their original meanings", () => {
  const target = puzzle("slitherlink", { cells: [0, null, null, 3] });
  assert.equal(evaluate(target).printed, 2); assert.equal(isPerfect(evaluate(target)), true);
  assert.equal(evaluate(target, { ...target, cells: [null, 1, null, 3] }).invented, 1);
  assert.equal(isPerfect(evaluate(puzzle("sudoku"))), true);
});
