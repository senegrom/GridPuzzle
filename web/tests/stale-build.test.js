// A page left on the previous build after a deploy. GitHub Pages replaces the
// whole site, so build X's versioned URLs return 404 while worker X still
// serves page X, until the user chooses "Update app & reload". Files X never
// stored (the OCR runtime, until a first scan) come from a newer build's
// identical copies (sw.js, relocated()); when none exists, the user is told
// to update rather than to retry.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { activateWorker, memoryCaches, scope } from "./service-worker-fixture.js";
import { createOCRRuntime } from "../ocr-runtime.js";

const X = "aaaaaaaaaaaa", Y = "bbbbbbbbbbbb", prefix = `gridpuzzle:${scope}:`;
const OCR = (build) => `vendor/${build}/tesseract/tesseract.min.js`;
const MODEL = (build) => `vendor/${build}/tessdata/eng.traineddata.gz`;
const hash = (body) => createHash("sha256").update(body).digest("hex");
function deploys() {
  const { caches, stores } = memoryCaches(), requests = [], modes = [], served = new Map(), runtimes = { [X]: "6.0.1" };
  let live = X, clients = [], offline = false;
  // Each build's files; vendor/ bytes are the same in every build unless a
  // deploy brings another OCR runtime.
  const files = (build) => ({
    "index.html": `page ${build}`,
    "ocr-host-worker.js": `importScripts("./${OCR(build)}")`,
    [`solver.${build}.zip`]: "solver bytes",
    [`vendor/${build}/pyodide/pyodide.mjs`]: "pyodide module",
    [MODEL(build)]: "model bytes",
    [OCR(build)]: `tesseract.js ${runtimes[build]}`,
  });
  const assets = (build) => Object.entries(files(build)).map(([path, data]) => ({ path, sha256: hash(data) }));
  const fetch = async (request) => {
    const path = request.url.slice(scope.length);
    requests.push(path); modes.push(request.cache);
    if (offline) throw TypeError("Network offline");
    if (path === "assets.json") return new Response(JSON.stringify({ build: live, assets: assets(live) }));
    if (served.has(path)) return served.get(path)();
    const body = files(live)[path];
    return new Response(body ?? "Not found", { status: body === undefined ? 404 : 200 });
  };
  return {
    // `modes` holds each request's HTTP cache mode, in the order of `requests`.
    files, requests, modes, stores,
    clients(ids) { clients = ids.map((id) => ({ id, type: "window", url: scope })); },
    offline(value) { offline = value; },
    // The origin now serves only `build` (with OCR runtime `runtime`).
    deploy(build, runtime = "6.0.1") { runtimes[build] = runtime; live = build; },
    // What the origin answers at `path` instead of the deployed file.
    serve(path, respond) { served.set(path, respond); },
    async stored(body) {
      return Boolean(await (await caches.open(prefix + "content-v1")).match(scope + ".gridpuzzle-cache/" + hash(body)));
    },
    activate(build, beforeActivation) {
      return activateWorker({ build, caches, fetch, clients: () => clients, beforeActivation });
    },
  };
}
const since = (h, start) => h.requests.slice(start);

test("a page left on the previous build loads the OCR it never used from the waiting build's copy", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  assert.equal(await h.stored(h.files(X)[OCR(X)]), false, "installation stores no OCR runtime");
  h.clients(["old-tab"]);
  h.deploy(Y);
  await h.activate(Y, async () => {
    const start = h.requests.length;
    for (const path of [OCR(X), MODEL(X)]) {
      const response = await oldRead(path, "old-tab");
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), h.files(X)[path]);
    }
    assert.deepEqual(since(h, start), [OCR(X), OCR(Y), MODEL(X), MODEL(Y)],
      "the waiting build's stored manifest names the copy: no manifest download");
    assert.equal(await h.stored(h.files(X)[OCR(X)]), true, "stored by digest for the next load");
    h.offline(true);
    assert.equal(await (await oldRead(OCR(X), "old-tab")).text(), h.files(X)[OCR(X)]);
  });
});

test("the old worker also serves a newer build's URL of bytes it lists", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y);
  await h.activate(Y, async () => {
    const response = await oldRead(OCR(Y), "old-tab");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), h.files(Y)[OCR(Y)]);
  });
});

test("before the newer build is installed, the origin's own manifest names the copy", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y);
  const start = h.requests.length, response = await oldRead(OCR(X), "old-tab");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), h.files(X)[OCR(X)]);
  assert.deepEqual(since(h, start), [OCR(X), "assets.json", OCR(Y)]);
  // GitHub Pages lets browsers keep every file for ten minutes, so the HTTP
  // cache could still hold the list of the build the deploy replaced.
  assert.equal(h.modes[start + 1], "reload", "the origin's list is read past the HTTP cache");
});

test("a copy is never served when its bytes do not match the digest, whatever a manifest claims", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y);
  h.serve(OCR(Y), () => new Response("tampered bytes"));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await oldRead(OCR(X), "old-tab");
    assert.equal(response.status, 502);
    assert.equal(await response.text(), "Request failed.");
  } finally { console.warn = warn; }
  assert.ok(h.requests.includes(OCR(Y)), "the listed copy was tried");
  assert.equal(await h.stored(h.files(X)[OCR(X)]), false);
  assert.equal(await h.stored("tampered bytes"), false);
});

test("the offline download of the previous build completes from the newer build's copies", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y);
  await h.activate(Y, async () => {
    const replies = await oldRead.send("PREPARE_OFFLINE", "old-tab");
    assert.equal(replies.at(-1).ready, true);
    for (const path of [OCR(X), MODEL(X)]) assert.equal(await h.stored(h.files(X)[path]), true, path);
  });
});

