/* Only this app's scoped, versioned cache is ever read or removed. */
const VERSION = "__BUILD_ID__";
const PREFIX = `gridpuzzle:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const url = (path) => new URL(path, self.registration.scope).href;

function validateManifest(data) {
  if (data.build !== VERSION || !Array.isArray(data.assets))
    throw Error("Update the app before downloading offline assets.");
  for (const asset of data.assets) {
    if (
      typeof asset.path !== "string" ||
      !url(asset.path).startsWith(self.registration.scope) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw Error("Invalid offline asset manifest.");
  }
  return data.assets;
}
async function manifest(cache) {
  const response = await cache.match(url("assets.json"));
  if (!response)
    throw Error("The offline asset list is missing. Reload online.");
  return validateManifest(await response.json());
}
async function matchesAsset(response, asset) {
  if (!response?.ok) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await response.clone().arrayBuffer(),
  );
  return (
    [...new Uint8Array(digest)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("") === asset.sha256
  );
}
async function verifiedAsset(
  cache,
  asset,
  { network = true, requireStorage = true } = {},
) {
  const key = url(asset.path);
  let response = await cache.match(key);
  if (response && (await matchesAsset(response, asset))) return response;
  // A failed verification must not poison every subsequent retry.
  if (response) await cache.delete(key);
  if (!network) return null;
  response = await fetch(new Request(key, { cache: "reload" }));
  if (!response.ok)
    throw Error(`Could not download ${asset.path}. Stay online and retry.`);
  if (!(await matchesAsset(response, asset)))
    throw Error(
      `Asset changed during download: ${asset.path}. Update the app and retry.`,
    );
  try {
    await cache.put(key, response.clone());
  } catch (error) {
    if (requireStorage) throw error;
  } // Quota does not break online use.
  return response;
}
async function offlineReady(cache, assets) {
  // Sequential verification bounds memory even for large WASM assets. A
  // presence-only marker would lie after a partial eviction or bad response.
  for (const asset of assets)
    if (!(await verifiedAsset(cache, asset, { network: false }))) return false;
  return true;
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const response = await fetch(
        new Request(url("assets.json"), { cache: "reload" }),
      );
      if (!response.ok) throw Error("Could not load the offline manifest.");
      const assets = validateManifest(await response.clone().json());
      const cache = await caches.open(CACHE);
      await cache.put(url("assets.json"), response);
      // Every first-party module is included automatically; splitting UI modules
      // cannot accidentally drop one from the offline shell.
      const shell = assets.filter(
        (a) =>
          a.path.startsWith("icons/") ||
          (!a.path.includes("/") && !a.path.endsWith(".zip")),
      );
      for (const asset of shell) await verifiedAsset(cache, asset);
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request,
    target = new URL(request.url);
  if (
    request.method !== "GET" ||
    !request.url.startsWith(self.registration.scope) ||
    target.origin !== self.location.origin ||
    request.headers.has("range")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.url === url("assets.json")) {
        await manifest(cache);
        return cache.match(url("assets.json"));
      }
      const assets = await manifest(cache);
      const key =
        target.href === self.registration.scope
          ? url("index.html")
          : target.href;
      const asset = assets.find((a) => url(a.path) === key);
      if (!asset) return fetch(request); // Never cache unmanifested responses.
      return verifiedAsset(cache, asset, { requireStorage: false });
    })(),
  );
});
let downloading = false;
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE") {
    self.skipWaiting();
    return;
  }
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE),
          assets = await manifest(cache);
        if (event.data?.type === "OFFLINE_STATUS") {
          port.postMessage({
            done: true,
            ready: await offlineReady(cache, assets),
          });
          return;
        }
        if (event.data?.type !== "PREPARE_OFFLINE")
          throw Error("Unknown offline task");
        if (downloading)
          throw Error("Offline preparation is already running in another tab.");
        downloading = true;
        try {
          for (let i = 0; i < assets.length; i++) {
            await verifiedAsset(cache, assets[i]);
            port.postMessage({ progress: i + 1, total: assets.length });
          }
          port.postMessage({ done: true, ready: true });
        } finally {
          downloading = false;
        }
      } catch (error) {
        port.postMessage({ error: error.message });
      }
    })(),
  );
});
