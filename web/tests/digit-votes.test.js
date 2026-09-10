import test from "node:test";
import assert from "node:assert/strict";
import { voteDigit } from "../ocr-map.js";
import { applyDigitVotes } from "../scanner.js";

test("unanimous readers are confident even at low individual scores", () => {
  assert.deepEqual(
    voteDigit([
      { text: "5", confidence: 40 },
      { text: "5", confidence: 70 },
      { text: "5", confidence: 60 },
    ]),
    { text: "5", confidence: 70, unanimous: true },
  );
  assert.deepEqual(
    voteDigit([
      { text: "12", confidence: 88 },
      { text: "12", confidence: 75 },
    ]),
    { text: "12", confidence: 88, unanimous: true },
  );
});

test("disagreement picks the majority, then confidence, and stays flagged", () => {
  assert.deepEqual(
    voteDigit([
      { text: "5", confidence: 99 },
      { text: "6", confidence: 80 },
      { text: "6", confidence: 50 },
    ]),
    { text: "6", confidence: 80, unanimous: false },
  );
  assert.deepEqual(
    voteDigit([
      { text: "3", confidence: 60 },
      { text: "8", confidence: 90 },
    ]),
    { text: "8", confidence: 90, unanimous: false },
  );
});

test("a lone reading and non-digit readings never count as agreement", () => {
  assert.deepEqual(
    voteDigit([
      { text: "5", confidence: 99 },
      { text: "", confidence: 0 },
      { text: "", confidence: 0 },
    ]),
    { text: "5", confidence: 99, unanimous: false },
  );
  assert.deepEqual(
    voteDigit([{ text: "-", confidence: 90 }, { text: "", confidence: 0 }, null]),
    { text: "", confidence: 0, unanimous: false },
  );
});

test("votes rewrite only digits that had single readings, keeping unread atlas results", () => {
  const entries = [
    { kind: "value", cell: 0, text: "5", confidence: 40 },
    { kind: "value", cell: 1, text: "3", confidence: 95 },
    { kind: "value", cell: 2, text: "", confidence: 0 },
    { kind: "label", cell: 3, text: "12+", confidence: 90 },
  ];
  applyDigitVotes(entries, [
    { index: 0, kind: "binary", text: "5", confidence: 50 },
    { index: 0, kind: "gray", text: "5", confidence: 30 },
    { index: 1, kind: "binary", text: "8", confidence: 90 },
    { index: 1, kind: "gray", text: "8", confidence: 70 },
    { index: 2, kind: "binary", text: "", confidence: 0 },
    { index: 2, kind: "gray", text: "", confidence: 0 },
    { index: 9, kind: "binary", text: "7", confidence: 99 },
  ]);
  assert.deepEqual(
    entries.map((e) => [e.text, e.confidence]),
    [["5", 90], ["8", 0], ["", 0], ["12+", 90]],
  );
});
