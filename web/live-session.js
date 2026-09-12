import { sameFrame, previewAllowed } from "./live-overlay.js";
import { clone, checkShape } from "./model.js";

// Camera-only work owns a separate generation from the accepted editor.
// The camera keeps streaming while one OCR request and one bounded solve run.
export function createLiveSession({ read, solve, cancelRead, cancelSolve, onChange, onStatus, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false, generation = 0, pending = false, preview = null;
  let reference = null, best = null, stable = 0, attempts = 0, lastRead = -Infinity, lastSharpness = 0, deadline = null;
  function clearDeadline() { clearTimer(deadline); deadline = null; }
  const publish = (value) => { preview = value; onChange(value); };
  function reset() {
    generation++; clearDeadline(); pending = false; stable = 0; attempts = 0; best = null; reference = null;
    lastRead = -Infinity; lastSharpness = 0; cancelRead(); cancelSolve(); publish(null);
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
    // A pending read owns its sample. Do not retain other old images that can
    // out-rank the fresh frame after its pixels have been released.
    if (!pending && (!best || frame.sharpness >= best.sharpness)) best = frame;
    if (preview) { preview = { ...preview, corners: frame.corners }; onChange(preview); }
    // Keep the battery-saving backoff for unchanged images, but autofocus can
    // deliver genuinely better evidence without moving the grid. Let a large
    // sharpness improvement retry promptly, including a provisional solution.
    // A small absolute/relative change must not turn focus noise into a loop.
    if (pending || stable < 2) return;
    const elapsed = now() - lastRead,
      sharper = attempts > 0 && Number.isFinite(best.sharpness) &&
        best.sharpness >= Math.max(lastSharpness * 1.3, lastSharpness + 40);
    if (sharper) {
      if (elapsed < 1000) return;
    } else {
      if (preview?.result?.status === "unique") return;
      if (elapsed < Math.min(24000, 3000 * 2 ** Math.max(0, attempts - 1))) return;
    }
    const id = ++generation, sample = best;
    // Never keep the sampled object in the candidate slot: finally releases
    // its image, and a less-sharp next frame still needs real pixels to read.
    best = null; pending = true; attempts = sharper ? 1 : attempts + 1;
    lastRead = now(); lastSharpness = Number.isFinite(sample.sharpness) ? sample.sharpness : 0;
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
