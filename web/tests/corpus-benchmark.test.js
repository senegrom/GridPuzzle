import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
// The photo-flow reading rules of corpus/benchmark.cjs live in the runner, which the deployment's gate
// already reads; the CLI itself stays out of it, so editing it does not redeploy the app.
const { selectImages, previewSize, readingCorners, photoFlowReview, photoFlowMeasure, photoFlowMetadata } =
  createRequire(import.meta.url)("../../corpus/benchmark-runner.cjs");

test("the preview's scale from the original's pixels is its side ratio, whichever way it was turned", () => {
  assert.deepEqual(previewSize({ width: 1600, height: 1200, natural: { width: 3264, height: 2448 } }), { width: 1600, height: 1200, scale: 1600 / 3264 });
  assert.deepEqual(previewSize({ width: 1200, height: 1600, natural: { width: 3264, height: 2448 } }), { width: 1200, height: 1600, scale: 1600 / 3264 });
  assert.deepEqual(previewSize({ width: 640, height: 480, natural: { width: 640, height: 480 } }), { width: 640, height: 480, scale: 1 });
});

test("readings go through the detector's corners at any confidence, unconfirmed at 0.8 or below", () => {
  const corners = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }], size = { width: 100, height: 100, scale: 1 };
  for (const [confidence, unconfirmed] of [[0.94, false], [0.81, false], [0.8, true], [0.45, true], [0, true]])
    assert.deepEqual(readingCorners({ detection: { corners, confidence }, truth: null, size, trueCorners: false }),
      { corners, unconfirmed }, `confidence ${confidence}`);
});

test("true corners are scaled with the photograph and pulled onto the frame where they lie past it", () => {
  const size = previewSize({ width: 1600, height: 800, natural: { width: 3200, height: 1600 } });
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
  const run = async (confidence, options = {}, detail = true) => {
    const calls = [];
    const page = { async evaluate(fn, args) {
      calls.push([fn.name, args]);
      if (fn.name === "loadPhoto") return { width: 1600, height: 1600, natural: { width: 3200, height: 3200 } };
      if (fn.name === "detectGrid") return { detected: 5, detection: { corners: proposal, confidence, rows: 2, cols: 2 } };
      // Read through the original's detail (or not); one cell misread: 2 read as 9.
      return { ms: 10, detail, detailNote: detail ? "Clues read from the original photo detail." : null,
        read: { cells: [1, 2, 9, 1], cages: [], clues: [], inequalities: [], black: [] }, uncertain: [], cageUncertain: [], ocr: 7 };
    } };
    const row = await photoFlowMeasure(page, { file, target, mime: "image/png" }, options);
    return { row, calls };
  };
  const found = await run(0.94);
  assert.deepEqual([found.calls[0][0], found.calls[0][1].maxSide, found.calls[1][0], found.calls[2][0]], ["loadPhoto", 1600, "detectGrid", "readGrid"]);
  // The page maps the preview corners onto the original's detail, as the photo flow does.
  assert.deepEqual(found.calls[0][1], { data: Buffer.from("image bytes").toString("base64"), mime: "image/png", maxSide: 1600 });
  assert.equal(found.calls[1][1], undefined);
  assert.deepEqual(found.calls[2][1], { corners: proposal, type: "latinsquare", rows: 2, cols: 2 });
  assert.equal(found.row.geometrySource, "detector-proposal");
  assert.deepEqual([found.row.detail, found.row.detailNote], [true, "Clues read from the original photo detail."]);
  assert.deepEqual([found.row.grid, found.row.unconfirmed, found.row.correct, found.row.wrong, found.row.unsafe], [true, false, 3, 1, 1]);
  assert.equal(found.row.cornerError, 0);
  const missed = await run(0.45);
  assert.equal(missed.calls[2][1].corners, proposal);
  assert.deepEqual([missed.row.grid, missed.row.unconfirmed, missed.row.wrong, missed.row.unsafe, missed.row.flaggedCorrect],
    [false, true, 1, 0, 3]);
  assert.equal(missed.row.cornerError, undefined);
  const preview = await run(0.94, {}, false);
  assert.deepEqual([preview.row.detail, "detailNote" in preview.row], [false, false]);
  const truth = await run(0.45, { trueCorners: true });
  assert.deepEqual(truth.calls[2][1].corners, [{ x: 50, y: 50 }, { x: 1550, y: 50 }, { x: 1550, y: 1550 }, { x: 50, y: 1550 }]);
  assert.deepEqual([truth.row.unconfirmed, truth.row.unsafe, truth.row.geometrySource], [false, 1, "reference"]);
  assert.deepEqual(Object.keys(truth.calls[2][1]).sort(), ["cols", "corners", "rows", "type"]);
  const noOutline = JSON.parse(fs.readFileSync(target, "utf8"));
  delete noOutline.corners; fs.writeFileSync(target, JSON.stringify(noOutline));
  const fallback = await run(0.45, { trueCorners: true });
  assert.equal(fallback.calls[2][1].corners, proposal);
  assert.equal(fallback.row.geometrySource, "detector-proposal");
  assert.equal(fallback.row.unconfirmed, true);
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
  assert.deepEqual(selectImages({ corpus: root, list }).map((i) => `${i.set}/${i.name}`), ["one/b.png", "two/a.png"]);
  assert.equal(selectImages({ corpus: root }).length, 3);
});


test("photo-flow reports retain v4 harness settings and declare reference-supplied configuration", () => {
  for (const trueCorners of [false, true]) {
    const meta = photoFlowMetadata({ trueCorners });
    assert.equal(meta.scoreVersion, 4);
    assert.deepEqual(meta.harness, { maxSide: 1600, confirmedAbove: 0.8,
      corners: trueCorners ? "target, pulled onto the frame" : "detector, any confidence", read: "photoDetail" });
    assert.deepEqual(meta.recognition, { type: "reference", dimensions: "reference",
      corners: trueCorners ? "reference-when-available" : "detector-proposal", clueValues: "not-supplied" });
  }
});
