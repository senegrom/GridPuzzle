const cancelled = () => new DOMException('Tracking request retired', 'AbortError');
// Bitmaps failed where only the ImageData transport works (see the handshake):
// the tracker gives them up and resets, and the camera starts acquisition again.
const unsupported = () => new DOMException('Bitmaps cannot reach background tracking here.', 'NotSupportedError');
// Each operation fails closed after its own deadline. A verification later than
// two seconds is useless to the delayed tier. An anchor is built from the whole
// grid and re-matches every retained anchor: on noisy real photographs it
// measured 1.1-1.2 times a verification of the same three anchors, which the
// camera no longer asks a verification to check (see LIVE_CAMERA.md). The
// earlier ten and 67-131 times compared against verifying an unchanged frame,
// which skips registration. Sharing the two-second deadline failed every anchor
// on a device whose verifications approach it and ended in Restart; twenty
// seconds leaves a wide margin.
export const VERIFY_DEADLINE = 2000, ANCHOR_DEADLINE = 20000;
// How a frame's pixels reach the worker. "bitmap": the camera hands over an
// ImageBitmap of its snapshot, transferred, and the worker draws it at the
// tracking size and reads it back (live-tracking-pixels.js), so the main
// thread neither scales nor reads back. "imagedata": the camera reads the
// pixels back itself and transfers their buffer, as every browser can. Each
// worker has one transport, decided by a handshake when it starts, so every
// anchor is verified on pixels resampled the way it was built: the tracker
// transfers a bitmap of PROBE, a 2 x 2 canvas of four known colours, and the
// worker draws it and reads it back. "bitmap" needs all sixteen values within
// 2. Anything else means "imagedata": a wrong value, no OffscreenCanvas or 2D
// context in the worker (before iOS 16.4), a bitmap that cannot be made or
// transferred, a reply that cannot be received, or no reply within
// HANDSHAKE_WAIT. That wait starts when the worker has started (its first
// message), since loading its modules is no part of the transport; a worker
// that does not start within the anchor deadline fails as its first anchor
// would have. A worker that misses the wait may be stuck on its probe: it is
// replaced, and bitmaps are not probed again for the tracker's life.
export const HANDSHAKE_WAIT = 300;
export const PROBE = Object.freeze([200, 40, 90, 255, 30, 160, 220, 255, 250, 250, 250, 255, 10, 10, 10, 255]);
const matches = pixels => pixels?.length === PROBE.length && PROBE.every((value, i) => Math.abs(pixels[i] - value) <= 2);
// The probe as a bitmap of a page canvas, as the camera's snapshots are; null
// where this thread cannot make bitmaps. Anything else that fails (no page,
// no 2D context) throws, which the handshake takes as "imagedata" too.
function probeBitmap() {
  if (typeof createImageBitmap !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(2, 2);
  image.data.set(PROBE); ctx.putImageData(image, 0, 0);
  return createImageBitmap(canvas);
}
const time = value => Number.isFinite(value) ? Math.max(0, value) : 0;

// One active worker operation, one latest pending video frame and one pending
// anchor creation (detection itself is already single-flight). No unbounded
// video queue, synchronous registration fallback or stale-worker callbacks.
export function createLiveTracker({
  makeWorker = () => new Worker(new URL('./live-tracking-worker.js', import.meta.url), { type: 'module' }),
  setTimer = setTimeout, clearTimer = clearTimeout, probe = probeBitmap,
} = {}) {
  let worker = null, active = null, frame = null, anchor = null, serial = 0, deadline = null;
  // This worker's transport (null while its handshake runs), the handshake's
  // timer and the callers of ready() waiting for it; whether a bitmap job of
  // this worker has completed; and "imagedata" for every later worker once
  // bitmaps have failed.
  let transport = null, handshake = null, waiters = [], proven = false, forced = null;
  const stats = { submitted: 0, completed: 0, dropped: 0, failures: 0, milliseconds: 0, transportMilliseconds: 0 };
  // Every bitmap handed over is transferred or closed; closing a transferred
  // one does nothing.
  const discard = job => { try { job?.data.bitmap?.close?.(); } catch { /* closed already */ } };
  function reset(error = cancelled()) {
    clearTimer(deadline); deadline = null;
    clearTimer(handshake); handshake = null;
    // No worker: no transport, and the next worker has completed no bitmap job.
    const old = worker; worker = null; transport = null; proven = false;
    for (const job of [active, frame, anchor]) { discard(job); job?.reject(error); }
    active = frame = anchor = null;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
    if (old) { old.onmessage = old.onerror = old.onmessageerror = null; old.terminate(); }
  }
  function fail(message) { stats.failures++; reset(Error(message)); }
  // Not a tracking failure: the next worker uses the ImageData transport.
  function giveUp() { forced = 'imagedata'; reset(unsupported()); }
  function decide(value) {
    transport = value; clearTimer(handshake); handshake = null;
    for (const waiter of waiters.splice(0)) waiter.resolve(value);
    dispatch();
  }
  // A worker that has not answered its probe HANDSHAKE_WAIT after it started
  // may be stuck on it, and a worker handles its messages in order: every job
  // would wait behind the probe and fail at its deadline. It is replaced by a
  // worker that uses the ImageData transport, as every later one does. Nothing
  // was built on it, so this is no failure, and the callers waiting for the
  // decision get the new worker's.
  function stalled() {
    forced = 'imagedata'; handshake = null;
    const old = worker; worker = null;
    old.onmessage = old.onerror = old.onmessageerror = null; old.terminate();
    try { ensure(); } catch (error) { fail(error?.message || 'Background tracking is unavailable.'); }
  }
  function ensure() {
    if (worker) return;
    const owned = makeWorker(); worker = owned;
    owned.onerror = event => { if (worker === owned) fail(event?.message || 'Background tracking failed.'); };
    // A reply that cannot be received: during the handshake it decides
    // "imagedata" (nothing was built on the worker yet); before a bitmap job
    // has completed it gives bitmaps up; after that it fails as before.
    owned.onmessageerror = () => {
      if (worker !== owned) return;
      if (transport === null) decide('imagedata');
      else if (transport === 'bitmap' && !proven) giveUp();
      else fail('Could not receive background tracking.');
    };
    owned.onmessage = ({ data }) => {
      if (worker !== owned) return;
      if (data?.started) {
        if (transport === null) { clearTimer(handshake); handshake = setTimer(stalled, HANDSHAKE_WAIT); }
        return;
      }
      if (data?.probe) { if (transport === null) decide(matches(data.probe.pixels) ? 'bitmap' : 'imagedata'); return; }
      if (!active || data?.id !== active.id) return;
      const job = active;
      if (data.error === 'bitmap-unsupported' && job.data.bitmap) { giveUp(); return; }
      if (data.error || !data.result) { fail(data.error || 'Invalid background tracking reply.'); return; }
      clearTimer(deadline); deadline = null; active = null;
      if (job.data.bitmap) proven = true;
      stats.completed++;
      stats.milliseconds = time(data.milliseconds);
      stats.transportMilliseconds = time(data.transportMilliseconds);
      job.resolve(data.result);
      dispatch();
    };
    let pending = null;
    try { pending = forced ? null : probe(); } catch { /* no bitmap: the ImageData transport */ }
    if (!pending) { decide('imagedata'); return; }
    handshake = setTimer(() => fail('Background tracking timed out. Capture for manual review or restart the camera.'), ANCHOR_DEADLINE);
    Promise.resolve(pending).then(bitmap => {
      if (worker !== owned || transport !== null) { bitmap?.close?.(); return; }
      try { owned.postMessage({ op: 'probe', bitmap }, [bitmap]); } catch { bitmap?.close?.(); decide('imagedata'); }
    }, () => { if (worker === owned && transport === null) decide('imagedata'); });
  }
  function dispatch() {
    if (active || (!anchor && !frame)) return;
    try { ensure(); } catch (error) { fail(error?.message || 'Background tracking is unavailable.'); return; }
    // Jobs wait for the handshake, whose decision dispatches them (and may
    // have dispatched this one already).
    if (active || (!anchor && !frame) || transport === null) return;
    const job = anchor ?? frame;
    if (anchor) anchor = null; else frame = null;
    // Prepared for a replaced worker of the other transport: retired.
    if ((job.data.bitmap ? 'bitmap' : 'imagedata') !== transport) { discard(job); job.reject(cancelled()); dispatch(); return; }
    active = job;
    deadline = setTimer(() => {
      if (active !== job) return;
      // A worker that never answers its first bitmap gives bitmaps up.
      if (job.data.bitmap && !proven) giveUp();
      else fail('Background tracking timed out. Capture for manual review or restart the camera.');
    }, job.data.op === 'anchor' ? ANCHOR_DEADLINE : VERIFY_DEADLINE);
    try { worker.postMessage({ ...job.data, id: job.id }, [job.data.bitmap ?? job.data.image.data.buffer]); }
    catch (error) {
      // A bitmap that cannot be transferred (DataCloneError) gives bitmaps
      // up. Either way the reset closes the job's bitmap.
      if (job.data.bitmap) giveUp(); else fail(error?.message || 'Background tracking is unavailable.');
    }
  }
  function submit(data) {
    return new Promise((resolve, reject) => {
      const job = { data, id: ++serial, resolve, reject }; stats.submitted++;
      if (data.op === 'anchor') { if (anchor) { stats.dropped++; discard(anchor); anchor.reject(cancelled()); } anchor = job; }
      else { if (frame) { stats.dropped++; discard(frame); frame.reject(cancelled()); } frame = job; }
      dispatch();
    });
  }
  return {
    anchor: data => submit({ ...data, op: 'anchor' }),
    verify: data => submit({ ...data, op: 'verify' }),
    // The transport of the worker, starting one if there is none, once its
    // handshake has decided it; a reset meanwhile rejects with its error.
    ready() {
      try { ensure(); } catch (error) {
        fail(error?.message || 'Background tracking is unavailable.');
        return Promise.reject(error);
      }
      return transport ? Promise.resolve(transport) : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    // The camera could not make a bitmap of its frame: bitmaps are given up as
    // for any other bitmap failure. The error to throw.
    bitmapFailed() { giveUp(); return unsupported(); },
    reset,
    get transport() { return transport; },
    // `active` counts a handshake in progress too: its probe is the worker's work.
    get stats() { return { ...stats, transport, active: active || (worker && transport === null) ? 1 : 0,
      queuedFrames: frame ? 1 : 0, queuedAnchors: anchor ? 1 : 0 }; },
  };
}
