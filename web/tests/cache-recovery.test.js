import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
function harness() {
  const entries = new Map(),
    calls = [];
  const cache = {
    match: async (key) => entries.get(String(key))?.clone(),
    put: async (key, value) => entries.set(String(key), value.clone()),
    delete: async (key) => entries.delete(String(key)),
  };
  const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const context = vm.createContext({
    URL,
    Request,
    Response,
    Uint8Array,
    crypto: webcrypto,
    self: {
      registration: { scope: "https://example.test/GridPuzzle/" },
      location: { origin: "https://example.test" },
      addEventListener() {},
    },
    fetch: async (request) => {
      calls.push(request.url);
      return new Response("correct");
    },
  });
  vm.runInContext(
    source + "\nglobalThis.api={verifiedAsset,offlineReady};",
    context,
  );
  const asset = {
    path: "runtime.wasm",
    sha256: createHash("sha256").update("correct").digest("hex"),
  };
  return { entries, calls, cache, asset, ...context.api };
}
test("false readiness evicts a poisoned asset and preparation refetches", async () => {
  const h = harness(),
    key = "https://example.test/GridPuzzle/runtime.wasm";
  h.entries.set(key, new Response("wrong version"));
  assert.equal(await h.offlineReady(h.cache, [h.asset]), false);
  assert.equal(h.entries.has(key), false);
  assert.equal(h.calls.length, 0);
  assert.equal(
    await (await h.verifiedAsset(h.cache, h.asset)).text(),
    "correct",
  );
  assert.equal(h.calls.length, 1);
  assert.equal(await h.offlineReady(h.cache, [h.asset]), true);
  await h.cache.delete(key);
  assert.equal(await h.offlineReady(h.cache, [h.asset]), false);
});
test("retry repairs bad cached bytes, without requiring a status check first", async () => {
  const h = harness();
  h.entries.set(
    "https://example.test/GridPuzzle/runtime.wasm",
    new Response("bad"),
  );
  await h.verifiedAsset(h.cache, h.asset);
  assert.equal(h.calls.length, 1);
  await h.verifiedAsset(h.cache, h.asset);
  assert.equal(h.calls.length, 1);
});
test("mismatched network bytes never become ready and a corrected retry succeeds", async () => {
  const h = harness(),
    wrong = { ...h.asset, sha256: "0".repeat(64) };
  await assert.rejects(h.verifiedAsset(h.cache, wrong), /Asset changed/);
  assert.equal(h.entries.size, 0);
  await h.verifiedAsset(h.cache, h.asset);
  assert.equal(h.calls.length, 2);
});
test("cache quota errors do not block verified online responses", async () => {
  const h = harness();
  h.cache.put = async () => {
    throw Error("quota");
  };
  assert.equal(
    await (
      await h.verifiedAsset(h.cache, h.asset, { requireStorage: false })
    ).text(),
    "correct",
  );
  await assert.rejects(h.verifiedAsset(h.cache, h.asset), /quota/);
});
