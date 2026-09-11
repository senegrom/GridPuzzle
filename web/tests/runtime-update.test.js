import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";

const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const scope = "https://example.test/GridPuzzle/", prefix = `gridpuzzle:${scope}:`;
const first = "111111111111", second = "222222222222", third = "333333333333", fourth = "444444444444";
const hash = (body) => createHash("sha256").update(body).digest("hex");
function runtimeUpdates({ legacy = false, changed = true, legacyBuilds = legacy ? [first] : [] } = {}) {
  const stores = new Map(), requests = [];
  let build, clients = [], offline = false;
  const root = (version) => legacyBuilds.includes(version) ? "vendor/pyodide/" : `vendor/${version}/pyodide/`;
  const files = (version) => ({
    "index.html": `page ${version}`,
    "solver-worker.js": `legacy alias ${version}`,
    [`solver-worker.${version}.js`]: `worker ${version}`,
    [`solver.${version}.zip`]: `solver ${version}`,
    [root(version) + "pyodide.mjs"]: "identical module with relative imports",
    [root(version) + "pyodide.asm.wasm"]: changed ? `WASM ${version}` : "same WASM",
    [root(version) + "python_stdlib.zip"]: `stdlib ${version}`,
    [root(version) + "pyodide-lock.json"]: `lock ${version}`,
  });
  const assets = (version) => Object.entries(files(version)).map(([path, data]) => ({ path, sha256: hash(data) }));
  const key = (r) => typeof r === "string" ? r : r.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async match(r) { return entries.get(key(r))?.clone(); },
          async put(r, response) { entries.set(key(r), response.clone()); },
          async delete(r) { return entries.delete(key(r)); },
          async keys() { return [...entries.keys()].map((u) => new Request(u)); },
        });
      }
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); },
  };
  return {
    files, root, requests, stores,
    clients(ids) { clients = ids.map((id) => ({ id, type: "window", url: scope })); },
    offline(value) { offline = value; },
    async cached(version, file) {
      return Boolean(await (await caches.open(prefix + "content-v1")).match(scope + ".gridpuzzle-cache/" + hash(files(version)[file])));
    },
    async activate(version, beforeActivation) {
      build = version;
      const listeners = {};
      vm.runInNewContext(source.replace("__BUILD_ID__", version), {
        URL, Request, Response, Uint8Array, crypto: webcrypto, caches,
        fetch: async (request) => {
          const path = key(request).slice(scope.length); requests.push(path);
          if (offline) throw TypeError("Network offline");
          if (path === "assets.json") return new Response(JSON.stringify({ build, assets: assets(build) }));
          const body = files(build)[path];
          return new Response(body ?? "Not found", { status: body === undefined ? 404 : 200 });
        },
        self: {
          registration: { scope }, location: { origin: new URL(scope).origin },
          clients: { claim: async () => {}, matchAll: async () => clients },
          skipWaiting() {}, addEventListener(type, fn) { listeners[type] = fn; },
        },
      });
      const read = async (path, clientId = "", navigation = false) => {
        let response;
        const request = new Request(scope + path);
        if (navigation) Object.defineProperty(request, "mode", { value: "navigate" });
        listeners.fetch({ request, clientId, respondWith(promise) { response = promise; } });
        return response;
      };
      for (const type of ["install", "activate"]) {
        if (type === "activate" && beforeActivation) await beforeActivation(read);
        let done; listeners[type]({ waitUntil(promise) { done = promise; } }); await done;
      }
      return read;
    },
  };
}

for (const changed of [true, false])
  for (const legacy of [true, false])
    test(`${legacy ? "legacy" : "versioned"} runtime survives updates (${changed ? "changed" : "reused"} bytes) online and offline`, async () => {
      const h = runtimeUpdates({ legacy, changed }), oldRead = await h.activate(first);
      const oldPaths = Object.keys(h.files(first));
      for (const path of oldPaths) assert.equal(await (await oldRead(path)).text(), h.files(first)[path]);
      h.clients(["old-tab"]);
      const newRead = await h.activate(second);
      for (const path of oldPaths) assert.equal(await h.cached(first, path), true, path);
      h.offline(true);
      const before = h.requests.length;
      for (const path of oldPaths) {
        assert.equal(await (await oldRead(path, "old-tab")).text(), h.files(first)[path]);
        assert.equal(await (await newRead(path, "old-tab")).text(), h.files(first)[path]);
      }
      for (const path of Object.keys(h.files(second)))
        assert.equal(await (await newRead(path, "new-tab")).text(), h.files(second)[path]);
      assert.equal(h.requests.length, before, "every dependency is available without network fallback");
    });

