import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { applyDigitVotes } from "../scanner.js";

// Two touching digits can share a component. A component count is not a
// command to truncate a longer OCR result, even when a retry returns less.
const entry = (text) => ({ text, confidence: 99, glyphCount: 2,
  segments: [{ x: 0, y: 0, w: 8, h: 30 }, { x: 15, y: 0, w: 4, h: 30 }] });
const reading = (kind, text) => ({ index: 0, kind, text, confidence: 99 });

test("three-digit reading is preserved when two digits touch", () => {
  const e = entry("111");
  applyDigitVotes([e], [reading("binary", "111"), reading("gray", "111"),
    reading("segments", "11")]);
  assert.equal(e.text, "111");
  assert.equal(e.confidence, 99);
  assert.equal(e.segmentedRead, undefined);
  assert.equal(e.lengthRecovered, undefined);
});

test("a longer full-number alternative can recover a truncated majority", () => {
  const e = entry("111");
  applyDigitVotes([e], [reading("binary", "1"), reading("gray", "1"),
    reading("segments", "11")]);
  assert.equal(e.text, "111");
  assert.equal(e.confidence, 0);
  assert.equal(e.lengthRecovered, true);
});

test("host does not add retries to force a longer agreed result down to component count", async () => {
  const calls = [], messages = [];
  const worker = { async setParameters() {}, async terminate() {},
    async recognize(png) { calls.push(png); return { data: { text: "111", confidence: 99 } }; } };
  const self = { Worker: class {}, location: { href: "https://example.test/ocr-host-worker.js" },
    postMessage(message) { messages.push(message); }, close() {} };
  vm.runInNewContext(fs.readFileSync(new URL("../ocr-host-worker.js", import.meta.url), "utf8"),
    { self, URL, Uint8Array, importScripts() { self.Tesseract = { createWorker: async () => worker }; } });
  await self.onmessage({ data: { id: 1, keepAlive: true, png: new ArrayBuffer(0), singles: [
    { index: 0, kind: "binary", psm: "7", png: "binary" },
    { index: 0, kind: "gray", psm: "7", png: "gray", segments: ["joined", "single"] },
  ] } });
  const result = messages.find((m) => m.result && !m.type)?.result;
  assert.ok(result);
  assert.equal(result.retryCount, 0);
  assert.equal(result.ocrStats.segmentReads, 0);
  assert.equal(calls.length, 3);
});
