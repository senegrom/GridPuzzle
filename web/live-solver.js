// A preview has a fixed search budget and must never stop or block the camera.
export function createLiveSolver({ makeWorker = () => new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" }),
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let worker = null, serial = 0, finish = null, timer = null;
  const clear = () => { clearTimer(timer); timer = null; };
  function cancel() {
    serial++; clear(); const done = finish; finish = null;
    worker?.terminate(); worker = null; done?.(null);
  }
  return {
    cancel,
    solve(puzzle) {
      if (finish) cancel();
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
              clear(); timer = setTimer(cancel, 8000);
            }
            if (data.type === "result") settle(data.result);
          };
          owned.onerror = cancel;
          timer = setTimer(cancel, 90000);
          owned.postMessage({ id, puzzle });
        } catch { cancel(); }
      });
    },
  };
}
