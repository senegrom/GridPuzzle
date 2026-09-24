// The offline download stores only the Tesseract core this device will load.
// tesseract.js 6.0.1 picks the SIMD LSTM core where wasm-feature-detect's
// simd() probe validates and the plain LSTM core elsewhere; the service
// worker runs the same probe, and keeps both where it cannot run it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";

const build = "111111111111";
const scope = "https://example.test/GridPuzzle/";
const plain = `vendor/${build}/tesseract-core/tesseract-core-lstm.wasm.js`;
const simd = `vendor/${build}/tesseract-core/tesseract-core-simd-lstm.wasm.js`;
// wasm-feature-detect's simd() probe, byte for byte as tesseract.js 6.0.1 ships it.
const PROBE = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];

function harness(webAssembly) {
  const listeners = {}, fetched = [], entries = new Map(), bodies = new Map();
  const asset = (path) => {
    const body = `bytes of ${path}`;
    bodies.set(path, body);
    return { path, sha256: createHash("sha256").update(body).digest("hex") };
  };
  const manifest = JSON.stringify({ build, assets: [asset("index.html"), asset(plain), asset(simd)] });
  const key = (request) => (typeof request === "string" ? request : request.url);
  const cache = {
    async match(request) {
      if (key(request).endsWith("assets.json")) return new Response(manifest);
      return entries.get(key(request))?.clone();
    },
    async put(request, response) { entries.set(key(request), response.clone()); },
    async delete(request) { return entries.delete(key(request)); },
  };
  const probes = [];
  const context = {
    URL, Request, Response, AbortController, Uint8Array, crypto: webcrypto,
    caches: { open: async () => cache },
    setTimeout: () => 0, clearTimeout() {},
    fetch(request) {
      const path = key(request).slice(scope.length);
      fetched.push(path);
      return Promise.resolve(new Response(path === "assets.json" ? manifest : bodies.get(path)));
    },
    self: { registration: { scope }, location: { origin: "https://example.test" },
      addEventListener(type, listener) { listeners[type] = listener; }, skipWaiting() {} },
  };
  // A new context brings V8's own WebAssembly; undefined shadows it.
  context.WebAssembly = webAssembly
    ? { validate(bytes) { probes.push([...bytes]); return webAssembly(bytes); } }
    : undefined;
  const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8").replace("__BUILD_ID__", build);
  vm.runInNewContext(source, context);
  async function send(type) {
    const messages = [];
    let promise;
    const port = { postMessage(message) { messages.push(message); }, close() {} };
    listeners.message({ data: { type }, ports: [port], source: { id: "tab" }, waitUntil(p) { promise = p; } });
    await promise;
    // Messages come from the worker's realm; compare them as plain data.
    return JSON.parse(JSON.stringify(messages.at(-1)));
  }
  return { fetched, probes, send };
}

test("a device with WebAssembly SIMD stores only the SIMD core", async () => {
  const h = harness(() => true);
  assert.equal((await h.send("PREPARE_OFFLINE")).ready, true);
  assert.ok(h.fetched.includes(simd));
  assert.ok(!h.fetched.includes(plain), "the plain core is never downloaded");
  assert.deepEqual(await h.send("OFFLINE_STATUS"), { done: true, ready: true });
  assert.deepEqual(h.probes[0], PROBE, "the same probe tesseract.js runs");
});

test("a device without WebAssembly SIMD stores only the plain core", async () => {
  const h = harness(() => false);
  assert.equal((await h.send("PREPARE_OFFLINE")).ready, true);
  assert.ok(h.fetched.includes(plain));
  assert.ok(!h.fetched.includes(simd), "the SIMD core is never downloaded");
  assert.deepEqual(await h.send("OFFLINE_STATUS"), { done: true, ready: true });
});

test("where WebAssembly cannot be probed both cores are stored", async () => {
  for (const webAssembly of [null, () => { throw Error("blocked"); }]) {
    const h = harness(webAssembly);
    assert.equal((await h.send("PREPARE_OFFLINE")).ready, true);
    assert.ok(h.fetched.includes(plain) && h.fetched.includes(simd));
  }
});
