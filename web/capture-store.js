import { downloadBlob } from "./download.js";

// One explicitly captured picture, local to this browser. Never autosave live
// frames, never upload them, and never evict an older shot on a failed write.
const DB = "gridpuzzle-captures-v1", STORE = "pictures", MAX_PNG_BYTES = 20 * 1024 * 1024;
export function captureTransaction(mode, operation, { indexedDB = globalThis.indexedDB, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(Error("Local picture storage is unavailable. Download the PNG instead.")); return; }
    let db, transaction, value, ended = false;
    const finish = (error) => {
      if (ended) return; ended = true; clearTimeout(timer);
      if (error) { try { transaction?.abort(); } catch {} }
      db?.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { finish(Error("Local picture storage timed out. Download the PNG instead.")); }, timeout);
    try {
      // Version 2 preserves existing pictures but fences out version-1 tabs
      // whose old writers do not implement durable operation ownership.
      const open = indexedDB.open(DB, 2);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
      open.onerror = () => finish(open.error || Error("Could not open picture storage."));
      open.onblocked = () => finish(Error("Picture storage is busy in another tab. Download the PNG instead."));
      open.onsuccess = () => {
        db = open.result;
        if (ended) { db.close(); return; }
        if (!db.objectStoreNames.contains(STORE)) {
          // An interrupted first upgrade can leave the current database
          // without the store, and onupgradeneeded never runs again for it.
          // Reset it so the next attempt starts cleanly.
          db.close(); db = null;
          try { indexedDB.deleteDatabase(DB); } catch { /* best effort */ }
          finish(Error("Picture storage was reset. Retry saving."));
          return;
        }
        db.onversionchange = () => db.close();
        try {
          transaction = db.transaction(STORE, mode);
          transaction.oncomplete = () => finish();
          transaction.onerror = transaction.onabort = () => finish(transaction.error || Error("Could not save the picture. Storage may be full."));
          const request = operation(transaction.objectStore(STORE));
          // A read-modify-write operation may queue more requests from this
          // handler. Keep its check and write in the SAME active transaction.
          const onSuccess = request.onsuccess;
          request.onsuccess = (event) => {
            if (ended) return;
            try { value = request.result; onSuccess?.call(request, event); }
            catch (error) { finish(error); }
          };
          request.onerror = () => finish(request.error || Error("Could not write picture storage."));
        } catch (error) { finish(error); }
      };
    } catch (error) { finish(error); }
  });
}
// Claim an intent before encoding/opening can reorder operations. Web Locks
// orders the short reservations across tabs; IndexedDB keeps the winning token
// durable. Never hold a lock while converting a PNG. The final token check and
// picture write share a transaction, so deletion cannot race between them.
const mutationOwners = new WeakMap(), unavailableStorage = {};
const superseded = () => new DOMException("Picture operation was superseded.", "AbortError");
function beginMutation(options, deleting = false) {
  const storage = options && Object.hasOwn(options, "indexedDB") ? options.indexedDB : globalThis.indexedDB;
  const key = storage ?? unavailableStorage, owner = {};
  mutationOwners.set(key, owner);
  const check = () => { if (mutationOwners.get(key) !== owner) throw superseded(); };
  const ready = (async () => {
    const locks = options && Object.hasOwn(options, "locks") ? options.locks : globalThis.navigator?.locks;
    if (!locks?.request) throw Error("Safe picture storage is unavailable. Download the PNG instead.");
    const controller = new AbortController();
    // Bound waiting for another tab as well as the individual database opens.
    const timer = setTimeout(() => controller.abort(Error("Picture storage coordination timed out. Download the PNG instead.")), options?.lockTimeout ?? 16000);
    try {
      return await locks.request(`${DB}:mutations`, { signal: controller.signal }, async () => {
        check();
        const token = crypto.randomUUID();
        await captureTransaction("readwrite", (store) => {
          check();
          const request = store.put(token, "owner");
          if (deleting) store.delete("latest");
          return request;
        }, options);
        return token;
      });
    } finally { clearTimeout(timer); }
  })().then((token) => ({ token }), (error) => ({ error }));
  // Encoding may finish long after this reservation. Observe failures now so a
  // rejected reservation cannot become an unhandled rejection in the meantime.
  return { ready, check };
}
function validateCapture(blob, createdAt) {
  if (!(blob instanceof Blob) || blob.type !== "image/png" || !blob.size || blob.size > MAX_PNG_BYTES)
    throw Error("The captured PNG is empty or too large to store.");
  if (!Number.isFinite(createdAt) || !Number.isFinite(new Date(createdAt).getTime()))
    throw Error("The captured picture has an invalid timestamp.");
}
async function finishSave(blob, createdAt, options, mutation) {
  validateCapture(blob, createdAt);
  const { token, error } = await mutation.ready;
  mutation.check();
  if (error) throw error;
  // Some WebKit backends cannot clone Blobs. Convert outside any transaction.
  const bytes = await blob.arrayBuffer();
  mutation.check();
  await captureTransaction("readwrite", (store) => {
    mutation.check();
    const request = store.get("owner");
    request.onsuccess = () => {
      mutation.check();
      if (request.result !== token) throw superseded();
      store.put({ bytes, type: "image/png", createdAt }, "latest");
    };
    return request;
  }, options);
}
export async function saveCapture(blob, createdAt = Date.now(), options) {
  validateCapture(blob, createdAt);
  return finishSave(blob, createdAt, options, beginMutation(options));
}
export async function loadCapture(options) {
  const record = await captureTransaction("readonly", (store) => store.get("latest"), options);
  if (!record || !Number.isFinite(record.createdAt)) return null;
  if (record.type !== "image/png" || !(record.bytes instanceof ArrayBuffer) || !record.bytes.byteLength || record.bytes.byteLength > MAX_PNG_BYTES)
    return null;
  return { blob: new Blob([record.bytes], { type: "image/png" }), createdAt: record.createdAt };
}
export async function deleteCapture(options) {
  const mutation = beginMutation(options, true);
  const { error } = await mutation.ready;
  mutation.check();
  if (error) throw error;
}

