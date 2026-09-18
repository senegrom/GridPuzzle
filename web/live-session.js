import { sameFrame, previewBlocker } from "./live-overlay.js";
import { sameGridContent } from "./live-content.js";
import { clone, checkShape } from "./model.js";

// OCR ownership and overlay visibility are deliberately separate. Motion may
// hide a result, but only changed rules/content, a timeout or Stop retires work.
export function createLiveSession({ read, solve, cancelRead, cancelSolve, onChange, onStatus,
  isCurrent = null, sameScene = null, autoSolve = () => true, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false, generation = 0, pending = false, preview = null, stored = null;
  let solveGeneration = 0, solving = false;
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
  function reset() {
    generation++; solveGeneration++; solving = false; clearDeadline(); pending = false; stable = 0; attempts = 0;
    release(best); best = reference = challenger = stored = null;
    lastRead = -Infinity; lastSharpness = 0; lostAt = null;
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
    publish(null); stable = 0; release(best); best = null;
    if (lostAt === null) lostAt = now();
    // Bounded retention prevents a camera pointed elsewhere keeping old
    // images/work indefinitely. Brief motion never restarts this clock.
    if (now() - lostAt >= 5000) {
      reset(); say("Grid lost. Keep the whole puzzle in view to read again.");
    } else say(pending ? "Aligning the grid — keeping the current read…" : "Aligning the grid — checking the printed clues…");
    return false;
  }
  function validate() {
    if (!active) return false;
    if (!autoSolve()) {
      if (solving) { solveGeneration++; solving = false; pending = false; cancelSolve(); }
      if (stored) { stored.result = null; stored.solveFinished = false; }
      if (stored?.readComplete) status = "Clues read. Automatic solving is off; capture to review or play.";
    }
    const target = stored?.sample ?? reference;
    if (!target) return false;
    const view = proof(target);
    if (!view) return hide();
    lostAt = null;
    if (stored) publish({ ...stored, corners: view.corners });
    if (stored || pending) say(status);
    startSolve();
    return true;
  }
  function startSolve() {
    if (!autoSolve() || pending || !stored?.readComplete || stored.solveFinished || previewBlocker(stored.found)) return;
    const target = stored, id = generation, solveId = ++solveGeneration;
    // Only a freshly verified reading can start a solve. A result arriving
    // during movement remains queued until the grid reappears unchanged.
    if (!proof(target.sample)) return;
    target.solveFinished = true; pending = true; solving = true;
    status = "Finding a solution on this device…"; say(status);
    void (async () => {
      try {
        const result = await solve(clone(target.found.puzzle));
        if (!active || id !== generation || solveId !== solveGeneration || !autoSolve() || stored !== target) return;
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
      reset(); say("Printed content changed — reading the new clues…");
    }
    challenger = null; lostAt = null;
    if (!reference) reference = { ...frame, image: null };
    stable++;
    if (!pending && (!best || frame.sharpness >= best.sharpness)) { if (best !== frame) release(best); best = frame; }
    else if (frame !== best) release(frame);
    validate();
    if (pending || stable < 2) return;
    const elapsed = now() - lastRead, sharper = attempts > 0 && Number.isFinite(best?.sharpness) &&
      best.sharpness >= Math.max(lastSharpness * 1.3, lastSharpness + 40);
    if (sharper) { if (elapsed < 1000) return; }
    else {
      if (stored?.result?.status === "unique" || (!autoSolve() && stored?.readComplete)) return;
      if (elapsed < Math.min(24000, 3000 * 2 ** Math.max(0, attempts - 1))) return;
    }
    const id = ++generation, sample = best;
    if (!sample) return;
    best = null; pending = true; attempts = sharper ? 1 : attempts + 1;
    lastRead = now(); lastSharpness = Number.isFinite(sample.sharpness) ? sample.sharpness : 0;
    const owns = () => active && id === generation;
    status = "Reading printed clues… Keep the grid in view."; say(status);
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
        } finally { release(sample); }
        if (!owns()) return;
        clearDeadline(); checkShape(found.puzzle);
        stored = { found, result: null, corners: sample.corners, sample, readComplete: true };
        const blocker = previewBlocker(found);
        status = blocker ?? "Clues read — checking the current grid…";
        validate();
        if (blocker) return;

      } catch (error) {
        if (owns() && error?.name !== "AbortError") { status = error.message || "Could not read this frame. Try moving closer."; if (validate()) say(status); }
      } finally { if (owns()) { clearDeadline(); pending = false; validate(); } }
    })();
  }
  return {
    start() { if (active) return; active = true; reset(); },
    stop() { active = false; reset(); signature = null; lastStatus = ""; },
    invalidate() { reset(); },
    suspend: hide, motion, observe, validate,
    get preview() { return preview; },
    get busy() { return pending; },
    get anchorFrame() { return stored?.sample ?? reference; },
  };
}
