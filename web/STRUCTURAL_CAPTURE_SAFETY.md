# Structural changes and cross-tab picture ownership

Live content tracking compares observed pixels, not OCR output or a solver's
answers. Besides each cell interior, signatures include overlapping small
label regions and full strips along shared cell boundaries. These cover cage
labels and walls and Futoshiki signs that the interior-only signature omitted.
Each region must match independently. Structural strips retain measured ink
contrast instead of stretching thin grid lines to black; a smaller change
budget preserves small constraints without turning registration jitter into
constant rereading. The ordinary digit comparison and OCR confidence floors
are unchanged.

A mismatch uses the existing live-session invalidation path: cancel pending
recognition/search, discard provisional answers and metadata, and read the new
scene. Capturing revalidates against the displayed raw frame. Small lighting
and registration changes still retain unchanged-scene backoff.

## Pictures shared by multiple tabs

Every save or delete requests an origin-wide Web Lock before any asynchronous
work. Under that short lock, an IndexedDB transaction writes a fresh ownership
token; a delete also removes the picture atomically. PNG encoding/conversion
runs outside the lock and outside transactions. A save's final readwrite
transaction checks the durable token before writing the picture. Older work
cannot resurrect a deleted picture or overwrite a newer one, even when its
byte conversion or database opening finishes late. Ownership does not depend
on timestamps or synchronized clocks.

The default gallery reserves ownership at the shutter call, before
`canvas.toBlob`, not only when the resulting Blob becomes available. Queue and
database waits are bounded. If cross-context coordination is unavailable,
persistent mutations fail explicitly; scanning and PNG download remain
available, and an earlier saved picture is not silently removed.

Database version 2 preserves the existing store and both old picture formats.
It also prevents still-open version-1 app code from reopening the database and
writing without the new ownership checks. Such an old app needs reloading
before it can save or delete again.

## Regression coverage

`node --test web/tests/*.test.js` includes transaction rollback, byte-storage
round trips, original same-context ordering checks and coordination failures.
The existing `node scripts/live_camera_regressions.cjs` browser gate also runs
`structural_capture_regressions.cjs` in Chromium and WebKit. It uses real canvas
pixels and the production live camera, with controlled recognition/search
completions, and two actual tabs sharing IndexedDB and Web Locks. Checks cover
horizontal/vertical inequality flips and erasures, cage labels and walls,
lighting/jitter controls, pending and solved overlays, capture metadata,
delayed encoding/conversion/database opening, reload after deletion, and newer
captures with identical timestamps.

These are bounded regressions, not a guarantee that arbitrary tiny, blurred or
occluded marks are distinguishable. Physical-camera testing remains important;
results stay provisional and the user must review recognized clues and rules.

## Lower-contrast structural changes

The structural comparison now retains its original high-contrast test and adds
an unblurred low-contrast residual check. A delta below 64 is no longer automatic
agreement. The added check allows two intensity levels of noise, bounded relative
illumination change and a fraction of the local edge contrast for sub-sample
registration jitter. Its decision uses the best raw registration; it cannot pick
a different shift merely to hide weak ink behind a strong grid line. Identical
and near-noise regions skip the extra work.

The permanent Chromium/WebKit gate exercises grey horizontal and vertical sign
flips and erasures at RGB levels 150, 205 and 210 during reading, solving and
solved display. Old answers, pending completions and captured metadata must be
retired, with a fresh read afterwards. Identical images, modest illumination and
one-pixel registration changes remain controls. Recognition/solver completions
are controlled; these are real-pixel state-safety tests, not an OCR accuracy
benchmark or a physical-phone guarantee. Comparison remains heuristic below the
noise/registration bounds and for very small marks.
