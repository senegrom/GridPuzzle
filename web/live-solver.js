// A preview has a fixed search budget and must never stop or block the camera.
export function createLiveSolver({ makeWorker = () => new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" }),
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let worker = null, serial = 0, finish = null, timer = null;
  const clear = () => { clearTimer(timer); timer = null; };
  function cancel() {
    serial++; clear(); const done = finish; finish = null;
    worker?.terminate(); worker = null; done?.(null);
  }
  // A warm-up is a real request too: bound it, handle failure immediately,
  // and ignore late notifications from an interpreter already retired. The
  // worker shares one load between requests, so warming an interpreter that
  // is already loaded or loading only asks it to report when it is ready.
  function warm(owned) {
    worker = owned;
    owned.onmessage = ({ data }) => {
      if (owned !== worker) return;
      if (data.type === "ready") clear();
      else if (data.type === "warm-error") cancel();
    };
    owned.onerror = () => { if (owned === worker) cancel(); };
    timer = setTimer(() => { if (owned === worker) cancel(); }, 90000);
    owned.postMessage({ type: "warm" });
  }
  // Load the Python runtime before the first preview needs it, and again in
  // the background after a search budget had to terminate the interpreter.
  // The camera keeps streaming meanwhile, and the next stable frame finds a
  // warm worker instead of paying the whole runtime download and start-up.
  function prepare() {
    if (worker) return;
    try { warm(makeWorker()); } catch { cancel(); }
  }
  // Take over an interpreter the page already started instead of loading a
  // second one. A solver that already has one does not need another.
  function adopt(owned) {
    if (!owned) return;
    if (worker) { owned.terminate(); return; }
    try { warm(owned); } catch { cancel(); }
  }
  // Hand an idle or warming interpreter to its next owner. A running search
  // can only be stopped by terminating it, so that one is not handed on.
  function release() {
    if (finish || !worker) { cancel(); return null; }
    const owned = worker;
    serial++; clear(); worker = null;
    owned.onmessage = owned.onerror = null;
    return owned;
  }
  // Cancelling a running Python search needs termination; discarding a camera
  // alignment does not. Keep an idle or warming worker for the next reading.
  function invalidate() { if (finish) cancel(); }
  const expire = () => { cancel(); prepare(); };
  return {
    cancel, invalidate, prepare, adopt, release,
    solve(puzzle) {
      if (finish) cancel();
      clear(); // The solve now owns a fresh deadline, replacing warm-up's timer.
      return new Promise((resolve) => {
        const id = ++serial;
        finish = resolve;
        const settle = (result) => { if (id !== serial) return; clear(); finish = null; resolve(result); };
        try {
          worker ??= makeWorker();
          const owned = worker;
          owned.onmessage = ({ data }) => {
            if (owned !== worker || id !== serial || data.id !== id) return;
            if (data.type === "status" && data.message?.startsWith("Solving")) {
              clear(); timer = setTimer(expire, 8000);
            }
            if (data.type === "result") settle(data.result);
          };
          owned.onerror = () => {
            if (owned === worker && id === serial) cancel();
          };
          timer = setTimer(cancel, 90000);
          owned.postMessage({ id, puzzle });
        } catch { cancel(); }
      });
    },
  };
}
