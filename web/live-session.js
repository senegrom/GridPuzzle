import { recoveryCells, clearerCells, mergeRecoveredClues } from "./clue-recovery.js";
import { previewBlocker } from "./live-overlay.js";
import { clone, checkShape } from "./model.js";

// Drops a canvas's pixels without waiting for the collector. Plain test
// objects without numeric dimensions are left alone.
export function releaseImage(image) {
  if (!image || typeof image.width !== "number") return;
  try { image.width = image.height = 0; } catch { /* plain test data */ }
}

// A view that stays unverified for LOSS_LIMIT milliseconds retires the reading.
// Verified replies on the delayed tier can arrive up to two seconds apart, so
// a view hidden for less than ALIGN_NOTICE is not announced: announcing every
// such gap made the help line alternate with the status on each reply.
const LOSS_LIMIT = 5000, ALIGN_NOTICE = 2000;

// OCR ownership and overlay visibility are deliberately separate. Motion may
// hide a result, but only changed rules/content, a timeout or Stop retires work.
// Frame identity belongs to the camera: `isCurrent(frame)` says whether the
// frame is verified against the pixels on screen (falsy, or { corners, stale })
// and `sameScene(a, b)` whether two frames show the same printed puzzle.
// `lossPaused()` says whether no proof can currently arrive (the tracking
// worker is building an anchor); that time does not count towards the loss.
export function createLiveSession({ read, solve, cancelRead, cancelSolve, onChange, onStatus,
  isCurrent, sameScene, autoSolve = () => true, readCells = null, onEvent = () => {}, lossPaused = () => false,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (typeof isCurrent !== "function") throw new TypeError("createLiveSession requires isCurrent(frame)");
  if (typeof sameScene !== "function") throw new TypeError("createLiveSession requires sameScene(a, b)");
  let active = false, generation = 0, pending = false, preview = null, stored = null;
  let solveGeneration = 0, solving = false, activeSample = null;
  let pendingRecovery = null, recoveryQuality = null, lastRecovery = -Infinity;
  const recoveryAttempts = new Map();
  let reference = null, best = null, challenger = null, stable = 0, attempts = 0;
  let lastRead = -Infinity, lastSharpness = 0, deadline = null;
  // lossStart: when the verified view was last lost (null while verified);
  // lossCounted: how much of the loss since then counts, updated at lossTick.
  let lossStart = null, lossCounted = 0, lossTick = 0;
  let status = "Reading printed clues… Keep the grid in view.", lastStatus = "", held = null;
  // While the camera holds a message (a stalled feed, a paused worker), the
  // session's own status stays off the help line; releasing the hold shows
  // the status again even if it is the one that was last written.
  const say = message => { if (!active || held !== null || message === lastStatus) return; lastStatus = message; onStatus(message); };
  const clearDeadline = () => { clearTimer(deadline); deadline = null; };
  const release = frame => {
    const image = frame?.image;
    if (!image) return;
    frame.image = null;
    releaseImage(image);
  };
  const publish = value => { if (preview !== value) { preview = value; onChange(value); } };
  function reset(reason = "reset") {
    onEvent({ stage: "tracking", reason, cancelledRead: pending && !solving, cancelledSolve: solving });
    generation++; solveGeneration++; solving = false; clearDeadline(); pending = false; stable = 0; attempts = 0;
    release(best); release(activeSample); release(pendingRecovery?.sample); best = reference = challenger = stored = activeSample = null;
    lastRead = -Infinity; lastSharpness = 0; lossStart = null;
    pendingRecovery = recoveryQuality = null; lastRecovery = -Infinity; recoveryAttempts.clear();
    cancelRead(); cancelSolve(); publish(null);
  }
  // The proof is passed on as the camera made it, so a delayed tier
  // (`stale: true`) reaches the published preview unchanged.
  function proof(frame) {
    if (!frame) return null;
    const match = isCurrent(frame);
    return match === true ? { corners: frame.corners } : match?.corners ? match : null;
  }
  function matches(a, b) {
    return a.key === b.key && sameScene(a, b);
  }
  function hide() {
    publish(null); release(best); best = null;
    // A missing asynchronous proof hides the view, not the two already
    // verified observations of this original anchor. Resetting acquisition
    // here can starve OCR whenever worker replies span multiple camera ticks.
    // Changed content, settings and prolonged loss still reset ownership.
    // Bounded retention prevents a camera pointed elsewhere keeping old
    // images/work indefinitely. Brief motion never restarts this clock, but
    // it stands still while the worker builds an anchor: no proof can arrive
    // meanwhile, and an anchor longer than the limit once reset every read.
    const time = now();
    if (lossStart === null) { lossStart = lossTick = time; lossCounted = 0; }
    else { if (!lossPaused()) lossCounted += time - lossTick; lossTick = time; }
    if (lossCounted >= LOSS_LIMIT) {
      reset("grid-lost"); say("Grid lost. Keep the whole puzzle in view to read again.");
    } else if (time - lossStart >= ALIGN_NOTICE)
      say(pending ? "Aligning the grid — keeping the current read…" : "Aligning the grid — checking the printed clues…");
    return false;
  }
  function validate() {
    if (!active) return false;
    if (!autoSolve()) {
      if (solving) { solveGeneration++; solving = false; pending = false; cancelSolve(); }
      if (stored) {
        if (stored.result || stored.solveFinished)
          status = "Clues read. Automatic solving is off; capture to review or play.";
        stored.result = null; stored.solveFinished = false;
      }
    }
    const target = stored?.sample ?? reference;
    if (!target) return false;
    const view = proof(target);
    if (!view) return hide();
    lossStart = null;
    commitRecovery();
    if (stored) publish({ ...stored, corners: view.corners, stale: view.stale === true });
    if (stored || pending) say(status);
    startSolve();
    return true;
  }
  function commitRecovery() {
    const job = pendingRecovery;
    if (!job) return;
    if (stored !== job.base || now() - job.finishedAt > 5000) {
      pendingRecovery = activeSample = null;
      if (stored === job.base) { stored.result = autoSolve() ? job.oldResult : null; stored.solveFinished = autoSolve() && job.oldSolveFinished; }
      onEvent({ stage: 'checking', reason: 'retry-expired' }); return;
    }
    if (!proof(job.base.sample) || !proof(job.sample)) return;
    pendingRecovery = activeSample = null;
    try {
      const found = mergeRecoveredClues(job.base.found, job.result, job.cells);
      stored = { ...job.base, found,
        result: !autoSolve() || found.recovery.changed.length ? null : job.oldResult,
        solveFinished: !autoSolve() || found.recovery.changed.length ? false : job.oldSolveFinished };
      status = previewBlocker(found) ?? `${recoveryCells(found).length} clues still need review. Re-read proposals remain unconfirmed.`;
      onEvent({ stage: 'checking', reason: 'targeted-complete', targets: job.cells,
        changed: found.recovery.changed.length, calls: job.result.ocrStats?.calls ?? 0, found });
    } catch (error) {
      stored.result = autoSolve() ? job.oldResult : null; stored.solveFinished = autoSolve() && job.oldSolveFinished;
      status = error.message || 'The retry could not be applied. Capture for review.';
      onEvent({ stage: 'checking', reason: 'retry-rejected' });
    }
  }
  function startRecovery(sample, cells) {
    const base = stored, id = ++generation, oldResult = base.result, oldSolveFinished = base.solveFinished;
    activeSample = sample; best = null; pending = true; lastRecovery = now();
    solveGeneration++; solving = false; cancelSolve(); base.result = null; base.solveFinished = false;
    for (const cell of cells) recoveryAttempts.set(cell, (recoveryAttempts.get(cell) ?? 0) + 1);
    const previous = new Map(recoveryQuality?.cells?.map(c => [c.cell, c]) ?? []);
    for (const item of sample.quality?.cells ?? []) if (cells.includes(item.cell)) previous.set(item.cell, item);
    recoveryQuality = { ...sample.quality, cells: [...previous.values()] };
    const owns = () => active && id === generation && stored === base;
    // A failed refinement must not retire a valid full reading. Retire only
    // this request; late replies cannot mutate the retained board or a retry.
    const failed = reason => {
      if (!owns()) return;
      generation++; pending = false; pendingRecovery = activeSample = null;
      clearDeadline(); cancelRead(); release(sample);
      base.result = autoSolve() ? oldResult : null;
      base.solveFinished = autoSolve() && oldSolveFinished;
      status = reason === 'retry-timeout'
        ? 'Clue retry timed out. Keeping the previous reading; capture to review.'
        : 'Could not re-read those clues. Keeping the previous reading; capture to review.';
      onEvent({ stage: 'checking', reason, cancelledRead: reason === 'retry-timeout' });
      validate();
    };
    status = `Re-reading ${cells.length} unclear clues from a clearer frame…`; say(status);
    onEvent({ stage: 'reading', reason: 'targeted', targets: cells });
    deadline = setTimer(() => failed('retry-timeout'), 90000);
    void (async () => {
      try {
        const result = await readCells(sample, base.found, cells);
        if (!owns()) return;
        // Reserve budget before starting, but refund work explicitly skipped
        // before OCR. Keep the inspected quality and cooldown to avoid a loop
        // on identical pixels; a later genuinely clearer frame is still eligible.
        if (result.identicalCrops === true || result.ocrStats?.calls === 0) {
          for (const cell of cells) recoveryAttempts.set(cell, Math.max(0, (recoveryAttempts.get(cell) ?? 1) - 1));
          activeSample = null;
          base.result = autoSolve() ? oldResult : null;
          base.solveFinished = autoSolve() && oldSolveFinished;
          status = 'No new clue evidence. Keeping the previous reading; waiting for a clearer frame.';
          onEvent({ stage: 'checking', reason: 'retry-skipped', targets: cells, calls: 0 });
          return;
        }
        pendingRecovery = { base, result, cells, sample, oldResult, oldSolveFinished, finishedAt: now() };
      } catch (error) {
        failed('retry-failed');
      } finally {
        release(sample);
        if (owns()) { pending = false; clearDeadline(); validate(); }
      }
    })();
  }
  function startSolve() {
    if (!autoSolve() || pending || pendingRecovery || !stored?.readComplete || stored.solveFinished || previewBlocker(stored.found)) return;
    const target = stored, id = generation, solveId = ++solveGeneration;
    // Only a freshly verified reading can start a solve. A result arriving
    // during movement remains queued until the grid reappears unchanged.
    if (!proof(target.sample)) return;
    target.solveFinished = true; pending = true; solving = true;
    status = "Finding a solution on this device…"; say(status);
    onEvent({ stage: "solving", reason: "started" });
    void (async () => {
      try {
        const result = await solve(clone(target.found.puzzle));
        if (!active || id !== generation || solveId !== solveGeneration || !autoSolve() || stored !== target) return;
        onEvent({ stage: "solving", reason: result?.status || "unfinished" });
        if (result?.status === "unique" && result.complete === true) {
          target.result = result;
          status = "Solution preview — check the clues and rules. Tap the shutter to save this picture.";
        } else status = result?.status === "multiple" ? "More than one solution — check the readings and puzzle type."
          : result?.status === "no-solution" ? "No solution to these readings — move closer or review the clues."
          : "Preview search paused. Keep the grid in view to retry, or capture and use the full editor.";
      } catch (error) {
        if (active && id === generation && solveId === solveGeneration && autoSolve()) status = error.message || "Preview search failed. Capture to review the clues.";
      } finally {
        if (active && id === generation && solveId === solveGeneration) { pending = false; solving = false; validate(); }
      }
    })();
  }
  // A newly verified camera frame: re-check what is displayed against it.
  function motion() { validate(); }
  function observe(frame) {
    if (!active) { release(frame); return; }
    // A detection can finish after the camera has moved. Verify that captured
    // frame against the current pixels, rather than rejecting its background.
    if (!proof(frame)) { release(frame); hide(); return; }
    if (reference && reference.key !== frame.key) reset();
    if (reference && !matches(reference, frame)) {
      // First mismatch hides immediately; two matching fresh detections are
      // needed to declare a different puzzle. Neither can show the old result.
      if (!challenger || !matches(challenger, frame)) {
        challenger = { ...frame, image: null }; release(frame); hide(); return;
      }
      reset("content-changed"); say("Printed content changed — reading the new clues…");
    }
    challenger = null; lossStart = null;
    if (!reference) reference = { ...frame, image: null };
    stable++;
    const targets = readCells && stored?.readComplete ? recoveryCells(stored.found) : [];
    if (!pending && (targets.length || !best || frame.sharpness >= best.sharpness)) { if (best !== frame) release(best); best = frame; }
    else if (frame !== best) release(frame);
    if (!validate() || pending || pendingRecovery || stable < 2) return;
    if (targets.length) {
      if (targets.every(cell => (recoveryAttempts.get(cell) ?? 0) >= 2)) {
        status = 'Automatic retries finished — capture to review the remaining clues.';
        say(status); onEvent({ stage: 'checking', reason: 'retry-exhausted', targets });
        return;
      }
      const cells = clearerCells(stored.found, recoveryQuality, best?.quality, recoveryAttempts);
      if (!cells.length || now() - lastRecovery < 1500) {
        status = 'Waiting for a clearer frame of the unclear clues. Capture to review them manually.';
        say(status); onEvent({ stage: 'checking', reason: 'clearer-frame-needed', targets }); return;
      }
      if (best && proof(stored.sample) && matches(stored.sample, best)) startRecovery(best, cells);
      return;
    }
    const elapsed = now() - lastRead, sharper = attempts > 0 && Number.isFinite(best?.sharpness) &&
      best.sharpness >= Math.max(lastSharpness * 1.3, lastSharpness + 40);
    if (sharper) { if (elapsed < 1000) return; }
    else {
      if (stored?.result?.status === "unique" || (!autoSolve() && stored?.readComplete)) return;
      if (elapsed < Math.min(24000, 3000 * 2 ** Math.max(0, attempts - 1))) return;
    }
    const id = ++generation, sample = best;
    if (!sample) return;
    best = null; activeSample = sample; pending = true; attempts = sharper ? 1 : attempts + 1;
    lastRead = now(); lastSharpness = Number.isFinite(sample.sharpness) ? sample.sharpness : 0;
    // A full retry is a proposal until it completes. Keep the accepted reading
    // in stored so its anchor stays retained/proved and a failed partial atlas
    // cannot replace it. First acquisition still publishes partial clues.
    const base = stored?.readComplete ? stored : null;
    let reading = true;
    const owns = () => reading && active && id === generation;
    const failedRetry = reason => {
      if (!owns()) return;
      // Retire this request before cancellation, which can deliver callbacks.
      reading = false; generation++; clearDeadline(); pending = false;
      stored = base; release(sample);
      if (activeSample === sample) activeSample = null;
      cancelRead();
      status = reason === "full-retry-timeout"
        ? "Recognition retry timed out. Keeping the previous reading; capture to review."
        : "Could not re-read this frame. Keeping the previous reading; capture to review.";
      onEvent({ stage: "checking", reason, cancelledRead: reason === "full-retry-timeout" });
      // Retention is not permission to paint: proof(base.sample) still gates
      // the overlay, and prolonged loss, changed content and Stop still reset.
      validate();
    };
    status = "Reading printed clues… Keep the grid in view."; say(status);
    onEvent({ stage: "reading", reason: "full-read" });
    deadline = setTimer(() => {
      if (!owns()) return;
      if (base) { failedRetry("full-retry-timeout"); return; }
      reset(); say("Recognition timed out. Keep the grid in view to retry, or capture for manual review.");
    }, 90000);
    void (async () => {
      try {
        let found;
        try {
          found = await read(sample, message => {
            if (!owns()) return;
            status = message; if (validate()) say(message);
          }, partial => {
            if (!owns()) return;
            checkShape(partial.puzzle);
            if (!base) stored = { found: partial, result: null, corners: sample.corners, sample };
            validate();
          });
        } finally { release(sample); if (activeSample === sample) activeSample = null; }
        if (!owns()) return;
        clearDeadline(); checkShape(found.puzzle);
        stored = { found, result: null, corners: sample.corners, sample, readComplete: true };
        recoveryQuality = sample.quality; recoveryAttempts.clear();
        onEvent({ stage: 'checking', reason: 'read-complete', found });
        const blocker = previewBlocker(found);
        status = blocker ?? (autoSolve() ? "Clues read — checking the current grid…"
          : "Clues read. Automatic solving is off; capture to review or play.");
        validate();
        if (blocker) return;

      } catch (error) {
        if (base) failedRetry("full-retry-failed");
        else if (owns() && error?.name !== "AbortError") { status = error.message || "Could not read this frame. Try moving closer."; if (validate()) say(status); }
      } finally { if (owns()) { reading = false; clearDeadline(); pending = false; validate(); } }
    })();
  }
  return {
    start() { if (active) return; active = true; reset("started"); },
    stop() { active = false; reset("stopped"); lastStatus = ""; held = null; },
    invalidate() { reset("settings-or-detection"); },
    // One-off guidance from the camera through the same writer, so the next
    // status is not skipped as a repeat of a line that was overwritten.
    notify(message) { lastStatus = message; onStatus(message); },
    // A message the camera keeps asserting while its condition lasts, in place
    // of the status; hold(null) releases it and the status is shown again.
    // The camera calls hold(null) on every heartbeat, so only an actual
    // release may forget the last line: otherwise the unchanged status would
    // be rewritten, and announced, ten times a second.
    hold(message) {
      const released = held !== null && message === null;
      held = message;
      if (message === null) { if (released) lastStatus = ""; return; }
      if (lastStatus !== message) { lastStatus = message; onStatus(message); }
    },
    suspend: hide, motion, observe, validate,
    get preview() { return preview; },
    get busy() { return pending; },
    get settled() { return !!stored?.readComplete && !pending && !pendingRecovery; },
    // Every frame whose anchor the tracker must retain and compare new
    // detections with.
    get trackingFrames() { return [stored?.sample, reference, challenger, best, activeSample].filter(Boolean); },
    // The frames whose proofs the session reads: the anchor frame (the
    // overlay, validation and solving) and the frame being read, which becomes
    // the anchor frame once its first clues arrive and which a finished retry
    // checks before it is applied. The reference, the challenger and the best
    // frame are only compared through sameScene, which uses the matches
    // recorded when an anchor is built.
    get proofFrames() { return [stored?.sample ?? reference, activeSample].filter(Boolean); },
    get anchorFrame() { return stored?.sample ?? reference; },
  };
}
