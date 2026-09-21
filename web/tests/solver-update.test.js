import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activateWorker, memoryCaches, scope } from "./service-worker-fixture.js";

const prefix = `gridpuzzle:${scope}:`;
function updates({ identical = false } = {}) {
  const { caches, stores } = memoryCaches(), requests = [];
  let build = null, clients = [], offline = false;
  const body = (version) => identical ? "same solver" : `solver ${version}`;
  const assets = (version) => [{
    path: `solver.${version}.zip`,
    sha256: createHash("sha256").update(body(version)).digest("hex"),
  }];
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
    activate(version, installed) {
      build = version;
      return activateWorker({ build, caches, fetch: network, clients: () => clients, beforeActivation: installed });
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
  // new-worker appeared at the third update, so it runs build two: that archive
  // stays, while build three, which no live client ever ran, is released.
  assert.equal((await fetch(`solver.${second}.zip`)).status, 200);
  assert.equal((await fetch(`solver.${third}.zip`)).status, 404, "a worker owns only the build it loaded");
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
