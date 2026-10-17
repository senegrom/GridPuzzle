const cancelled = () => new DOMException('Tracking request retired', 'AbortError');
// Bitmaps failed where only the ImageData transport works (see the handshake):
// the tracker gives them up and resets, and the camera starts acquisition again.
const unsupported = () => new DOMException('Bitmaps cannot reach background tracking here.', 'NotSupportedError');
// One frame lost to its bitmap (see REFUSAL_LIMIT), or to a blank readback of
// the camera's own (readbackBlank): no failure, and the camera drops the frame
// as it drops a retired one. isLostFrame tells it from a retired request: the
// camera then samples its next frame at once.
export const lostFrame = () => Object.assign(new DOMException('The pixels of this frame could not be tracked.', 'AbortError'), { lostFrame: true });
export const isLostFrame = error => error?.name === 'AbortError' && error.lostFrame === true;
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
// would have. A wait whose timer fires more than HANDSHAKE_LATE after its
// time ran behind a long task on this thread, and the answer may have waited
// for that task: in Chromium a new worker's first OffscreenCanvas use waits
// for this thread's task to end; so does a worker's first bitmap or canvas on
// an iPhone, whose connection to the GPU process WebKit sets up on this thread
// (callOnMainRunLoopAndWait in RemoteRenderingBackendProxy); and WebKit
// delivers a reply that reached this thread during a long task only after a
// timer that came due during it. Such a wait is renewed while the worker
// started less than the anchor deadline ago, so a worker held back by a task
// that ends more than HANDSHAKE_LATE after the wait's end is kept, and one
// that never answers is still replaced on a page that stays busy. A task that
// ends within HANDSHAKE_LATE after the wait's end holds the answer back just
// the same, but its timer counts as on time, so the first wait of a worker
// that ends on time without an answer is renewed too, once. A worker without
// an answer when a second wait ends on time (600 ms after its start on a free
// page), or one ends past that bound, may be stuck on its probe: it is
// replaced by one on the camera's own readback, the worker after the next
// reset probes again, and the second worker so replaced in the tracker's life
// gives bitmaps up.
export const HANDSHAKE_WAIT = 300, HANDSHAKE_LATE = 50;
// Why a worker uses its transport (stats.transportReason, for the diagnostic
// report, so an "imagedata" from a phone tells an old iOS from a slow or
// failed handshake). From its handshake: "probe" (the probe read back right:
// bitmap), "mismatch" (a value off; stats.probePixels then holds the values
// read back), "no-pixels" (the worker could not draw it: no OffscreenCanvas
// or 2D context there), "unreadable" (its answer could not be received),
// "no-bitmaps" (this thread makes no bitmaps), "probe-failed" (the probe could
// not be made or transferred). Without a handshake: "timeout" (the worker
// replacing one that did not answer its probe, see HANDSHAKE_WAIT; once a
// second worker missed it, bitmaps are given up and every later worker says
// "timeout" too). Once bitmaps have been given up for another cause, every
// later worker uses the camera's readback without a handshake and gives that
// cause: "refused" (the worker could not read a bitmap back) and "unmade"
// (the camera could not make a bitmap of its snapshot, or got one of another
// size), each for the frame that made the losses persist (REFUSAL_LIMIT),
// "untransferable" (a bitmap could not be transferred), "unanswered" (a
// worker's first bitmap job reached its deadline, got an unreadable reply or
// the worker died in it). stats.handshakeMilliseconds is the time from the
// worker's start to its handshake's decision; null without one.
export const TRANSPORT_REASONS = Object.freeze(['probe', 'mismatch', 'no-pixels', 'unreadable', 'no-bitmaps', 'probe-failed',
  'timeout', 'refused', 'untransferable', 'unmade', 'unanswered']);
