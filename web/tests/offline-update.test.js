import test from "node:test";
import assert from "node:assert/strict";
import { setupOffline, updateAdvice } from "../offline.js";
import { createOCRRuntime } from "../ocr-runtime.js";

// `reply` is what the worker answers each offline request with; with `hold`,
// a download (PREPARE_OFFLINE) is answered only when the test releases it.
function environment(t, { controlled = true, waiting = true, reply = { done: true, ready: false }, hold = false } = {}) {
  const originals = ["navigator", "location", "MessageChannel"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const requests = [], held = [];
  const worker = (state) => Object.assign(new EventTarget(), { state, postMessage(message, ports) {
    if (!ports) requests.push(message.type);
    else if (hold && message.type === "PREPARE_OFFLINE") held.push(ports[0]);
    else ports[0].respond(reply);
  } });
  const oldWorker = worker("activated"), newWorker = worker(waiting ? "installed" : "installing");
  // As a page finds it at load: nothing installing; the new worker waits,
  // or no update has been found yet.
  const registration = Object.assign(new EventTarget(), {
    active: oldWorker, waiting: waiting ? newWorker : null, installing: null,
  });
  globalThis.MessageChannel = class {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = { respond: (data) => queueMicrotask(() => this.port1.onmessage({ data })) };
    }
  };
  return {
    registration, newWorker, requests,
    // A deploy found while the tab is open: the browser gives the new worker
    // to registration.installing and fires updatefound (found), and the
    // worker, once installed, waits (installed).
    update() { this.found(); this.installed(); },
    found() {
      registration.installing = newWorker;
      registration.dispatchEvent(new Event("updatefound"));
    },
    installed() {
      registration.installing = null;
      registration.waiting = newWorker;
      newWorker.state = "installed";
      newWorker.dispatchEvent(new Event("statechange"));
    },
    // Answers the held downloads with `message`.
    release(message) { for (const port of held.splice(0)) port.respond(message); },
    async tab() {
      const nodes = new Map();
      const $ = (id) => {
        if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
        return nodes.get(id);
      };
      let reloads = 0;
      const serviceWorker = Object.assign(new EventTarget(), {
        controller: controlled ? oldWorker : null,
        register: async () => registration,
        ready: Promise.resolve(registration),
      });
      const enter = () => {
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker } });
        globalThis.location = { reload: () => { reloads++; } };
      };
      enter();
      setupOffline($);
      await new Promise((resolve) => setImmediate(resolve));
      return {
        button: $("update-app"),
        node: $,
        get reloads() { return reloads; },
        click() { enter(); $("update-app").onclick(); },
        prepare() { enter(); return $("prepare-offline").onclick(); },
        activate(next = newWorker) {
          enter();
          serviceWorker.controller = next;
          serviceWorker.dispatchEvent(new Event("controllerchange"));
        },
      };
    },
  };
}

test("updating one tab leaves other tabs a working explicit reload", async (t) => {
  const env = environment(t), first = await env.tab(), second = await env.tab();
  assert.equal(first.button.hidden, false);
  assert.equal(second.button.hidden, false);
  first.click();
  assert.deepEqual(env.requests, ["ACTIVATE"]);
  env.registration.waiting = null;
  env.registration.active = env.newWorker;
  first.activate();
  second.activate();
  assert.equal(first.reloads, 1);
  assert.equal(second.reloads, 0, "other tabs keep their unfinished work");
  assert.equal(second.button.hidden, false);
  assert.equal(second.button.disabled, false);
  assert.equal(second.button.textContent, "Reload updated app");
  assert.doesNotThrow(() => second.click());
  assert.equal(second.reloads, 1);
  assert.deepEqual(env.requests, ["ACTIVATE"]);
});

test("the update click handles a worker activated before controllerchange arrives", async (t) => {
  const env = environment(t), tab = await env.tab();
  env.registration.waiting = null;
  env.registration.active = env.newWorker;
  assert.doesNotThrow(() => tab.click());
  assert.equal(tab.reloads, 1);
  assert.deepEqual(env.requests, []);
});

test("initial service-worker control does not request an unnecessary reload", async (t) => {
  const env = environment(t, { controlled: false, waiting: false }), tab = await env.tab();
  tab.activate(env.registration.active);
  assert.equal(tab.button.hidden, true);
  assert.equal(tab.reloads, 0);
  env.update();
  assert.equal(tab.button.hidden, false);
  assert.equal(tab.button.textContent, "Update app & reload");
  env.registration.waiting = null;
  tab.activate();
  assert.equal(tab.button.textContent, "Reload updated app");
  assert.equal(tab.reloads, 0);
});

// The page finds no installing worker at load; only updatefound hands it
// the worker a later deploy installs (offline.js, watchInstall).
test("an update found while the tab is open is offered without a reload", async (t) => {
  const env = environment(t, { waiting: false }), tab = await env.tab();
  assert.equal(tab.node("update-banner").hidden, true);
  env.update();
  assert.equal(tab.node("update-banner").hidden, false);
  assert.equal(tab.button.hidden, false);
  assert.equal(tab.node("update-banner-button").textContent, "Update app & reload");
  assert.equal(tab.reloads, 0);
});

