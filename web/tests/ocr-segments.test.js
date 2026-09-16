import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { prepareScan } from "../scan-analysis.js";
import { separatedCrops } from "../ocr-segments.js";
import { applyDigitVotes, digitSamples } from "../scanner.js";

const boxes = [{ x: 46, y: 28, w: 4, h: 44 }, { x: 56, y: 28, w: 4, h: 44 }];
const clue = (extra = {}) => ({ cell: 0, x: 46, y: 28, w: 14, h: 44,
  glyphCount: 2, segments: boxes, text: "1", confidence: 99, ...extra });
const reads = (text, kind = "gray") => ({ index: 0, kind, text, confidence: 99 });
function canvasMock(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = { toDataURL: () => "test pixels" };
    canvas.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(image) { canvas.pixels = image.data; }, fillRect() {}, drawImage() {},
    });
    return canvas;
  } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

for (const invert of [false, true]) test(`retain actual separate glyph boxes, polarity ${invert}`, () => {
  const data = new Uint8ClampedArray(300 * 300 * 4).fill(255);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const ink = boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
    const v = ink === invert ? 245 : 10;
    for (let k = 0; k < 3; k++) data[4 * (y * 300 + x) + k] = v;
  }
  const result = prepareScan({ data, width: 300, height: 300 }, invert ? "str8ts" : "numbrix", 3, 3);
  const entry = result.entries.find((e) => e.cell === 0);
  assert.deepEqual(entry.segments, boxes);
  assert.equal(entry.glyphCount, 2);
  assert.equal(entry.recoveredMark, undefined);
});

for (const invert of [false, true]) test(`separate crops exclude neighbouring ink without replacing pixels, polarity ${invert}`, (t) => {
  canvasMock(t);
  const g = new Uint8Array(10000).fill(invert ? 10 : 245);
  for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) g[y * 100 + x] = invert ? 220 : 35;
  const before = g.slice(), crops = separatedCrops(clue({ invert }), g, 100, 100, 100, 100);
  assert.equal(crops.length, 2);
  for (const crop of crops) {
    let ink = 0;
    for (let i = 0; i < crop.pixels.length; i += 4) {
      assert.ok([35, 245].includes(crop.pixels[i]), "retain original gray values, adjusted only for polarity");
      assert.equal(crop.pixels[i + 3], 255);
      ink += crop.pixels[i] === 35;
    }
    assert.equal(ink, 4 * 44, "exactly one complete printed glyph, no neighbour");
  }
  assert.deepEqual(g, before);
});

test("malformed, overlapping, unordered or excessive segments are never cropped", () => {
  for (const segments of [[], [boxes[0]], [null, boxes[1]], [...boxes, boxes[0], boxes[1]],
    [boxes[1], boxes[0]], [boxes[0], { ...boxes[1], x: 48 }],
    [boxes[0], { ...boxes[1], x: 56.5 }], [boxes[0], { ...boxes[1], w: 100 }]]) {
    assert.deepEqual(separatedCrops(clue({ segments, glyphCount: segments.length }), new Uint8Array(10000), 100, 100, 100, 100), []);
  }
});

test("separate-read raster packing is bounded and omitted without gray samples", (t) => {
  canvasMock(t);
  for (const count of [40, 151]) {
    const entries = Array.from({ length: count }, () => clue());
    const samples = digitSamples(entries, new Map(entries.map((_, i) => [i, { width: 24, height: 54 }])),
      new Uint8Array(10000).fill(255), 100, 100, 100, 100, 1);
    assert.equal(samples.reduce((n, s) => n + (s.segments?.length || 0), 0), count === 40 ? 72 : 0);
    assert.ok(samples.every((s) => !s.segments || s.kind === "gray"));
  }
});

test("a complete segmented number can replace truncated whole-crop votes, but stays uncertain", () => {
  const entry = clue();
  applyDigitVotes([entry], [reads("1", "binary"), reads("1"), reads("11", "segments")]);
  assert.equal(entry.text, "11"); assert.equal(entry.confidence, 0); assert.equal(entry.segmentedRead, true);
});

test("an unread whole crop can acquire a complete segmented number", () => {
  const entry = clue({ text: "", confidence: 0 });
  applyDigitVotes([entry], [reads("", "binary"), reads(""), reads("17", "segments")]);
  assert.equal(entry.text, "17"); assert.equal(entry.confidence, 0);
});

test("single, partial, invalid and untrusted segmented results never invent missing digits", () => {
  for (const text of ["", "1", "111", "1?", "-1"]) {
    const entry = clue();
    applyDigitVotes([entry], [reads("1", "binary"), reads("1"), reads(text, "segments")]);
    assert.equal(entry.text, "1"); assert.equal(entry.confidence, 0); assert.equal(entry.segmentedRead, undefined);
  }
  const entry = clue({ segments: undefined });
  applyDigitVotes([entry], [reads("11", "segments")]);
  assert.equal(entry.text, "1");
});

test("a complete ordinary reading cannot be outvoted by duplicated segment messages", () => {
  const entry = clue({ text: "17" });
  applyDigitVotes([entry], [reads("17", "binary"), reads("17"), ...Array(9).fill(reads("11", "segments"))]);
  assert.equal(entry.text, "17"); assert.equal(entry.confidence, 99); assert.equal(entry.segmentedRead, undefined);
});

test("retain complete original atlas evidence when considering a fallback", () => {
  const entry = clue({ text: "17" });
  applyDigitVotes([entry], [reads("1", "binary"), reads("1"), reads("11", "segments")]);
  assert.equal(entry.text, "17", "reuse the complete atlas reading instead of the truncated majority or contradictory split");
  assert.equal(entry.lengthRecovered, true);
  assert.equal(entry.segmentedRead, undefined); assert.equal(entry.confidence, 0);
});

