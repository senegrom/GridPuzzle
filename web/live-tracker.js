const cancelled = () => new DOMException('Tracking request retired', 'AbortError');
// Each operation fails closed after its own deadline. A verification later than
// two seconds is useless to the delayed tier. An anchor is built from the whole
// grid and re-matches every retained anchor: on noisy real photographs it
// measured 1.1-1.2 times a verification of the same three anchors, which the
// camera no longer asks a verification to check (see LIVE_TRACKING.md). The
// earlier ten and 67-131 times compared against verifying an unchanged frame,
// which skips registration. Sharing the two-second deadline failed every anchor
// on a device whose verifications approach it and ended in Restart; twenty
// seconds leaves a wide margin.
export const VERIFY_DEADLINE = 2000, ANCHOR_DEADLINE = 20000;

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
      deadline = setTimer(() => { if (active === job) fail('Background tracking timed out. Capture for manual review or restart the camera.'); },
        job.data.op === 'anchor' ? ANCHOR_DEADLINE : VERIFY_DEADLINE);
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
