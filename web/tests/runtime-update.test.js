import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activateWorker, memoryCaches, scope } from "./service-worker-fixture.js";

const prefix = `gridpuzzle:${scope}:`;
const first = "111111111111", second = "222222222222", third = "333333333333", fourth = "444444444444";
const hash = (body) => createHash("sha256").update(body).digest("hex");
function runtimeUpdates({ changed = true } = {}) {
  const { caches, stores } = memoryCaches(), requests = [];
  let build, clients = [], offline = false;
  const root = (version) => `vendor/${version}/pyodide/`;
  const files = (version) => ({
    "index.html": `page ${version}`,
    [`solver-worker.${version}.js`]: `worker ${version}`,
    [`solver.${version}.zip`]: `solver ${version}`,
    [root(version) + "pyodide.mjs"]: "identical module with relative imports",
    [root(version) + "pyodide.asm.wasm"]: changed ? `WASM ${version}` : "same WASM",
    [root(version) + "python_stdlib.zip"]: `stdlib ${version}`,
    [root(version) + "pyodide-lock.json"]: `lock ${version}`,
  });
  const assets = (version) => Object.entries(files(version)).map(([path, data]) => ({ path, sha256: hash(data) }));
  return {
    files, root, requests, stores,
    clients(ids) { clients = ids.map((id) => ({ id, type: "window", url: scope })); },
    offline(value) { offline = value; },
    async cached(version, file) {
      return Boolean(await (await caches.open(prefix + "content-v1")).match(scope + ".gridpuzzle-cache/" + hash(files(version)[file])));
    },
    activate(version, beforeActivation) {
      build = version;
      return activateWorker({
        build, caches, clients: () => clients, beforeActivation,
        fetch: async (request) => {
          const path = request.url.slice(scope.length); requests.push(path);
          if (offline) throw TypeError("Network offline");
          if (path === "assets.json") return new Response(JSON.stringify({ build, assets: assets(build) }));
          const body = files(build)[path];
          return new Response(body ?? "Not found", { status: body === undefined ? 404 : 200 });
        },
      });
    },
  };
}

for (const changed of [true, false])
  test(`versioned runtime survives updates (${changed ? "changed" : "reused"} bytes) online and offline`, async () => {
    const h = runtimeUpdates({ changed }), oldRead = await h.activate(first);
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

test("immutable old dependencies resolve before activation has created its retention index", async () => {
  const h = runtimeUpdates(), oldRead = await h.activate(first);
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
  // middle-tab appears here, so it loaded build two; it never ran build three.
  h.clients(["old-tab", "middle-tab"]); await h.activate(third);
  h.clients(["middle-tab"]); const read = await h.activate(fourth);
  assert.equal(h.stores.has(prefix + `meta:${first}`), false);
  assert.equal(await h.cached(first, h.root(first) + "pyodide.asm.wasm"), false);
  assert.equal((await read(h.root(first) + "pyodide.asm.wasm")).status, 404);
  assert.equal(h.stores.has(prefix + `meta:${second}`), true, "the surviving tab's own build stays");
  assert.equal(h.stores.has(prefix + `meta:${third}`), false, "a build no live client ever ran is released");
  h.offline(true);
  assert.equal(await (await read(h.root(second) + "pyodide.asm.wasm", "middle-tab")).text(), `WASM ${second}`);
});

test("navigation loads the new app even when the old document has a retained manifest", async () => {
  const h = runtimeUpdates(); await h.activate(first);
  h.clients(["old-tab"]); const read = await h.activate(second);
  assert.equal(await (await read("?launch=1", "old-tab", true)).text(), `page ${second}`);
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

test("one long-lived tab does not become the owner of every later build", async () => {
  const h = runtimeUpdates(), one = await h.activate(first);
  for (const path of Object.keys(h.files(first))) await one(path);
  h.clients(["old-tab"]); await h.activate(second);
  h.clients(["old-tab"]); await h.activate(third);
  h.clients(["old-tab"]); await h.activate(fourth);
  assert.equal(h.stores.has(prefix + `meta:${first}`), true, "the tab's own build stays retained");
  assert.equal(h.stores.has(prefix + `meta:${second}`), false, "the tab never ran build two");
  assert.equal(h.stores.has(prefix + `meta:${third}`), false, "nor build three");
});
