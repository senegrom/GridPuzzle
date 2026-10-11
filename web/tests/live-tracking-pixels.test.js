// The tracking worker's readback of a transferred bitmap (the bitmap
// transport, live-tracker.js), with a fake OffscreenCanvas that records what
// is done to it: one canvas, sized only when the size changes, cleared, the
// whole bitmap drawn over the whole canvas and read back, and the bitmap
// closed on every path.
import test from "node:test";
import assert from "node:assert/strict";
import { createPixelReader } from "../live-tracking-pixels.js";

// `paint`: what a draw covers with opaque pixels ("all", the "left" half, or
// "none"); a cleared canvas is transparent.
function fakes({ context = true, draw = null, paint = "all" } = {}) {
  const made = [], ops = [];
  const makeCanvas = (width, height) => {
    let w = width, h = height, painted = "none";
    const canvas = {
      get width() { return w; }, set width(value) { ops.push(["width", value]); w = value; },
      get height() { return h; }, set height(value) { ops.push(["height", value]); h = value; },
      getContext(type, options) {
        ops.push(["getContext", type, options]);
        return context ? {
          clearRect: (...box) => { ops.push(["clearRect", ...box]); painted = "none"; },
          drawImage(source, ...box) { ops.push(["drawImage", source, ...box]); draw?.(); painted = paint; },
          getImageData: (x, y, width, height) => { ops.push(["getImageData", x, y, width, height]);
            const data = new Uint8ClampedArray(width * height * 4);
            if (painted === "all") data.fill(255);
            if (painted === "left") for (let row = 0; row < height; row++) data.fill(255, 4 * row * width, 4 * (row * width + Math.floor(width / 2)));
            return { width, height, data }; },
        } : null;
      },
    };
    made.push([width, height]); return canvas;
  };
  // A bitmap of a phone's 1200 x 1600 snapshot unless given another size.
  const bitmap = (width = 1200, height = 1600) => ({ width, height, closed: 0, close() { this.closed++; } });
  return { made, ops, makeCanvas, bitmap };
}

test("a bitmap is drawn at the tracking size over a cleared canvas and read back as ImageData", () => {
  const f = fakes(), pixelsOf = createPixelReader(f.makeCanvas), bitmap = f.bitmap();
  const image = pixelsOf({ bitmap, width: 960, height: 1280 });
  assert.deepEqual([image.width, image.height, image.data.length], [960, 1280, 960 * 1280 * 4]);
  assert.ok(image.data instanceof Uint8ClampedArray);
  assert.deepEqual(f.made, [[960, 1280]]);
  assert.deepEqual(f.ops, [
    ["getContext", "2d", { willReadFrequently: true }],
    ["clearRect", 0, 0, 960, 1280],
    ["drawImage", bitmap, 0, 0, 960, 1280],
    ["getImageData", 0, 0, 960, 1280],
  ], "no size assigned to a new canvas of the right size; a CPU-backed context where honoured");
  assert.equal(bitmap.closed, 1, "the transferred bitmap is closed once read");
});

test("one canvas serves every frame; its size is assigned only when it changes", () => {
  const f = fakes(), pixelsOf = createPixelReader(f.makeCanvas);
  pixelsOf({ bitmap: f.bitmap(), width: 2, height: 2 }); // the handshake's probe
  pixelsOf({ bitmap: f.bitmap(), width: 960, height: 1280 });
  pixelsOf({ bitmap: f.bitmap(), width: 960, height: 1280 });
  pixelsOf({ bitmap: f.bitmap(), width: 960, height: 720 });
  assert.deepEqual(f.made, [[2, 2]], "one canvas");
  assert.deepEqual(f.ops.filter(([op]) => op === "width" || op === "height"),
    [["width", 960], ["height", 1280], ["height", 720]]);
  const draws = f.ops.filter(([op]) => op === "drawImage").map(([, , ...box]) => box.join(" "));
  assert.deepEqual(draws, ["0 0 2 2", "0 0 960 1280", "0 0 960 1280", "0 0 960 720"]);
  // Every draw starts on a cleared bitmap: a snapshot that drew nothing must
  // not leave the previous frame's pixels.
  f.ops.forEach(([op], i) => { if (op === "drawImage") assert.equal(f.ops[i - 1][0], "clearRect"); });
});

for (const [name, options, expected] of [
  ["without a 2D context", { context: false }, /No 2D canvas/],
  ["when drawing fails", { draw: () => { throw new DOMException("detached", "InvalidStateError"); } }, /detached/],
]) test(`the bitmap is closed ${name}`, () => {
  const f = fakes(options), pixelsOf = createPixelReader(f.makeCanvas), bitmap = f.bitmap();
  assert.throws(() => pixelsOf({ bitmap, width: 64, height: 64 }), expected);
  assert.equal(bitmap.closed, 1);
});

test("the bitmap is closed when no canvas can be made (no OffscreenCanvas in the worker)", () => {
  const bitmap = { width: 2, height: 2, closed: 0, close() { this.closed++; } };
  assert.throws(() => createPixelReader()({ bitmap, width: 2, height: 2 }), ReferenceError, "Node has no OffscreenCanvas");
  assert.equal(bitmap.closed, 1);
  const thrower = createPixelReader(() => { throw Error("out of memory"); }), other = { width: 2, height: 2, closed: 0, close() { this.closed++; } };
  assert.throws(() => thrower({ bitmap: other, width: 2, height: 2 }), /out of memory/);
  assert.equal(other.closed, 1);
});

// What WebKit delivers for a bitmap it could not move to the worker: null
// (from iOS 18), or a 0 x 0 bitmap (iOS 16.4 to 17); and a bitmap smaller than
// the pixels asked of it, such as WebKit's blank 1 x 1 copy, is no snapshot.
// None is drawn: the reader throws (the worker answers "bitmap-unsupported")
// without touching its canvas, and closes what it can.
for (const [name, make] of [
  ["null", () => null],
  ["0 x 0", (f) => f.bitmap(0, 0)],
  ["1 x 1", (f) => f.bitmap(1, 1)],
  ["one row short", (f) => f.bitmap(960, 1279)],
]) test(`a bitmap that did not arrive whole (${name}) is not read back`, () => {
  const f = fakes(), pixelsOf = createPixelReader(f.makeCanvas), bitmap = make(f);
  assert.throws(() => pixelsOf({ bitmap, width: 960, height: 1280 }), /did not arrive whole/);
  assert.deepEqual(f.made, []); assert.deepEqual(f.ops, []);
  if (bitmap) assert.equal(bitmap.closed, 1);
  // The reader still serves the next bitmap.
  assert.equal(pixelsOf({ bitmap: f.bitmap(), width: 960, height: 1280 }).width, 960);
});

// A bitmap of the right size that draws nothing (a buffer lost on its way),
// or not over the whole canvas, leaves the cleared canvas transparent there:
// that is no camera snapshot, which is opaque, and is not taken for one.
for (const paint of ["none", "left"]) test(`a readback left ${paint === "none" ? "transparent" : "transparent in part"} by its bitmap is refused`, () => {
  const f = fakes({ paint }), pixelsOf = createPixelReader(f.makeCanvas), bitmap = f.bitmap();
  assert.throws(() => pixelsOf({ bitmap, width: 960, height: 1280 }), /drew nothing/);
  assert.equal(bitmap.closed, 1);
  assert.deepEqual(f.ops.map(([op]) => op), ["getContext", "clearRect", "drawImage", "getImageData"], "drawn and read back, then refused");
});
