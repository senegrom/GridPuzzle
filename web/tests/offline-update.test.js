import test from "node:test";
import assert from "node:assert/strict";
import { setupOffline } from "../offline.js";

function environment(t, { controlled = true, waiting = true } = {}) {
  const originals = ["navigator", "location", "MessageChannel"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const requests = [];
  const worker = () => ({ postMessage(message, ports) {
    if (ports) ports[0].respond({ done: true, ready: false });
    else requests.push(message.type);
  } });
  const oldWorker = worker(), newWorker = worker();
  const registration = Object.assign(new EventTarget(), {
    active: oldWorker, waiting: waiting ? newWorker : null,
    installing: new EventTarget(),
  });
  globalThis.MessageChannel = class {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = { respond: (data) => queueMicrotask(() => this.port1.onmessage({ data })) };
    }
  };
  return {
    registration, newWorker, requests,
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
  env.registration.waiting = env.newWorker;
  env.registration.dispatchEvent(new Event("updatefound"));
  env.registration.installing.dispatchEvent(new Event("statechange"));
  assert.equal(tab.button.hidden, false);
  assert.equal(tab.button.textContent, "Update app & reload");
  env.registration.waiting = null;
  tab.activate();
  assert.equal(tab.button.textContent, "Reload updated app");
  assert.equal(tab.reloads, 0);
});

test("the top-of-page banner mirrors the update control", async (t) => {
  const env = environment(t, { controlled: false, waiting: false }), tab = await env.tab();
  const $ = (id) => tab.node(id);
  assert.equal($("update-banner").hidden, true);
  env.registration.waiting = env.newWorker;
  env.registration.dispatchEvent(new Event("updatefound"));
  env.registration.installing.dispatchEvent(new Event("statechange"));
  assert.equal($("update-banner").hidden, false);
  assert.equal($("update-banner-button").textContent, "Update app & reload");
  $("update-banner-button").onclick();
  assert.deepEqual(env.requests, ["ACTIVATE"]);
  assert.equal($("update-banner-button").disabled, true);
});
