import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";

const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const scope = "https://example.test/GridPuzzle/";
const prefix = `gridpuzzle:${scope}:`;
function updates({ identical = false } = {}) {
  const stores = new Map(), requests = [];
  let build = null, clients = [], offline = false;
  const body = (version) => identical ? "same solver" : `solver ${version}`;
  const assets = (version) => [{
    path: `solver.${version}.zip`,
    sha256: createHash("sha256").update(body(version)).digest("hex"),
  }];
  const key = (request) => typeof request === "string" ? request : request.url;
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          match: async (request) => entries.get(key(request))?.clone(),
          put: async (request, response) => { entries.set(key(request), response.clone()); },
          delete: async (request) => entries.delete(key(request)),
          keys: async () => [...entries.keys()].map((url) => new Request(url)),
        });
      }
      return stores.get(name);
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  const network = async (request) => {
    const path = request.url.slice(scope.length);
    requests.push(path);
    if (offline) throw TypeError("Network offline");
    if (path === "assets.json") return new Response(JSON.stringify({ build, assets: assets(build) }));
    return path === `solver.${build}.zip`
      ? new Response(body(build)) : new Response("Not found", { status: 404 });
  };
  return {
    stores, requests,
    offline(value) { offline = value; },
    workers(ids) { clients = ids.map((id) => ({ id, url: scope + "solver-worker.js" })); },
    tabs(ids) { clients = ids.map((id) => ({ id, type: "window", url: scope })); },
    async activate(version, installed) {
      build = version;
      const listeners = {};
      vm.runInNewContext(source.replace("__BUILD_ID__", version), {
        URL, Request, Response, Uint8Array, crypto: webcrypto, caches, fetch: network,
        self: {
          registration: { scope }, location: { origin: new URL(scope).origin },
          clients: { claim: async () => {}, matchAll: async () => clients },
          skipWaiting() {}, addEventListener: (type, listener) => { listeners[type] = listener; },
        },
      });
      const fetch = async (path) => {
        let response;
        listeners.fetch({ request: new Request(scope + path), respondWith(promise) { response = promise; } });
        return response;
      };
      for (const type of ["install", "activate"]) {
        if (type === "activate" && installed) await installed(fetch);
        let done;
        listeners[type]({ waitUntil(promise) { done = promise; } });
        await done;
      }
      return fetch;
    },
  };
}
const first = "111111111111", second = "222222222222", third = "333333333333", fourth = "444444444444";
test("an old archive resolves before the new controller's activation migration finishes", async () => {
  const h = updates();
  await h.activate(first);
  h.workers(["old-worker"]);
  await h.activate(second, async (fetch) => {
    const count = h.requests.length;
    assert.equal((await fetch(`solver.${first}.zip`)).status, 200);
    assert.equal(h.requests.length, count);
  });
});
for (const identical of [false, true])
  test(`an initializing old solver keeps its archive after activation (${identical ? "reused" : "changed"} bytes)`, async () => {
    const h = updates({ identical });
    const oldFetch = await h.activate(first);
    h.workers(["old-worker"]);
    const fetch = await h.activate(second);
    const count = h.requests.length;
    assert.equal((await fetch(`solver.${first}.zip`)).status, 200);
    assert.equal((await oldFetch(`solver.${first}.zip`)).status, 200, "an old controller can still route an existing worker");
    h.offline(true);
    assert.equal((await fetch(`solver.${first}.zip`)).status, 200);
    assert.equal((await fetch(`solver.${second}.zip`)).status, 200);
    assert.equal(h.requests.length, count, "all archives come from verified storage");
    assert.equal(h.stores.has(prefix + `meta:${first}`), true, "keep the manifest for an existing worker's previous controller");
  });
test("later updates retain live owners without extending closed workers' archive lifetimes", async () => {
  const h = updates();
  await h.activate(first);
  h.workers(["old-worker"]);
  await h.activate(second);
  h.workers(["old-worker", "new-worker"]);
  let fetch = await h.activate(third);
  assert.equal((await fetch(`solver.${first}.zip`)).status, 200);
  h.workers(["new-worker"]);
  fetch = await h.activate(fourth);
  assert.equal((await fetch(`solver.${first}.zip`)).status, 404, "a newer worker cannot keep an obsolete archive alive");
  assert.equal((await fetch(`solver.${third}.zip`)).status, 200);
  const content = h.stores.get(prefix + "content-v1");
  const oldDigest = createHash("sha256").update(`solver ${first}`).digest("hex");
  assert.equal(await content.match(scope + ".gridpuzzle-cache/" + oldDigest), undefined);
  assert.equal(h.stores.has(prefix + `meta:${first}`), false);
});
test("an update with no existing solver clients releases previous archives", async () => {
  const h = updates();
  await h.activate(first);
  const fetch = await h.activate(second);
  assert.equal((await fetch(`solver.${first}.zip`)).status, 404);
  assert.equal((await h.stores.get(prefix + "content-v1").keys()).length, 1);
});
test("an existing tab protects a worker that is not enumerable yet", async () => {
  const h = updates();
  await h.activate(first);
  h.tabs(["old-tab"]);
  let fetch = await h.activate(second);
  h.offline(true);
  assert.equal((await fetch(`solver.${first}.zip`)).status, 200);
  h.offline(false);
  h.tabs(["new-tab"]);
  fetch = await h.activate(third);
  assert.equal((await fetch(`solver.${first}.zip`)).status, 404);
});
test("damaged previous metadata cannot prevent a verified update from activating", async () => {
  const h = updates();
  await h.activate(first);
  const old = h.stores.get(prefix + `meta:${first}`);
  await old.put(scope + "assets.json", new Response("invalid JSON"));
  await old.put(scope + ".retained-solvers.json", new Response("{}"));
  h.workers(["old-worker"]);
  const fetch = await h.activate(second);
  assert.equal((await fetch(`solver.${second}.zip`)).status, 200);
});