test("the top-of-page banner mirrors the update control", async (t) => {
  const env = environment(t, { controlled: false, waiting: false }), tab = await env.tab();
  const $ = (id) => tab.node(id);
  assert.equal($("update-banner").hidden, true);
  env.update();
  assert.equal($("update-banner").hidden, false);
  assert.equal($("update-banner-button").textContent, "Update app & reload");
  $("update-banner-button").onclick();
  assert.deepEqual(env.requests, ["ACTIVATE"]);
  assert.equal($("update-banner-button").disabled, true);
});

// After a deploy the server has only the new build's files, so a failure to
// get this build's files is fixed by the offered update, not by a retry.
test("the advice for a failure only an update fixes names the update the page offers", async (t) => {
  const env = environment(t, { waiting: false }), tab = await env.tab();
  assert.equal(updateAdvice("try again"), "", "no update offered");
  env.update();
  assert.equal(updateAdvice("try again"), "An updated version of the app is ready. Use “Update app & reload”, then try again.");
  env.registration.waiting = null;
  tab.activate();
  assert.equal(updateAdvice("try again"), "An updated version of the app is ready. Use “Reload updated app”, then try again.");
});

const GONE = { error: "Could not download vendor/aaaaaaaaaaaa/tesseract/tesseract.min.js. Stay online and retry.", gone: true };
test("an offline download whose files are gone from the server asks for the waiting update", async (t) => {
  const env = environment(t, { reply: GONE }), tab = await env.tab();
  await tab.prepare();
  assert.equal(tab.node("offline-state").textContent,
    "Some of this version’s files are no longer on the server. An updated version of the app is ready. Use “Update app & reload”, then download for offline use again.");
  assert.equal(tab.node("prepare-offline").disabled, false);
});

for (const [name, options] of [
  ["without an update", { waiting: false, reply: GONE }],
  ["while an update waits, for a file that is not gone", { reply: { error: "Offline download stalled. Stay online and retry." } }],
])
  test(`an offline download failure ${name} keeps the worker's message`, async (t) => {
    const env = environment(t, options), tab = await env.tab();
    await tab.prepare();
    assert.equal(tab.node("offline-state").textContent, options.reply.error);
  });

test("OCR that cannot load on this page names the update the page offers", async (t) => {
  const env = environment(t), workers = [];
  await env.tab();
  const ocr = createOCRRuntime({ makeWorker() {
    const worker = { postMessage() {}, terminate() {} };
    workers.push(worker);
    return worker;
  }, setTimer: () => 0, clearTimer() {} });
  const read = ocr.recognize({ png: "a" });
  workers[0].onmessage({ data: { error: "The script at 'vendor/aaaaaaaaaaaa/tesseract/tesseract.min.js' failed to load.", fatal: true } });
  await assert.rejects(read, {
    message: "Recognition could not load. An updated version of the app is ready. Use “Update app & reload”, then try again.",
  });
});

// The service worker asks the browser for a deploy's worker at the first
// file it misses (sw.js, requestUpdate()), so the update is often found while
// a download or a read runs. Neither is stopped; what each then says depends
// on whether the update is offered (installed) when it ends.
test("an update found while an offline download runs leaves the download to finish", async (t) => {
  const env = environment(t, { waiting: false, hold: true }), tab = await env.tab();
  const download = tab.prepare();
  env.update();
  assert.equal(tab.node("update-banner").hidden, false);
  assert.equal(tab.node("prepare-offline").disabled, true, "the download still runs");
  env.release({ done: true, ready: true });
  await download;
  assert.match(tab.node("offline-state").textContent, /^Offline assets are ready on this device/);
  assert.equal(tab.node("prepare-offline").disabled, false);
});

test("a download whose files are gone names the update found while it ran once it is installed", async (t) => {
  const env = environment(t, { waiting: false, hold: true }), tab = await env.tab();
  let download = tab.prepare();
  env.found();
  env.release(GONE);
  await download;
  assert.equal(tab.node("offline-state").textContent, GONE.error, "still installing: nothing to name yet");
  assert.equal(tab.node("update-banner").hidden, true);
  env.installed();
  assert.equal(tab.node("update-banner").hidden, false);
  download = tab.prepare();
  env.release(GONE);
  await download;
  assert.equal(tab.node("offline-state").textContent,
    "Some of this version’s files are no longer on the server. An updated version of the app is ready. Use “Update app & reload”, then download for offline use again.");
});

test("a read during which an update is found reads as before, and names it only if OCR then fails to load", async (t) => {
  const env = environment(t, { waiting: false }), workers = [];
  await env.tab();
  const ocr = createOCRRuntime({ makeWorker() {
    const worker = { postMessage() {}, terminate() {} };
    workers.push(worker);
    return worker;
  }, setTimer: () => 0, clearTimer() {} });
  const read = ocr.recognize({ png: "a" });
  workers[0].onmessage({ data: { type: "ready" } });
  env.update();
  workers[0].onmessage({ data: { id: 1, result: { text: "5" } } });
  assert.deepEqual(await read, { text: "5" });
  ocr.dispose();
  const next = ocr.recognize({ png: "b" });
  workers[1].onmessage({ data: { error: "The script at 'vendor/aaaaaaaaaaaa/tesseract/tesseract.min.js' failed to load.", fatal: true } });
  await assert.rejects(next, {
    message: "Recognition could not load. An updated version of the app is ready. Use “Update app & reload”, then try again.",
  });
});
