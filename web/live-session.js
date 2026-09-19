import { recoveryCells, clearerCells, mergeRecoveredClues } from "./clue-recovery.js";
import { sameFrame, previewBlocker } from "./live-overlay.js";
import { sameGridContent } from "./live-content.js";
import { clone, checkShape } from "./model.js";

// OCR ownership and overlay visibility are deliberately separate. Motion may
// hide a result, but only changed rules/content, a timeout or Stop retires work.
export function createLiveSession({ read, solve, cancelRead, cancelSolve, onChange, onStatus,
  isCurrent = null, sameScene = null, autoSolve = () => true, readCells = null, onEvent = () => {}, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false, generation = 0, pending = false, preview = null, stored = null;
  let solveGeneration = 0, solving = false, activeSample = null;
  let pendingRecovery = null, recoveryQuality = null, lastRecovery = -Infinity;
  const recoveryAttempts = new Map();
  let reference = null, best = null, challenger = null, stable = 0, attempts = 0;
  let lastRead = -Infinity, lastSharpness = 0, deadline = null, lostAt = null, signature = null;
  let status = "Reading printed clues… Keep the grid in view.", lastStatus = "";
  const say = message => { if (active && message !== lastStatus) { lastStatus = message; onStatus(message); } };
  const clearDeadline = () => { clearTimer(deadline); deadline = null; };
  const release = frame => {
    const image = frame?.image;
    if (!image) return;
    frame.image = null;
    if (typeof image.width === "number") { try { image.width = image.height = 0; } catch { /* plain test data */ } }
  };
  const publish = value => { if (preview !== value) { preview = value; onChange(value); } };
  function reset(reason = "reset") {
    onEvent({ stage: "tracking", reason, cancelledRead: pending && !solving, cancelledSolve: solving });
    generation++; solveGeneration++; solving = false; clearDeadline(); pending = false; stable = 0; attempts = 0;
    release(best); best = reference = challenger = stored = activeSample = null;
    lastRead = -Infinity; lastSharpness = 0; lostAt = null;
    pendingRecovery = recoveryQuality = null; lastRecovery = -Infinity; recoveryAttempts.clear();
    cancelRead(); cancelSolve(); publish(null);
  }
  function proof(frame) {
    if (!frame) return null;
    const match = isCurrent ? isCurrent(frame) : sameFrame(frame.signature, signature ?? frame.signature);
    return match === true ? { corners: frame.corners } : match?.corners ? match : null;
  }
  function matches(a, b) {
    if (a.key !== b.key) return false;
    if (sameScene) return sameScene(a, b);
    if (a.content || b.content) return sameGridContent(a.content, b.content);
    return sameFrame(a.signature, b.signature) && a.corners.every((p,i) =>
      Math.hypot(p.x - b.corners[i].x, p.y - b.corners[i].y) <= b.width * .012);
  }
  function hide() {
    publish(null); release(best); best = null;
    // A missing asynchronous proof hides the view, not the two already
    // verified observations of this original anchor. Resetting acquisition
    // here can starve OCR whenever worker replies span multiple camera ticks.
    // Changed content, settings and prolonged loss still reset ownership.
    if (lostAt === null) lostAt = now();
    // Bounded retention prevents a camera pointed elsewhere keeping old
    // images/work indefinitely. Brief motion never restarts this clock.
    if (now() - lostAt >= 5000) {
      reset("grid-lost"); say("Grid lost. Keep the whole puzzle in view to read again.");
    } else say(pending ? "Aligning the grid — keeping the current read…" : "Aligning the grid — checking the printed clues…");
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
    lostAt = null;
    commitRecovery();
    if (stored) publish({ ...stored, corners: view.corners });
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
  function motion(next) { signature = next; validate(); }
  function observe(frame) {
    if (!active) { release(frame); return; }
    signature = frame.signature;
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
    challenger = null; lostAt = null;
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
    const owns = () => active && id === generation;
    status = "Reading printed clues… Keep the grid in view."; say(status);
    onEvent({ stage: "reading", reason: "full-read" });
    deadline = setTimer(() => {
      if (!owns()) return;
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
            stored = { found: partial, result: null, corners: sample.corners, sample };
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
        if (owns() && error?.name !== "AbortError") { status = error.message || "Could not read this frame. Try moving closer."; if (validate()) say(status); }
      } finally { if (owns()) { clearDeadline(); pending = false; validate(); } }
    })();
  }
  return {
    start() { if (active) return; active = true; reset("started"); },
    stop() { active = false; reset("stopped"); signature = null; lastStatus = ""; },
    invalidate() { reset("settings-or-detection"); },
    suspend: hide, motion, observe, validate,
    get preview() { return preview; },
    get busy() { return pending; },
    get settled() { return !!stored?.readComplete && !pending && !pendingRecovery; },
    get trackingFrames() { return [stored?.sample, reference, challenger, best, activeSample].filter(Boolean); },
    get anchorFrame() { return stored?.sample ?? reference; },
  };
}
