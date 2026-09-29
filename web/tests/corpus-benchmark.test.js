import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const { parseOptions, entries, photoSize, readingCorners, photoFlowReview, measure } =
  createRequire(import.meta.url)("../../corpus/benchmark.cjs");

test("photographs are read at the photo flow's size: the long side at most 1600 px, never enlarged", () => {
  assert.deepEqual(photoSize(3264, 2448), { width: 1600, height: 1200, scale: 1600 / 3264 });
  assert.deepEqual(photoSize(2448, 3264), { width: 1200, height: 1600, scale: 1600 / 3264 });
  assert.deepEqual(photoSize(640, 480), { width: 640, height: 480, scale: 1 });
});

test("readings go through the detector's corners at any confidence, unconfirmed at 0.8 or below", () => {
  const corners = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }], size = photoSize(100, 100);
  for (const [confidence, unconfirmed] of [[0.94, false], [0.81, false], [0.8, true], [0.45, true], [0, true]])
    assert.deepEqual(readingCorners({ detection: { corners, confidence }, truth: null, size, trueCorners: false }),
      { corners, unconfirmed }, `confidence ${confidence}`);
});

test("true corners are scaled with the photograph and pulled onto the frame where they lie past it", () => {
  const size = photoSize(3200, 1600); // 1600 x 800
  const { corners, unconfirmed } = readingCorners({ detection: { corners: [], confidence: 0 }, size, trueCorners: true,
    truth: [[-4, 10], [3200, 0], [3300, 1700], [100, 1500]] });
  assert.equal(unconfirmed, false);
  assert.deepEqual(corners, [{ x: 0, y: 5 }, { x: 1599, y: 0 }, { x: 1599, y: 799 }, { x: 50, y: 750 }]);
  // Without a target outline the detector's corners are used after all.
  assert.equal(readingCorners({ detection: { corners: ["proposal"], confidence: 0.94 }, truth: null, size, trueCorners: true }).corners[0], "proposal");
});

test("a reading through unconfirmed corners flags every cell", () => {
  const reading = { read: { cells: [1, null, 3, 4] }, uncertain: [2] };
  assert.equal(photoFlowReview(reading, false), reading);
  assert.deepEqual(photoFlowReview(reading, true).uncertain.sort(), [0, 1, 2, 3]);
});

test("the benchmark reads through the proposal, flags every cell when it is unconfirmed, and scores corners of a found grid", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-benchmark-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "a.png"), target = path.join(dir, "a.json");
  fs.writeFileSync(file, "image bytes");
  fs.writeFileSync(target, JSON.stringify({ puzzle: { type: "latinsquare", rows: 2, cols: 2, cells: [1, 2, 2, 1] },
    corners: [[100, 100], [3100, 100], [3100, 3100], [100, 3100]] }));
  const proposal = [{ x: 50, y: 50 }, { x: 1550, y: 50 }, { x: 1550, y: 1550 }, { x: 50, y: 1550 }];
  const run = async (confidence, options = {}) => {
    const calls = [];
    const page = { async evaluate(fn, args) {
      calls.push([fn.name, args]);
      if (fn.name === "decodeImage") return { width: 3200, height: 3200 };
      if (fn.name === "detectGrid") return { detected: 5, detection: { corners: proposal, confidence, rows: 2, cols: 2 } };
      // One cell misread: 2 read as 9.
      return { ms: 10, read: { cells: [1, 2, 9, 1], cages: [], clues: [], inequalities: [], black: [] }, uncertain: [], cageUncertain: [], ocr: 7 };
    } };
    const row = await measure(page, { file, target, mime: "image/png" }, options);
    return { row, calls };
  };
  const found = await run(0.94);
  assert.deepEqual(found.calls[1][1], { width: 1600, height: 1600, scale: 0.5 });
  assert.equal(found.calls[2][1].corners, proposal);
  assert.deepEqual([found.row.grid, found.row.unconfirmed, found.row.correct, found.row.wrong, found.row.unsafe], [true, false, 3, 1, 1]);
  assert.equal(found.row.cornerError, 0);
  const missed = await run(0.45);
  assert.equal(missed.calls[2][1].corners, proposal);
  assert.deepEqual([missed.row.grid, missed.row.unconfirmed, missed.row.wrong, missed.row.unsafe, missed.row.flaggedCorrect],
    [false, true, 1, 0, 3]);
  assert.equal(missed.row.cornerError, undefined);
  const truth = await run(0.45, { trueCorners: true });
  assert.deepEqual(truth.calls[2][1].corners, [{ x: 50, y: 50 }, { x: 1550, y: 50 }, { x: 1550, y: 1550 }, { x: 50, y: 1550 }]);
  assert.deepEqual([truth.row.unconfirmed, truth.row.unsafe], [false, 1]);
});

test("options parse from the command line", () => {
  const options = parseOptions(["--family", "sudoku", "--limit", "5", "--true-corners", "--site", "x"]);
  assert.deepEqual([options.family, options.limit, options.trueCorners, options.site], ["sudoku", 5, true, "x"]);
});

test("a list of set/name lines selects exactly those images", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gridpuzzle-corpus-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [set, name] of [["one", "a"], ["one", "b"], ["two", "a"]]) {
    fs.mkdirSync(path.join(root, "sudoku", set), { recursive: true });
    fs.writeFileSync(path.join(root, "sudoku", set, `${name}.png`), "image bytes");
    fs.writeFileSync(path.join(root, "sudoku", set, `${name}.json`), "{}");
  }
  const list = path.join(root, "names.txt");
  fs.writeFileSync(list, "one/b.png\r\ntwo/a.png\n");
  assert.deepEqual(entries(parseOptions(["--corpus", root, "--list", list])).map((i) => `${i.set}/${i.name}`), ["one/b.png", "two/a.png"]);
  assert.equal(entries(parseOptions(["--corpus", root])).length, 3);
});