test("unanimous truncation is flagged even if the fallback is unavailable or budgeted out", () => {
  for (const samples of [[], [reads("1", "binary"), reads("1")]]) {
    const entry = clue({ segments: undefined });
    applyDigitVotes([entry], samples);
    assert.equal(entry.text, "1"); assert.equal(entry.confidence, 0);
  }
});

function host(read) {
  const messages = [], calls = [], params = []; let mode = "11";
  const self = { Worker: class {}, location: { href: "https://example.test/ocr-host-worker.js" },
    postMessage(m) { messages.push(m); }, close() {} };
  const worker = { async setParameters(p) { params.push(p); if (p.tessedit_pageseg_mode) mode = p.tessedit_pageseg_mode; },
    async recognize(png) { calls.push([mode, png]); return { data: await read(png, mode, self) }; }, async terminate() {} };
  vm.runInNewContext(fs.readFileSync(new URL("../ocr-host-worker.js", import.meta.url), "utf8"),
    { self, URL, Uint8Array, importScripts() { self.Tesseract = { createWorker: async () => worker }; } });
  const run = async (singles, id = 1) => {
    await self.onmessage({ data: { id, keepAlive: true, png: new ArrayBuffer(0), singles } });
    return messages.find((m) => m.id === id && m.result && !m.type)?.result;
  };
  return { self, messages, calls, params, run };
}
const samples = (index = 0, segments = ["left", "right"]) => [
  { index, kind: "binary", psm: "7", png: "binary" },
  { index, kind: "gray", psm: "7", png: "gray", segments },
];
const read = (png) => ({ text: png === "right" ? "7" : "1", confidence: 90 });

test("host retries falsely unanimous truncations and assembles actual individual readings", async () => {
  const h = host(read), result = await h.run(samples());
  assert.equal(result.singles.find((s) => s.kind === "segments")?.text, "17");
  assert.equal(result.retryCount, 3); assert.equal(result.ocrStats.segmentReads, 2);
  assert.deepEqual(h.calls.slice(-2), [["13", "left"], ["13", "right"]]);
});

test("complete ordinary and raw-line results avoid all per-glyph calls", async () => {
  for (const rawOnly of [false, true]) {
    const h = host((png, mode) => ({ text: rawOnly && mode !== "13" ? "1" : "17", confidence: 99 }));
    const result = await h.run(samples());
    assert.equal(result.ocrStats.segmentReads, 0);
    assert.equal(result.retryCount, rawOnly ? 1 : 0);
  }
});

test("unread individual glyph aborts assembly rather than returning a shorter number", async () => {
  const h = host((png) => ({ text: png === "right" ? "" : "1", confidence: 80 }));
  const result = await h.run(samples());
  assert.ok(!result.singles.some((s) => s.kind === "segments"));
  assert.equal(result.retryCount, 3);
});

test("all extra whole and segmented reads share a hard ceiling of 24", async () => {
  const h = host(read), result = await h.run(Array.from({ length: 40 }, (_, i) => samples(i)).flat());
  assert.equal(result.retryCount, 24);
  assert.equal(result.ocrStats.segmentReads, 16);
  assert.equal(result.singles.filter((s) => s.kind === "segments").length, 8);
});

test("segment caches reuse only identical pixels and never stale cell indices", async () => {
  const h = host(read);
  await h.run(samples()); const firstCalls = h.calls.length;
  const result = await h.run(samples(12), 2);
  assert.equal(h.calls.length, firstCalls + 1, "only the new atlas is recognized");
  assert.equal(result.singles.find((s) => s.kind === "segments").index, 12);
  assert.equal(result.ocrStats.cacheHits, 5);
});

test("cancellation during a segmented read emits neither partial number nor final result", async () => {
  const h = host(async (png, mode, self) => {
    if (png === "left") await self.onmessage({ data: { cancel: 1 } });
    return read(png);
  });
  assert.equal(await h.run(samples()), undefined);
  assert.ok(h.messages.some((m) => m.id === 1 && m.cancelled));
  assert.ok(!h.calls.some(([, png]) => png === "right"));
});

test("missing, excessive and non-string segment payloads never add OCR calls", async () => {
  for (const segments of [[], ["x"], ["x", "y", "z", "w"], [null, "x"]]) {
    const h = host(read), result = await h.run(samples(0, segments));
    assert.equal(result.ocrStats.segmentReads, 0);
    assert.equal(result.retryCount, 0);
  }
});

test("complete raw-line alternatives are retained ahead of shortened majorities", () => {
  const entry = clue();
  applyDigitVotes([entry], [reads("1", "binary"), reads("1"), reads("17", "retry")]);
  assert.equal(entry.text, "17"); assert.equal(entry.confidence, 0); assert.equal(entry.lengthRecovered, true);
});

test("existing raw-line retries cannot be starved by earlier per-glyph fallbacks", async () => {
  const h = host((png, mode) => ({ text: png === "gray" && mode === "7" ? "" : "1", confidence: 90 }));
  const result = await h.run(Array.from({ length: 24 }, (_, i) => samples(i)).flat());
  assert.equal(result.retryCount, 24); assert.equal(result.ocrStats.segmentReads, 0);
  assert.deepEqual(Array.from(result.singles.filter((s) => s.kind === "retry"), (s) => s.index),
    Array.from({ length: 24 }, (_, i) => i));
});