test("new Python runtimes are complete at installation, before any solver starts", async () => {
  const h = runtimeUpdates(); await h.activate(first);
  for (const path of Object.keys(h.files(first))) assert.equal(await h.cached(first, path), true, path);
});

for (const legacy of [true, false])
  test(`${legacy ? "legacy" : "immutable"} old dependencies resolve before activation has created its retention index`, async () => {
    const h = runtimeUpdates({ legacy }), oldRead = await h.activate(first);
    for (const path of Object.keys(h.files(first))) await oldRead(path);
    h.clients(["old-tab"]);
    await h.activate(second, async (newRead) => {
      h.offline(true);
      for (const id of ["old-tab", "unlisted-worker", ""])
        for (const file of ["pyodide.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"])
          assert.equal(await (await newRead(h.root(first) + file, id)).text(), h.files(first)[h.root(first) + file]);
      h.offline(false);
    });
  });

test("later clients do not extend the lifetime of old dependency graphs", async () => {
  const h = runtimeUpdates(), oldRead = await h.activate(first);
  for (const path of Object.keys(h.files(first))) await oldRead(path);
  h.clients(["old-tab"]); await h.activate(second);
  h.clients(["old-tab", "middle-tab"]); await h.activate(third);
  h.clients(["middle-tab"]); const read = await h.activate(fourth);
  assert.equal(h.stores.has(prefix + `meta:${first}`), false);
  assert.equal(await h.cached(first, h.root(first) + "pyodide.asm.wasm"), false);
  assert.equal((await read(h.root(first) + "pyodide.asm.wasm")).status, 404);
  h.offline(true);
  assert.equal(await (await read(h.root(third) + "pyodide.asm.wasm")).text(), `WASM ${third}`);
});

test("navigation loads the new app even when the old document has a retained manifest", async () => {
  const h = runtimeUpdates(); await h.activate(first);
  h.clients(["old-tab"]); const read = await h.activate(second);
  assert.equal(await (await read("?launch=1", "old-tab", true)).text(), `page ${second}`);
});


test("legacy workers without an enumerated client ID keep unambiguous cached dependencies", async () => {
  const h = runtimeUpdates({ legacy: true }), oldRead = await h.activate(first);
  for (const path of Object.keys(h.files(first))) await oldRead(path);
  h.clients(["old-tab"]); const read = await h.activate(second);
  h.offline(true); const count = h.requests.length;
  for (const id of ["", "unlisted-worker"])
    for (const file of ["pyodide.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"])
      assert.equal(await (await read("vendor/pyodide/" + file, id)).text(), h.files(first)["vendor/pyodide/" + file]);
  assert.equal(h.requests.length, count, "routing must not depend on a replaced origin URL");
});

test("unidentified legacy clients never receive a guessed dependency from conflicting old manifests", async () => {
  const h = runtimeUpdates({ legacyBuilds: [first, second] }), one = await h.activate(first);
  for (const path of Object.keys(h.files(first))) await one(path);
  h.clients(["old-tab"]); const two = await h.activate(second);
  for (const path of Object.keys(h.files(second)))
    assert.equal(await (await two(path, "second-tab")).text(), h.files(second)[path]);
  h.clients(["old-tab", "second-tab"]); const three = await h.activate(third);
  h.offline(true); const count = h.requests.length;
  await assert.rejects(three("vendor/pyodide/pyodide.asm.wasm", "unlisted-worker"), /Cannot identify the outgoing runtime version/);
  assert.equal(await (await three("vendor/pyodide/pyodide.mjs", "unlisted-worker")).text(), "identical module with relative imports");
  assert.equal(h.requests.length, count, "ambiguous bytes must fail closed, not fall back to the origin");
});

for (const failure of ["evicted manifest", "retention index write"])
  test(`a failed activation (${failure}) does not poison request routing for the worker's lifetime`, async () => {
    const h = runtimeUpdates(), meta = () => h.stores.get(prefix + `meta:${first}`);
    let read;
    try {
      read = await h.activate(first, async () => {
        if (failure === "evicted manifest") await meta().delete(scope + "assets.json");
        else {
          const put = meta().put;
          meta().put = async (request, response) => {
            if ((typeof request === "string" ? request : request.url).endsWith(".retained-solvers.json")) throw new DOMException("Quota exceeded", "QuotaExceededError");
            return put(request, response);
          };
        }
      });
    } catch (error) {
      assert.fail(`activation must complete instead of rejecting: ${error.message}`);
    }
    for (const path of ["index.html", `solver.${first}.zip`, h.root(first) + "pyodide.asm.wasm"])
      assert.equal(await (await read(path, "tab")).text(), h.files(first)[path], path);
  });