export function setupCaptureGallery($, { load = loadCapture, save = saveCapture, remove = deleteCapture } = {}) {
  let revision = 0, objectURL = null, latest = null;
  function show(record) {
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null; latest = record;
    $("saved-capture").hidden = !record;
    if (!record) { $("saved-capture-image").removeAttribute("src"); return; }
    objectURL = URL.createObjectURL(record.blob);
    $("saved-capture-image").src = objectURL;
    $("saved-capture-time").textContent = new Date(record.createdAt).toLocaleString();
  }
  function download() {
    if (!latest) return;
    // Reuse the gallery's URL for the same blob, which lives as long as the
    // preview; without one, the shared helper keeps its own URL for a minute.
    downloadBlob(latest.blob, `gridpuzzle-scan-${new Date(latest.createdAt).toISOString().replace(/[:.]/g, "-")}.png`, objectURL);
  }
  $("download-capture").onclick = $("download-live-capture").onclick = download;
  $("delete-capture").onclick = async () => {
    const id = ++revision; $("delete-capture").disabled = true;
    try { await remove(); if (id === revision) { show(null); $("capture-storage-status").textContent = "Saved picture deleted from this browser."; } }
    catch (error) { if (id === revision) $("capture-storage-status").textContent = error.message || error.name || "Could not delete the saved picture."; }
    finally { $("delete-capture").disabled = false; }
  };
  const id = revision;
  void load().then((record) => {
    if (id === revision && record?.blob instanceof Blob && record.blob.type === "image/png") show(record);
  }).catch(() => { /* A browser without storage can still scan and download. */ });
  return async (canvas, createdAt) => {
    const id = ++revision;
    // The shutter owns its operation BEFORE canvas.toBlob, not just before the
    // later Blob conversion. A delete in another tab must supersede both.
    const mutation = save === saveCapture ? beginMutation() : null;
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(Error("Could not encode the captured picture.")), "image/png"));
    if (id !== revision) throw Error("Capture was superseded.");
    show({ blob, createdAt });
    $("capture-storage-status").textContent = "Saving on this device…";
    try {
      if (mutation) await finishSave(blob, createdAt, undefined, mutation);
      else await save(blob, createdAt);
      if (id === revision) $("capture-storage-status").textContent = "Picture saved in this browser. Download PNG to keep a separate copy.";
      return id === revision;
    } catch (error) {
      if (id === revision) $("capture-storage-status").textContent = `${error.message || error.name || "Could not save the picture."} This picture is still available to download.`;
      return false;
    }
  };
}
