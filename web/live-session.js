import { sameFrame, previewAllowed } from "./live-overlay.js";
import { clone, checkShape } from "./model.js";

// Camera-only work owns a separate generation from the accepted editor.
// The camera keeps streaming while one OCR request and one bounded solve run.
export function createLiveSession({ read, solve, cancelRead, cancelSolve, onChange, onStatus, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false, generation = 0, pending = false, preview = null;
  let reference = null, best = null, stable = 0, attempts = 0, lastRead = -Infinity, deadline = null;
  function clearDeadline() { clearTimer(deadline); deadline = null; }
  const publish = (value) => { preview = value; onChange(value); };
  function reset() {
    generation++; clearDeadline(); pending = false; stable = 0; attempts = 0; best = null; reference = null;
    lastRead = -Infinity; cancelRead(); cancelSolve(); publish(null);
  }
  function motion(signature) {
    if (active && reference && !sameFrame(reference.signature, signature)) {
      reset(); onStatus("Hold still — aligning the grid…");
    }
  }
  function observe(frame) {
    if (!active) return;
    motion(frame.signature);
    if (reference && (reference.key !== frame.key || reference.corners.some((p, i) =>
      Math.hypot(p.x - frame.corners[i].x, p.y - frame.corners[i].y) > frame.width * .012))) reset();
    // The reference only anchors geometry and motion checks; drop its pixels.
    if (!reference) reference = { ...frame, image: null };
    stable++;
    if (!best || frame.sharpness >= best.sharpness) best = frame;
    if (preview) { preview = { ...preview, corners: frame.corners }; onChange(preview); }
    // A stable scene with a complete unique preview is finished: reading the
    // same pixels again cannot improve it, so wait for motion or new settings.
    // An unresolved scene retries with a doubling interval rather than every
    // three seconds, bounding the OCR and battery cost of an unreadable page.
    if (pending || stable < 2 || preview?.result?.status === "unique") return;
    if (now() - lastRead < Math.min(24000, 3000 * 2 ** Math.max(0, attempts - 1))) return;
    const id = ++generation, sample = best;
    best = frame; pending = true; attempts++; lastRead = now();
    const current = () => active && id === generation;
    onStatus("Reading printed clues… Keep the grid steady.");
    deadline = setTimer(() => {
      if (!current()) return;
      reset();
      onStatus("Recognition timed out. Keep the grid steady to retry, or capture for manual review.");
    }, 90000);
    void (async () => {
      try {
        let found;
        // The sampled pixels have served recognition once the read settles;
        // only the signature and geometry are needed afterwards.
        try { found = await read(sample, (message) => { if (current()) onStatus(message); }); }
        finally { sample.image = null; }
        if (!current()) return;
        clearDeadline();
        checkShape(found.puzzle);
        publish({ found, result: null, corners: reference.corners, sample });
        if (!previewAllowed(found)) {
          onStatus("Check yellow readings; red ? cells are not yet resolved. Move closer for a clearer read."); return;
        }
        onStatus("Finding a solution on this device…");
        const result = await solve(clone(found.puzzle));
        if (!current()) return;
        if (result?.status === "unique" && result.complete === true) {
          publish({ found, result, corners: preview.corners, sample });
          onStatus("Solution preview — check the clues and rules. Tap the shutter to save this picture.");
        } else {
          onStatus(result?.status === "multiple" ? "More than one solution — check the readings and puzzle type."
            : result?.status === "no-solution" ? "No solution to these readings — hold steady or move closer."
            : "Preview search paused. Keep steady to retry, or capture and use the full editor.");
        }
      } catch (error) {
        if (current() && error?.name !== "AbortError") onStatus(error.message || "Could not read this frame. Try moving closer.");
      } finally { if (current()) { clearDeadline(); pending = false; } }
    })();
  }
  return {
    start() { active = true; reset(); },
    stop() { active = false; reset(); },
    invalidate() { reset(); },
    motion, observe,
    get preview() { return preview; },
    get busy() { return pending; },
  };
}
