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
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
      open.onerror = () => finish(open.error || Error("Could not open picture storage."));
      open.onblocked = () => finish(Error("Picture storage is busy in another tab. Download the PNG instead."));
      open.onsuccess = () => {
        db = open.result;
        if (ended) { db.close(); return; }
        db.onversionchange = () => db.close();
        try {
          transaction = db.transaction(STORE, mode);
          transaction.oncomplete = () => finish();
          transaction.onerror = transaction.onabort = () => finish(transaction.error || Error("Could not save the picture. Storage may be full."));
          const request = operation(transaction.objectStore(STORE));
          request.onsuccess = () => { value = request.result; };
          request.onerror = () => finish(request.error || Error("Could not write picture storage."));
        } catch (error) { finish(error); }
      };
    } catch (error) { finish(error); }
  });
}
export async function saveCapture(blob, createdAt = Date.now(), options) {
  if (!(blob instanceof Blob) || blob.type !== "image/png" || !blob.size || blob.size > MAX_PNG_BYTES)
    throw Error("The captured PNG is empty or too large to store.");
  if (!Number.isFinite(createdAt) || !Number.isFinite(new Date(createdAt).getTime()))
    throw Error("The captured picture has an invalid timestamp.");
  // Some WebKit storage backends abort Blob writes despite supporting other
  // structured-clone data. Persist the exact PNG bytes instead. Read them before
  // opening the transaction: awaiting inside an IDB transaction can close it.
  const bytes = await blob.arrayBuffer();
  await captureTransaction("readwrite", (store) => store.put({ bytes, type: "image/png", createdAt }, "latest"), options);
}
export async function loadCapture(options) {
  const record = await captureTransaction("readonly", (store) => store.get("latest"), options);
  if (!record || !Number.isFinite(record.createdAt)) return null;
  // Keep compatibility with captures written by the initial Blob-based format.
  if (record.blob instanceof Blob && record.blob.type === "image/png" && record.blob.size > 0 && record.blob.size <= MAX_PNG_BYTES)
    return { blob: record.blob, createdAt: record.createdAt };
  if (record.type !== "image/png" || !(record.bytes instanceof ArrayBuffer) || !record.bytes.byteLength || record.bytes.byteLength > MAX_PNG_BYTES)
    return null;
  return { blob: new Blob([record.bytes], { type: "image/png" }), createdAt: record.createdAt };
}
export const deleteCapture = () => captureTransaction("readwrite", (store) => store.delete("latest"));

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
    const link = document.createElement("a"), url = URL.createObjectURL(latest.blob);
    link.href = url; link.download = `gridpuzzle-scan-${new Date(latest.createdAt).toISOString().replace(/[:.]/g, "-")}.png`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  $("download-capture").onclick = $("download-live-capture").onclick = download;
  $("delete-capture").onclick = async () => {
    const id = ++revision; $("delete-capture").disabled = true;
    try { await remove(); if (id === revision) { show(null); $("capture-storage-status").textContent = "Saved picture deleted from this browser."; } }
    catch (error) { if (id === revision) $("capture-storage-status").textContent = error.message; }
    finally { $("delete-capture").disabled = false; }
  };
  const id = revision;
  void load().then((record) => {
    if (id === revision && record?.blob instanceof Blob && record.blob.type === "image/png") show(record);
  }).catch(() => { /* A browser without storage can still scan and download. */ });
  return async (canvas, createdAt) => {
    const id = ++revision;
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(Error("Could not encode the captured picture.")), "image/png"));
    if (id !== revision) throw Error("Capture was superseded.");
    show({ blob, createdAt });
    $("capture-storage-status").textContent = "Saving on this device…";
    try {
      await save(blob, createdAt);
      if (id === revision) $("capture-storage-status").textContent = "Picture saved in this browser. Download PNG to keep a separate copy.";
      return id === revision;
    } catch (error) {
      if (id === revision) $("capture-storage-status").textContent = `${error.message} This picture is still available to download.`;
      return false;
    }
  };
}
