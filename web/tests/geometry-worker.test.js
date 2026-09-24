import test, { after } from "node:test";
import assert from "node:assert/strict";

// The worker module installs self.onmessage; each request gets exactly one
// reply, { result } with its pixel buffers transferred or { error }.
const posted = [], previousSelf = globalThis.self;
globalThis.self = { postMessage: (message, transfer = []) => posted.push({ message, transfer }) };
after(() => { if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf; });
await import("../geometry-worker.js");
const worker = globalThis.self;
function send(data) {
  posted.length = 0; worker.onmessage({ data });
  assert.equal(posted.length, 1, "exactly one reply per request");
  return posted[0];
}
function board(size = 360, cells = 4, margin = 40) {
  const data = new Uint8ClampedArray(size * size * 4).fill(255), step = (size - 2 * margin) / cells;
  const paint = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) data.fill(0, 4 * (yy * size + xx), 4 * (yy * size + xx) + 3);
  };
  for (let i = 0; i <= cells; i++) {
    const at = Math.round(margin + i * step);
    paint(at - 1, margin - 1, 3, size - 2 * margin + 3); paint(margin - 1, at - 1, size - 2 * margin + 3, 3);
  }
  return { width: size, height: size, data };
}
const corners = [{ x: 40, y: 40 }, { x: 320, y: 40 }, { x: 320, y: 320 }, { x: 40, y: 320 }];

test("detect replies with corners inside the image, sharpness and quality, and transfers nothing", () => {
  const { message, transfer } = send({ op: "detect", image: board(), thorough: false, rows: 4, cols: 4 });
  assert.equal(message.error, undefined);
  const { result } = message;
  assert.ok(result.confidence >= .8, `a plain grid is found (confidence ${result.confidence})`);
  assert.equal(result.corners.length, 4);
  for (const p of result.corners) assert.ok(p.x >= 0 && p.y >= 0 && p.x <= 359 && p.y <= 359, JSON.stringify(p));
  assert.ok(Number.isFinite(result.sharpness)); assert.equal(typeof result.quality, "object");
  assert.deepEqual(transfer, []);
});

test("warp output is bounded to 32..1600 pixels a side and its buffer is transferred", () => {
  for (const [width, height, expected] of [[5000, 10, [1600, 32]], [300, 200, [300, 200]]]) {
    const { message, transfer } = send({ op: "warp", image: board(), corners, width, height });
    const { image, meta } = message.result;
    assert.deepEqual([image.width, image.height], expected);
    assert.equal(image.data.length, expected[0] * expected[1] * 4);
    assert.ok(meta); assert.deepEqual(transfer, [image.data.buffer]);
  }
});

test("prepare transfers the warped image, mask and grayscale buffers", () => {
  const { message, transfer } = send({ op: "prepare", image: board(), corners, width: 400, height: 400, type: "latinsquare", rows: 4, cols: 4 });
  const { result } = message;
  assert.equal(message.error, undefined); assert.ok(Array.isArray(result.entries));
  assert.deepEqual(transfer, [result.image.data.buffer, result.mask.buffer, result.g.buffer]);
});

test("failures reply with a message instead of throwing out of the worker", () => {
  assert.deepEqual(send({ op: "rotate", image: board() }).message, { error: "Unknown image task" });
  const crossed = [corners[0], corners[2], corners[1], corners[3]];
  assert.match(send({ op: "warp", image: board(), corners: crossed, width: 300, height: 300 }).message.error, /clockwise/);
  const broken = send({ op: "detect", image: null });
  assert.equal(typeof broken.message.error, "string"); assert.equal(broken.message.result, undefined);
  assert.deepEqual(broken.transfer, []);
});