test("when a deploy changed the OCR runtime nothing is substituted, and the download names the file gone", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y, "6.0.2");
  await h.activate(Y, async () => {
    const warn = console.warn;
    console.warn = () => {};
    try { assert.equal((await oldRead(OCR(X), "old-tab")).status, 502); }
    finally { console.warn = warn; }
    const last = (await oldRead.send("PREPARE_OFFLINE", "old-tab")).at(-1);
    assert.equal(last.error, `Could not download ${OCR(X)}. Stay online and retry.`);
    assert.equal(last.gone, true);
  });
});

test("a file the server fails to send is not called gone", async () => {
  const h = deploys(), oldRead = await h.activate(X);
  h.deploy(Y, "6.0.2");
  h.serve(OCR(X), () => new Response("Service unavailable", { status: 503 }));
  const last = (await oldRead.send("PREPARE_OFFLINE", "old-tab")).at(-1);
  assert.equal(last.error, `Could not download ${OCR(X)}. Stay online and retry.`);
  assert.equal(last.gone, undefined);
});

// The OCR runtime: a host whose engine never became ready failed to LOAD
// OCR. While an update is offered, that is what the user is told.
function runtime(t, advice) {
  const workers = [], timers = new Map();
  let serial = 0;
  const api = createOCRRuntime({
    makeWorker() {
      const worker = { messages: [], postMessage(data) { this.messages.push(data); }, terminate() { this.terminated = true; } };
      workers.push(worker);
      return worker;
    },
    setTimer(fn, ms) { timers.set(++serial, { fn, ms }); return serial; },
    clearTimer(id) { timers.delete(id); },
    updateAdvice: (next) => advice ? `An updated version of the app is ready. Use “${advice}”, then ${next}.` : "",
  });
  t.after(() => api.dispose());
  return { api, workers, timers, message: (data) => workers.at(-1).onmessage({ data }) };
}
const IMPORT = `Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'https://example.test/GridPuzzle/${OCR(X)}' failed to load.`;
const ADVICE = "Recognition could not load. An updated version of the app is ready. Use “Update app & reload”, then try again.";

test("every OCR host loads its engine before its first request", (t) => {
  const h = runtime(t, "");
  void h.api.recognize({ png: "a" }).catch(() => {});
  assert.deepEqual(h.workers[0].messages.map((m) => m.type ?? "recognize"), ["warm", "recognize"]);
});

for (const reply of ["warm-up", "request"])
  test(`OCR whose ${reply} fails to load it names the offered update`, async (t) => {
    const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
    h.message(reply === "request" ? { id: 1, error: IMPORT } : { error: IMPORT, fatal: true });
    await assert.rejects(read, { message: ADVICE });
  });

// The host's own error event before its engine is ready (its script did not
// load, which fires an event without a message, or it threw an error it did
// not catch) is a failure to load OCR as well.
for (const [shape, event] of [["without a message", {}], ["with a message", { message: `Uncaught NetworkError: ${IMPORT}` }]])
  test(`a host's error event ${shape} before its engine is ready names the offered update`, async (t) => {
    const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
    h.workers[0].onerror(event);
    await assert.rejects(read, { message: ADVICE });
  });

// Whether OCR loaded is known per host: a host that replaces a ready one and
// cannot load OCR names the offered update too.
test("a replacement host that cannot load OCR names the offered update although an earlier host was ready", async (t) => {
  const h = runtime(t, "Update app & reload"), first = h.api.recognize({ png: "a" });
  h.message({ type: "ready" });
  h.message({ error: "engine crashed", fatal: true });
  await assert.rejects(first, { message: "engine crashed" }, "a ready host's failure is not a failure to load");
  const second = h.api.recognize({ png: "b" });
  assert.equal(h.workers.length, 2, "a new host");
  h.message({ error: IMPORT, fatal: true });
  await assert.rejects(second, { message: ADVICE });
});

// A deploy's missing files fail at once; a deadline that expires is a slow
// download, which the update does not bring any faster.
test("an OCR deadline that expires keeps its own message while an update is offered", async (t) => {
  const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
  [...h.timers.values()].find((timer) => timer.ms === 90000).fn();
  await assert.rejects(read, { message: "Printed-clue recognition timed out. Retry a clearer picture." });
  const warming = runtime(t, "Update app & reload");
  warming.api.prepare();
  const later = warming.api.recognize({ png: "a" });
  [...warming.timers.values()].find((timer) => timer.ms === 90000).fn();
  await assert.rejects(later, { message: "OCR loading timed out. Go online and retry." });
});

test("without an offered update a failure to load OCR keeps its own message", async (t) => {
  const h = runtime(t, ""), read = h.api.recognize({ png: "a" });
  h.message({ error: IMPORT, fatal: true });
  await assert.rejects(read, { message: IMPORT });
});

// Offline the network is the cause, and the update would not load OCR.
test("offline, a failure to load OCR keeps its own message while an update is offered", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
  h.message({ error: IMPORT, fatal: true });
  await assert.rejects(read, { message: IMPORT });
});

test("a failure after the engine is ready is a failure to read, not to load", async (t) => {
  const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
  h.message({ type: "ready" });
  h.message({ id: 1, error: "OCR is still finishing an earlier request." });
  await assert.rejects(read, { message: "OCR is still finishing an earlier request." });
});

test("a cancelled scan stays a cancellation while an update is offered", async (t) => {
  const h = runtime(t, "Update app & reload"), read = h.api.recognize({ png: "a" });
  h.api.cancel();
  await assert.rejects(read, { name: "AbortError" });
});
