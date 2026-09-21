// A preview has a fixed search budget and must never stop or block the camera.
export function createLiveSolver({ makeWorker = () => new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" }),
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let worker = null, serial = 0, finish = null, timer = null;
  const clear = () => { clearTimer(timer); timer = null; };
  function cancel() {
    serial++; clear(); const done = finish; finish = null;
    worker?.terminate(); worker = null; done?.(null);
  }
  // Load the Python runtime before the first preview needs it, and again in
  // the background after a search budget had to terminate the interpreter.
  // The camera keeps streaming meanwhile, and the next stable frame finds a
  // warm worker instead of paying the whole runtime download and start-up.
  function prepare() {
    if (worker) return;
    try {
      const owned = makeWorker();
      worker = owned;
      // A warm-up is a real request too: bound it, handle failure immediately,
      // and ignore late notifications from an interpreter already retired.
      owned.onmessage = ({ data }) => {
        if (owned !== worker) return;
        if (data.type === "ready") clear();
        else if (data.type === "warm-error") cancel();
      };
      owned.onerror = () => { if (owned === worker) cancel(); };
      timer = setTimer(() => { if (owned === worker) cancel(); }, 90000);
      owned.postMessage({ type: "warm" });
    } catch { cancel(); }
  }
  // Cancelling a running Python search needs termination; discarding a camera
  // alignment does not. Keep an idle or warming worker for the next reading.
  function invalidate() { if (finish) cancel(); }
  const expire = () => { cancel(); prepare(); };
  return {
    cancel, invalidate, prepare,
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
