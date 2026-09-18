// A service worker's world without a browser: CacheStorage in memory and the
// install, activate and fetch events driven by hand. The browser gate runs the
// real worker; these fixtures test its routing and retention logic.
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

export const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
export const scope = "https://example.test/GridPuzzle/";

// One cache. A URL string and a Request for it key the same entry, and
// responses are cloned on the way in and out, as the real store does.
export function memoryCache() {
  const entries = new Map(), key = (request) => typeof request === "string" ? request : request.url;
  return {
    entries,
    async match(request) { return entries.get(key(request))?.clone(); },
    async put(request, response) { entries.set(key(request), response.clone()); },
    async delete(request) { return entries.delete(key(request)); },
    async keys() { return [...entries.keys()].map((url) => new Request(url)); },
  };
}

export function memoryCaches() {
  const stores = new Map();
  return {
    stores,
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, memoryCache());
        return stores.get(name);
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
  };
}

/* Loads sw.js as `build` over `caches` and `fetch`, with `clients()` as the
   windows and workers it controls, runs install and activate (calling
   `beforeActivation(read)` between them) and returns read(path, clientId,
   navigation): the response the fetch event gives. */
export async function activateWorker({ build, caches, fetch, clients = () => [], beforeActivation }) {
  const listeners = {};
  vm.runInNewContext(source.replace("__BUILD_ID__", build), {
    URL, Request, Response, Uint8Array, crypto: webcrypto, caches, fetch,
    self: {
      registration: { scope }, location: { origin: new URL(scope).origin },
      clients: { claim: async () => {}, matchAll: async () => clients() },
      skipWaiting() {}, addEventListener(type, listener) { listeners[type] = listener; },
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
    let done;
    listeners[type]({ waitUntil(promise) { done = promise; } });
    await done;
  }
  return read;
}
