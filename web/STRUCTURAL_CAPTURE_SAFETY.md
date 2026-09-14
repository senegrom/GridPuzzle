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

## Anchored normalisation and real photographs

The comparison above was measured on real photographs for the first time on
September 14, 2026, and it failed: a quarter-pixel shift, sensor-like noise or a
six percent brightness change read as changed printed content on five of six
corpus photographs, and a jittered stream of a newspaper photograph reset the
live view twelve times in twenty-five seconds without ever reaching a solution.
The cause was not texture but the per-region normalisation: each frame chose its
own polarity and paper level from single percentiles, so a blank strip of grey
paper could flip between "dark ink" and "light ink", or its anchor could jump by
twenty levels, and the whole region then looked changed.

Signatures now hold raw area averages. When two signatures are compared, the
polarity and the contrast stretch come from the reference region and apply to
both, so they cannot flip between two views of the same print; only the paper
(or black) level follows each frame, from the mean of a histogram band rather
than a single percentile, which absorbs a uniform illumination change. Light ink
on a dark ground is assumed only when the bright band clearly dominates. The
high-contrast test still tries every small shift strictly; when all fail, the
best raw registration alone is forgiven a tenth of the local contrast, because a
grid line thinner than the sample spacing cannot be interpolated to a fractional
shift. A shift chosen merely to hide a change gets no allowance, which is what
keeps a small changed cage label visible.

The permanent camera gate now includes the two in-repository newspaper
photographs as camera frames: a quarter- and half-pixel shift, noise of four
levels, both together, and a six percent brightness change must read as the same
print, while an erased clue, a changed grey sign (also under shift and noise) and
an added cage wall must read as changed. Measured limits: paper photographs are
robust to shifts of half a pixel at the 720-pixel working size with noise and
illumination change; at a full pixel one region in five can still trip, and the
whole-frame motion check retires the answer for larger movement anyway.
Photographs of screens (moiré) are not covered. These remain sampled,
heuristic comparisons; physical-phone testing is still required.