// A frame whose bitmap the worker refuses (it arrived null, 0 x 0 or smaller
// than the tracking pixels, or read back with a transparent pixel: a bitmap
// that drew nothing, or a snapshot of a video that had no picture to draw) or
// the camera cannot make (no bitmap, or one of another size than its
// snapshot: WebKit's blank 1 x 1 when it cannot allocate the copy) is lost
// alone: its job fails as a retired one, and no pixel of it reaches the
// tracking core. One such frame says little about the browser, so bitmaps are
// given up only when the losses persist: at a frame lost that is at least the
// REFUSAL_LIMIT-th in a row, with no bitmap job completed in between, and
// comes REFUSAL_SPAN or more after the first of them, in the tracker's life
// (the camera session; a reset does not end the run). Persistence is measured
// in time as well, since the count alone follows the sampling: the camera
// samples the frame after a lost one at once, and a tick that detects and
// verifies makes two bitmaps of one snapshot, so a condition that passes
// within a tenth of a second can lose three in a row. Three verification
// frames of a settled reading, 250 ms apart, span 500 ms: that was the count's
// time scale before the camera hurried its samples, and it stays. A browser
// that can read no frame back that way loses the anchors of its detections,
// at least 300 ms apart, so the span does not delay its give-up: it loses
// REFUSAL_LIMIT - 1 frames before its tracking moves to the camera's own
// readback. stats.refusedFrames and stats.unmadeFrames count the frames lost
// for each cause, and refusedIncomplete, refusedBlank and refusedFailed the
// refused ones by the worker's reason (REFUSALS in live-tracking-pixels.js).
// On the camera's own readback, a readback with no picture at all
// (transparent wherever the worker checks a bitmap's) is lost the same way
// (readbackBlank, counted in stats.blankReadbacks), and gives nothing up,
// since there is nothing to fall back to.
export const REFUSAL_LIMIT = 3, REFUSAL_SPAN = 500;
// The stats key of each reason the worker gives for refusing a bitmap
// (REFUSALS in live-tracking-pixels.js); a reply without a known one counts
// as "failed".
const REFUSED = Object.freeze({ incomplete: 'refusedIncomplete', blank: 'refusedBlank', failed: 'refusedFailed' });
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
  setTimer = setTimeout, clearTimer = clearTimeout, probe = probeBitmap, now = () => performance.now(),
} = {}) {
  let worker = null, active = null, frame = null, anchor = null, serial = 0, deadline = null;
  // This worker's transport (null while its handshake runs), why, the probe's
  // values on a mismatch, when the worker started and how long after that its
  // handshake decided; the handshake's timer, when its wait last started,
  // whether one of its waits has ended on time without an answer, and the
  // callers of ready() waiting for it; whether a bitmap job of this worker
  // has completed; whether a worker of this tracker was replaced for missing
  // the wait; once bitmaps have been given up, why (every later worker then
  // uses the camera's readback); and how many bitmap frames in a row were
  // lost, since when (REFUSAL_LIMIT).
  let transport = null, reason = null, mismatched = null, startedAt = null, handshakeMs = null;
  let handshake = null, armedAt = null, missed = false, waiters = [], proven = false, timedOut = false, givenUp = null, lost = 0, lostSince = null;
  const stats = { submitted: 0, completed: 0, dropped: 0, failures: 0, milliseconds: 0, transportMilliseconds: 0,
    refusedFrames: 0, refusedIncomplete: 0, refusedBlank: 0, refusedFailed: 0, unmadeFrames: 0, blankReadbacks: 0 };
  // Every bitmap handed over is transferred or closed; closing a transferred
  // one does nothing.
  const discard = job => { try { job?.data.bitmap?.close?.(); } catch { /* closed already */ } };
  function reset(error = cancelled()) {
    clearTimer(deadline); deadline = null;
    clearTimer(handshake); handshake = null;
    // No worker: no transport, and the next worker has completed no bitmap job.
    const old = worker; worker = null; transport = reason = mismatched = startedAt = handshakeMs = null; proven = false;
    for (const job of [active, frame, anchor]) { discard(job); job?.reject(error); }
    active = frame = anchor = null;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
    if (old) { old.onmessage = old.onerror = old.onmessageerror = null; old.terminate(); }
  }
  function fail(message) { stats.failures++; reset(Error(message)); }
  // Not a tracking failure: the next worker uses the ImageData transport.
  function giveUp(cause) { givenUp = cause; reset(unsupported()); }
  // A bitmap frame lost for `cause`, "refused" (with the worker's reason) or
  // "unmade" (REFUSAL_LIMIT): counted, and one that is at least the
  // REFUSAL_LIMIT-th in a row, REFUSAL_SPAN or more after the first of them,
  // gives bitmaps up. Whether that reset the worker. A frame made for a worker
  // before bitmaps were given up is only counted: its loss must not reset the
  // worker that replaced it. Nor may a frame made for a worker before a reset
  // reset the worker after it, once that worker's handshake decided for the
  // camera's own readback: it has no bitmap to lose. It is kept, and bitmaps
  // are given up for the workers after it.
  function lose(cause, refusal) {
    stats[cause === 'refused' ? 'refusedFrames' : 'unmadeFrames']++;
    if (cause === 'refused') stats[Object.hasOwn(REFUSED, refusal) ? REFUSED[refusal] : REFUSED.failed]++;
    if (givenUp) return false;
    if (lost++ === 0) lostSince = now();
    if (lost < REFUSAL_LIMIT || now() - lostSince < REFUSAL_SPAN) return false;
    if (transport === 'imagedata') { givenUp = cause; return false; }
    giveUp(cause); return true;
  }
  function decide(value, why, values = null) {
    transport = value; reason = why; mismatched = values;
    handshakeMs = startedAt === null ? null : time(now() - startedAt);
    clearTimer(handshake); handshake = null;
    for (const waiter of waiters.splice(0)) waiter.resolve(value);
    dispatch();
  }
  // The end of the handshake's wait. A wait that ran late, behind a long task
  // on this thread, is renewed (see HANDSHAKE_WAIT), up to the anchor deadline
  // after the worker started, and so is the worker's first wait that ends on
  // time: a task that ended just before its timer fired may hold the answer
  // back as well. Otherwise a worker that has not answered its probe may be
  // stuck on it, and a worker handles its messages in order: every job would
  // wait behind the probe and fail at its deadline. It is replaced by a
  // worker that uses the ImageData transport without a probe. Nothing was
  // built on it, so this is no failure, and the callers waiting for the
  // decision get the new worker's, which has no handshake to time. The worker
  // after the next reset probes again, unless a worker was replaced so
  // before: then bitmaps are given up for the tracker's life.
  function stalled() {
    const at = now();
    if (at - armedAt > HANDSHAKE_WAIT + HANDSHAKE_LATE && at - startedAt < ANCHOR_DEADLINE) {
      armedAt = at; handshake = setTimer(stalled, HANDSHAKE_WAIT); return;
    }
    if (!missed && at - startedAt < ANCHOR_DEADLINE) {
      missed = true; armedAt = at; handshake = setTimer(stalled, HANDSHAKE_WAIT); return;
    }
    if (timedOut) givenUp = 'timeout';
    timedOut = true; handshake = null; startedAt = null;
    const old = worker; worker = null;
    old.onmessage = old.onerror = old.onmessageerror = null; old.terminate();
    try { ensure('timeout'); } catch (error) { fail(error?.message || 'Background tracking is unavailable.'); }
  }
  // A worker started without a handshake uses the camera's readback and says
  // why: the cause bitmaps were given up for, or "timeout" for the one that
  // replaces a worker that missed the handshake's wait.
  function ensure(why = givenUp) {
    if (worker) return;
    const owned = makeWorker(); worker = owned; missed = false;
    // A worker that dies while its first bitmap job is in it gives bitmaps up,
    // as one that never answers that job does: a bitmap that crashes the
    // worker would crash each new worker, counted, until tracking paused.
    // Dying later, idle or on the camera's own readback fails as before.
    owned.onerror = event => {
      if (worker !== owned) return;
      if (active?.data.bitmap && !proven) giveUp('unanswered'); else fail(event?.message || 'Background tracking failed.');
    };
    // A reply that cannot be received: during the handshake it decides
    // "imagedata" (nothing was built on the worker yet); before a bitmap job
    // has completed it gives bitmaps up; after that it fails as before.
    owned.onmessageerror = () => {
      if (worker !== owned) return;
      if (transport === null) decide('imagedata', 'unreadable');
      else if (transport === 'bitmap' && !proven) giveUp('unanswered');
      else fail('Could not receive background tracking.');
    };
    owned.onmessage = ({ data }) => {
      if (worker !== owned) return;
      if (data?.started) {
        if (transport === null) { startedAt = armedAt = now(); clearTimer(handshake); handshake = setTimer(stalled, HANDSHAKE_WAIT); }
        return;
      }
      if (data?.probe) {
        const pixels = data.probe.pixels;
        if (transport !== null) return;
        if (matches(pixels)) decide('bitmap', 'probe');
        else if (!pixels) decide('imagedata', 'no-pixels');
        // The values read back go to the diagnostic report (at most a 4 x 4 readback's).
        else decide('imagedata', 'mismatch', Array.isArray(pixels) ? pixels.slice(0, 64) : null);
        return;
      }
      if (!active || data?.id !== active.id) return;
      const job = active;
      // The worker could not read this frame's bitmap back (and closed it):
      // the frame is lost, and the next job goes out as after a reply.
      if (data.error === 'bitmap-unsupported' && job.data.bitmap) {
        if (lose('refused', data.refusal)) return;
        clearTimer(deadline); deadline = null; active = null;
        job.reject(lostFrame()); queueMicrotask(dispatch); return;
      }
      if (data.error || !data.result) { fail(data.error || 'Invalid background tracking reply.'); return; }
      clearTimer(deadline); deadline = null; active = null;
      if (job.data.bitmap) { proven = true; lost = 0; }
      stats.completed++;
      stats.milliseconds = time(data.milliseconds);
      stats.transportMilliseconds = time(data.transportMilliseconds);
      job.resolve(data.result);
      // The next job goes out after the caller's continuation, not before it:
      // a reply whose render freezes the view resets the tracker there, which
      // then closes the queued job's bitmap instead of posting it to a worker
      // it ends at once. WebKit (from iOS 18) never releases a transferred
      // bitmap whose message the ended worker had not started, keeping its
      // buffer in the GPU process for the life of the tab.
      queueMicrotask(dispatch);
    };
    let pending = null;
    if (!why) try { pending = probe(); if (!pending) why = 'no-bitmaps'; } catch { why = 'probe-failed'; }
    if (!pending) { decide('imagedata', why); return; }
    handshake = setTimer(() => fail('Background tracking timed out. Capture for manual review or restart the camera.'), ANCHOR_DEADLINE);
    Promise.resolve(pending).then(bitmap => {
      if (worker !== owned || transport !== null) { bitmap?.close?.(); return; }
      try { owned.postMessage({ op: 'probe', bitmap }, [bitmap]); } catch { bitmap?.close?.(); decide('imagedata', 'probe-failed'); }
    }, () => { if (worker === owned && transport === null) decide('imagedata', 'probe-failed'); });
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
      if (job.data.bitmap && !proven) giveUp('unanswered');
      else fail('Background tracking timed out. Capture for manual review or restart the camera.');
    }, job.data.op === 'anchor' ? ANCHOR_DEADLINE : VERIFY_DEADLINE);
    try { worker.postMessage({ ...job.data, id: job.id }, [job.data.bitmap ?? job.data.image.data.buffer]); }
    catch (error) {
      // A bitmap that cannot be transferred (DataCloneError) gives bitmaps
      // up. Either way the reset closes the job's bitmap.
      if (job.data.bitmap) giveUp('untransferable'); else fail(error?.message || 'Background tracking is unavailable.');
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
    // The camera could not make a bitmap of its frame, or got one of another
    // size: the frame is lost, and bitmaps are given up only when such losses
    // persist (REFUSAL_LIMIT). The error to throw: an AbortError for the frame
    // alone, or the NotSupportedError of the give-up.
    bitmapFailed() { return lose('unmade') ? unsupported() : lostFrame(); },
    // The camera's own readback of its frame has no picture (a snapshot of a
    // video that had none to draw): the frame is lost, counted. The error to
    // throw.
    readbackBlank() { stats.blankReadbacks++; return lostFrame(); },
    reset,
    get transport() { return transport; },
    // `active` counts a handshake in progress too: its probe is the worker's work.
    get stats() { return { ...stats, transport, transportReason: reason, handshakeMilliseconds: handshakeMs,
      probePixels: mismatched, active: active || (worker && transport === null) ? 1 : 0,
      queuedFrames: frame ? 1 : 0, queuedAnchors: anchor ? 1 : 0 }; },
  };
}
