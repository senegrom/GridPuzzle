import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { memoryCache, memoryCaches, source } from "./service-worker-fixture.js";
// Contract of the content-addressed store: ordinary reads trust bytes that
// were digest-verified before being written; readiness checks and offline
// preparation re-hash, evict wrong bytes and refetch; failed network
// verification is never cached; storage failure never blocks a verified
// online response.
function harness() {
  const calls = [],
    hooks = { respond: null },
    { caches, stores } = memoryCaches();
  const cache = memoryCache(),
    entries = cache.entries;
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
    caches,
    fetch: async (request) => {
      calls.push(request.url);
      return hooks.respond?.(request) ?? new Response("correct");
    },
  });
  vm.runInContext(
    source +
      "\nglobalThis.api={verifiedAsset,offlineReadyFast,offlineReadyVerified,assetKey,routeAsset,manifest};",
    context,
  );
  const asset = {
    path: "runtime.wasm",
    sha256: createHash("sha256").update("correct").digest("hex"),
  };
  return {
    entries,
    calls,
    hooks,
    stores,
    cache,
    asset,
    key: String(context.api.assetKey(asset)),
    ...context.api,
  };
}
const manifestResponse = (build, assets) =>
  new Response(JSON.stringify({ build, assets }), {
    headers: { "content-type": "application/json" },
  });
test("an evicted asset list is restored online and stays unavailable offline", async () => {
  const h = harness();
  h.hooks.respond = (request) =>
    request.url.endsWith("/assets.json")
      ? manifestResponse("__BUILD_ID__", [h.asset])
      : null;
  await assert.rejects(h.manifest(), /missing/);
  assert.equal(h.calls.length, 0, "offline lookups never fetch");
  assert.deepEqual(await h.manifest({ network: true }), [h.asset]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await h.manifest(), [h.asset], "the restored list is cached");
  assert.equal(h.calls.length, 1);
});
test("a worker never adopts another build's asset list", async () => {
  const h = harness();
  h.hooks.respond = (request) =>
    request.url.endsWith("/assets.json") ? manifestResponse("other", []) : null;
  await assert.rejects(h.manifest({ network: true }), /Update the app/);
  await assert.rejects(h.manifest(), /missing/, "nothing was stored");
});
test("assets are keyed by content digest inside the worker scope", () => {
  const h = harness();
  assert.equal(
    h.key,
    `https://example.test/GridPuzzle/.gridpuzzle-cache/${h.asset.sha256}`,
  );
});
test("root navigation ignores query strings but not subpaths", () => {
  const h = harness(),
    root = new URL("https://example.test/GridPuzzle/?share=1"),
    sub = new URL("https://example.test/GridPuzzle/help?share=1"),
    other = new URL("https://example.test/Other/");
  assert.equal(
    h.routeAsset({ mode: "navigate" }, root),
    "https://example.test/GridPuzzle/index.html",
  );
  assert.equal(h.routeAsset({ mode: "navigate" }, sub), sub.href);
  assert.equal(h.routeAsset({ mode: "navigate" }, other), other.href);
  assert.equal(h.routeAsset({ mode: "cors" }, root), root.href);
});
test("verified readiness evicts a poisoned asset; preparation refetches it once", async () => {
  const h = harness();
  h.entries.set(h.key, new Response("wrong version"));
  assert.equal(
    await h.offlineReadyFast(h.cache, [h.asset]),
    true,
    "the cheap check only tests presence",
  );
  assert.equal(await h.offlineReadyVerified(h.cache, [h.asset]), false);
  assert.equal(h.entries.has(h.key), false);
  assert.equal(h.calls.length, 0);
  assert.equal(
    await (await h.verifiedAsset(h.cache, h.asset)).text(),
    "correct",
  );
  assert.equal(h.calls.length, 1);
  assert.equal(await h.offlineReadyVerified(h.cache, [h.asset]), true);
  await h.cache.delete(h.key);
  assert.equal(await h.offlineReadyFast(h.cache, [h.asset]), false);
  assert.equal(await h.offlineReadyVerified(h.cache, [h.asset]), false);
});
test("ordinary reads trust stored bytes; verified reads repair them without a status check first", async () => {
  const h = harness();
  h.entries.set(h.key, new Response("bad"));
  assert.equal(await (await h.verifiedAsset(h.cache, h.asset)).text(), "bad");
  assert.equal(h.calls.length, 0);
  assert.equal(
    await (
      await h.verifiedAsset(h.cache, h.asset, { verifyStored: true })
    ).text(),
    "correct",
  );
  assert.equal(h.calls.length, 1);
  await h.verifiedAsset(h.cache, h.asset, { verifyStored: true });
  assert.equal(h.calls.length, 1);
});
test("mismatched network bytes are never cached and a corrected retry succeeds", async () => {
  const h = harness(),
    wrong = { ...h.asset, sha256: "0".repeat(64) };
  await assert.rejects(h.verifiedAsset(h.cache, wrong), /Asset changed/);
  assert.equal(h.entries.size, 0);
  await h.verifiedAsset(h.cache, h.asset);
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries.has(h.key), true);
});
test("offline-only lookups never touch the network", async () => {
  const h = harness();
  assert.equal(
    await h.verifiedAsset(h.cache, h.asset, { network: false }),
    null,
  );
  assert.equal(h.calls.length, 0);
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
