// Run the production offline UI with explicitly delayed worker messages.
import test from "node:test";
import assert from "node:assert/strict";
import { setupOffline } from "../offline.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function harness(t, { persist = async () => false } = {}) {
  const nodes = new Map(), requests = [], channels = [], timers = new Map();
  let serial = 0, reloads = 0, persistentRequests = 0;
  for (const key of ["navigator", "location", "MessageChannel", "setTimeout", "clearTimeout"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, disabled: false, textContent: "" });
    return nodes.get(id);
  };
  const worker = () => Object.assign(new EventTarget(), {
    postMessage(message, ports) {
      requests.push({ ...message, port: ports?.[0], worker: this });
      if (this.failure) throw Error(this.failure);
    },
  });
  const first = worker(), second = worker();
  const registration = Object.assign(new EventTarget(), { active: first, waiting: second });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: first, register: async () => registration, ready: Promise.resolve(registration),
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    serviceWorker, storage: { persist: () => { persistentRequests++; return persist(); } },
  } });
  globalThis.location = { reload: () => { reloads++; } };
  globalThis.setTimeout = (callback) => { timers.set(++serial, callback); return serial; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.MessageChannel = class {
    constructor() {
      this.port1 = { closed: false, close() { this.closed = true; } };
      this.port2 = {
        closed: false, close() { this.closed = true; },
        reply: (data) => this.port1.onmessage?.({ data }),
        error: () => this.port1.onmessageerror?.(),
      };
      channels.push(this);
    }
  };
  setupOffline($); await tick();
  return {
    $, first, second, requests, channels, timers, registration,
    prepare: () => $("prepare-offline").onclick(),
    text: () => $("offline-state").textContent,
    persistentRequests: () => persistentRequests, reloads: () => reloads,
    activate() {
      registration.active = second; registration.waiting = null;
      serviceWorker.controller = second;
      serviceWorker.dispatchEvent(new Event("controllerchange"));
    },
  };
}

for (const stage of ["progress", "failure", "success"])
  test(`a delayed startup presence check cannot overwrite newer offline ${stage}`, async (t) => {
    const h = await harness(t), initial = h.requests[0], work = h.prepare(), request = h.requests.at(-1);
    if (stage === "progress") request.port.reply({ progress: 1, total: 3 });
    else {
      request.port.reply(stage === "failure" ? { error: "Digest verification failed" } : { done: true, ready: true });
      await work;
    }
    const latest = h.text();
    initial.port.reply({ done: true, ready: true }); await tick();
    assert.equal(h.text(), latest);
    if (stage === "progress") { request.port.reply({ done: true, ready: true }); await work; }
  });

test("offline preparation requires an explicit positive verification result", async (t) => {
  const h = await harness(t), work = h.prepare();
  h.requests.at(-1).port.reply({ done: true, ready: false }); await work;
  assert.doesNotMatch(h.text(), /assets are ready/);
  assert.equal(h.persistentRequests(), 0);
  assert.equal(h.$("prepare-offline").disabled, false);
});

test("postMessage failure closes both ports and clears every request timer", async (t) => {
  const h = await harness(t); h.first.failure = "Offline worker unavailable";
  await h.prepare();
  assert.match(h.text(), /Offline worker unavailable/);
  assert.equal(h.timers.size, 0);
  for (const channel of h.channels) assert.equal(channel.port1.closed, true);
  assert.equal(h.channels.at(-1).port2.closed, true);
  assert.equal(h.$("prepare-offline").disabled, false);
});

test("message deserialization errors immediately release offline controls", async (t) => {
  const h = await harness(t), work = h.prepare();
  h.requests.at(-1).port.error(); await tick();
  assert.equal(h.$("prepare-offline").disabled, false);
  assert.match(h.text(), /response|message/i);
  assert.equal(h.timers.size, 0);
  await work;
});

test("timed-out requests cannot paint queued progress or success over their failure", async (t) => {
  const h = await harness(t), work = h.prepare(), request = h.requests.at(-1);
  for (const timeout of [...h.timers.values()]) timeout();
  await work; const failure = h.text();
  request.port.reply({ progress: 2, total: 3 });
  request.port.reply({ done: true, ready: true }); await tick();
  assert.equal(h.text(), failure);
  assert.equal(h.$("prepare-offline").disabled, false);
  assert.equal(h.timers.size, 0);
});

test("duplicate messages after completion cannot change the verified status", async (t) => {
  const h = await harness(t), work = h.prepare(), request = h.requests.at(-1);
  request.port.reply({ done: true, ready: true }); await work;
  const success = h.text(); request.port.reply({ progress: 0, total: 3 });
  assert.equal(h.text(), success);
  assert.equal(h.timers.size, 0);
});

for (const stage of ["download", "persistence"])
  test(`another tab activating an update invalidates a pending ${stage} acknowledgement`, async (t) => {
    const persistent = deferred(), h = await harness(t, { persist: () => persistent.promise });
    const work = h.prepare(), request = h.requests.at(-1);
    if (stage === "persistence") { request.port.reply({ done: true, ready: true }); await tick(); }
    h.activate(); const warning = h.text();
    request.port.reply({ progress: 3, total: 3 }); request.port.reply({ done: true, ready: true });
    persistent.resolve(true); await tick();
    assert.equal(h.text(), warning);
    assert.match(h.text(), /reload|updated/i);
    assert.equal(h.$("prepare-offline").disabled, false);
    assert.equal(h.reloads(), 0, "an update must not reload another tab's unfinished puzzle");
    assert.equal(h.timers.size, 0);
    const count = h.requests.length; await h.prepare();
    assert.equal(h.requests.length, count, "the old document must reload before certifying a different build");
    await work;
  });

test("a superseded offline operation cannot re-enable the button during its replacement", async (t) => {
  const h = await harness(t), oldWork = h.prepare(), oldRequest = h.requests.at(-1);
  const newWork = h.prepare(), newRequest = h.requests.at(-1);
  oldRequest.port.reply({ error: "Old failure" }); await tick();
  assert.equal(h.$("prepare-offline").disabled, true);
  assert.doesNotMatch(h.text(), /Old failure/);
  newRequest.port.reply({ done: true, ready: true }); await newWork; await oldWork;
  assert.equal(h.$("prepare-offline").disabled, false);
  assert.equal(h.timers.size, 0);
});

test("a persistence rejection does not invalidate completed hash verification", async (t) => {
  const h = await harness(t, { persist: async () => { throw Error("Not granted"); } });
  const work = h.prepare(); h.requests.at(-1).port.reply({ done: true, ready: true }); await work;
  assert.match(h.text(), /assets are ready/); assert.doesNotMatch(h.text(), /granted persistent/);
});

test("an activation post failure leaves both update buttons usable", async (t) => {
  const h = await harness(t); h.second.failure = "Activation unavailable";
  assert.doesNotThrow(() => h.$("update-app").onclick());
  assert.equal(h.$("update-app").disabled, false);
  assert.equal(h.$("update-banner-button").disabled, false);
  assert.match(h.text(), /Activation unavailable/);
  h.activate(); assert.equal(h.reloads(), 0, "a failed update click cannot authorize a later reload");
});
