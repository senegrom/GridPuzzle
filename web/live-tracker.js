const cancelled = () => new DOMException('Tracking request retired', 'AbortError');

// One active worker operation, one latest pending video frame and one pending
// anchor creation (detection itself is already single-flight). No unbounded
// video queue, synchronous registration fallback or stale-worker callbacks.
export function createLiveTracker({
  makeWorker = () => new Worker(new URL('./live-tracking-worker.js', import.meta.url), { type: 'module' }),
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let worker = null, active = null, frame = null, anchor = null, serial = 0, deadline = null;
  const stats = { submitted: 0, completed: 0, dropped: 0, failures: 0, milliseconds: 0 };
  function reset(error = cancelled()) {
    clearTimer(deadline); deadline = null;
    const old = worker; worker = null;
    for (const job of [active, frame, anchor]) job?.reject(error);
    active = frame = anchor = null;
    if (old) { old.onmessage = old.onerror = old.onmessageerror = null; old.terminate(); }
  }
  function fail(message) { stats.failures++; reset(Error(message)); }
  function ensure() {
    if (worker) return;
    const owned = makeWorker(); worker = owned;
    owned.onerror = event => { if (worker === owned) fail(event?.message || 'Background tracking failed.'); };
    owned.onmessageerror = () => { if (worker === owned) fail('Could not receive background tracking.'); };
    owned.onmessage = ({ data }) => {
      if (worker !== owned || !active || data?.id !== active.id) return;
      const job = active;
      if (data.error || !data.result) { fail(data.error || 'Invalid background tracking reply.'); return; }
      clearTimer(deadline); deadline = null; active = null;
      stats.completed++;
      stats.milliseconds = Number.isFinite(data.milliseconds) ? Math.max(0, data.milliseconds) : 0;
      job.resolve(data.result);
      dispatch();
    };
  }
  function dispatch() {
    if (active || (!anchor && !frame)) return;
    try {
      ensure();
      active = anchor ?? frame;
      if (anchor) anchor = null; else frame = null;
      const job = active;
      deadline = setTimer(() => { if (active === job) fail('Background tracking timed out. Capture for manual review or restart the camera.'); }, 2000);
      worker.postMessage({ ...job.data, id: job.id }, [job.data.image.data.buffer]);
    } catch (error) { fail(error?.message || 'Background tracking is unavailable.'); }
  }
  function submit(data) {
    return new Promise((resolve, reject) => {
      const job = { data, id: ++serial, resolve, reject }; stats.submitted++;
      if (data.op === 'anchor') { if (anchor) { stats.dropped++; anchor.reject(cancelled()); } anchor = job; }
      else { if (frame) { stats.dropped++; frame.reject(cancelled()); } frame = job; }
      dispatch();
    });
  }
  return {
    anchor: data => submit({ ...data, op: 'anchor' }),
    verify: data => submit({ ...data, op: 'verify' }),
    reset,
    get stats() { return { ...stats, active: active ? 1 : 0, queuedFrames: frame ? 1 : 0, queuedAnchors: anchor ? 1 : 0 }; },
  };
}
