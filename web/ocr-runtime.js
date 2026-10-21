// One reusable OCR engine per Scanner. Cancellation is cooperative between
// recognition calls, with a hard deadline for a stuck engine. No images persist.
import { visibleTimers } from "./visible-time.js";
import { updateAdvice as offeredUpdate } from "./offline.js";
const aborted = () => new DOMException("Scan cancelled", "AbortError");
export function createOCRRuntime({
  makeWorker = () => new Worker(new URL("./ocr-host-worker.js", import.meta.url), { type: "classic" }),
  setTimer = setTimeout, clearTimer = clearTimeout,
  // The job, loading and cancel deadlines count only the time the page is
  // visible: an app switch must not run them out (visible-time.js).
  deadlines = visibleTimers({ setTimer, clearTimer }),
  // Advice for OCR that cannot load on a page an offered update replaces.
  updateAdvice = offeredUpdate,
} = {}) {
  let worker = null, loaded = false, active = null, queued = null, serial = 0;
  let deadline = null, warmDeadline = null;
  // An error before the host's engine is ready is a failure to load OCR.
  // Online, while an app update is offered, that is most likely this build's
  // OCR files gone from the server after a deploy (web/README.md, "Offline
  // behaviour"), which only the update fixes. Offline it is the network's,
  // and a deadline that expires is a slow download: those keep their own
  // messages.
  const failure = (message) => {
    const advice = loaded || globalThis.navigator?.onLine === false ? "" : updateAdvice("try again");
    return Error(advice ? `Recognition could not load. ${advice}` : message);
  };
  const clear = () => { deadlines.clearTimer(deadline); deadline = null; };
  function destroy(error = aborted()) {
    clear(); deadlines.clearTimer(warmDeadline); warmDeadline = null;
    const old = worker; worker = null;
    active?.reject(error); queued?.reject(error); active = queued = null;
    if (!old) return;
    // The classic host owns Tesseract's child worker, including initialization.
    const timer = setTimer(() => old.terminate(), 100);
    old.onerror = null;
    old.onmessage = ({ data }) => {
      if (data?.cancelled !== true) return;
      clearTimer(timer); old.terminate();
    };
    try { old.postMessage({ cancel: true }); }
    catch { clearTimer(timer); old.terminate(); }
  }
  function dispatch() {
    if (active || !queued) return;
    try {
      ensure();
      active = queued; queued = null;
      const job = active;
      deadline = deadlines.setTimer(() => {
        if (active === job) destroy(Error("Printed-clue recognition timed out. Retry a clearer picture."));
      }, 90000);
      worker.postMessage({ ...job.payload, id: job.id, keepAlive: true });
    } catch (error) { destroy(error); }
  }
  function ensure() {
    if (worker) return;
    const owned = makeWorker(); worker = owned; loaded = false;
    owned.onerror = (error) => {
      if (worker === owned) destroy(failure(error.message || "Printed-clue recognition failed."));
    };
    owned.onmessageerror = () => {
      if (worker === owned) destroy(Error("Could not receive printed-clue recognition."));
    };
    owned.onmessage = ({ data }) => {
      if (worker !== owned) return;
      if (data?.fatal) { destroy(failure(data.error || "Printed-clue recognition failed.")); return; }
      if (data?.type === "ready") {
        loaded = true;
        deadlines.clearTimer(warmDeadline); warmDeadline = null;
        return;
      }
      const job = active;
      if (!job || data?.id !== job.id) return;
      if (data.type === "progress" || data.type === "atlas") {
        if (!job.cancelled) {
          try {
            if (data.type === "atlas") job.onPreview(data.result);
            else job.onProgress(data.message, data.progress);
          } catch (error) { cancel(); job.reject(error); }
        }
        return;
      }
      if (!data.result && !data.error && data.cancelled !== true) return;
      clear(); active = null;
      if (!job.cancelled) {
        if (data.error) job.reject(failure(data.error));
        else if (data.cancelled) job.reject(aborted());
        else job.resolve(data.result);
      }
      dispatch();
    };
    // Every host loads its engine before its first request: its "ready"
    // tells a failure to load OCR from a failure to read.
    owned.postMessage({ type: "warm" });
  }
  function prepare() {
    if (worker) return;
    try {
      ensure();
      const owned = worker;
      warmDeadline = deadlines.setTimer(() => {
        if (worker === owned) destroy(Error("OCR loading timed out. Go online and retry."));
      }, 90000);
    } catch (error) { destroy(error); }
  }
  function cancel() {
    queued?.reject(aborted()); queued = null;
    if (!active || active.cancelled) return;
    const job = active; job.cancelled = true; job.reject(aborted());
    clear();
    // A single sample normally completes quickly. Bound a stalled atomic call
    // while allowing a healthy interpreter to stay warm for the next frame.
    deadline = deadlines.setTimer(() => {
      if (active !== job) return;
      const next = queued; queued = null;
      destroy(); queued = next; dispatch();
    }, 2000);
    try { worker.postMessage({ cancel: job.id }); }
    catch (error) { destroy(error); }
  }
  return {
    prepare, cancel, dispose: destroy,
    recognize(payload, onProgress = () => {}, onPreview = () => {}) {
      cancel();
      return new Promise((resolve, reject) => {
        queued = { id: ++serial, payload, onProgress, onPreview, resolve, reject, cancelled: false };
        dispatch();
      });
    },
  };
}
