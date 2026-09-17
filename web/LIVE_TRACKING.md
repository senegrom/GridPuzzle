# Handheld live scanning: identity, motion and OCR ownership

The old loop discarded a pending read on a changed **whole-frame** thumbnail or
one failed fixed-coordinate content comparison. This made a small hand movement
or an animated timer repeatedly cancel useful recognition. Unknown answer slots
were also rendered as red question marks before any reading existed.

The camera now registers bounded local image patches across the detected grid.
A robust projective fit accounts for small translations, rotation and scale;
only then is the original per-region content guard applied. The content guard
has not been weakened: labels, inequality signs, cage edges and both ink
polarities still participate. An additional interior residual check rejects
small changed digit strokes (including an 8 becoming 3) that previously passed
the interior area-only guard. Content sampling uses up to 1280 pixels rather
than 640; detection retains its 640-pixel budget. Registration is not identity:
a fitted rectangle alone never authorizes an overlay or captured metadata.

Each read stays anchored to its captured pixels. Verification compares to that
anchor, never a chain of drifting successor frames. Background pixels/timers
are not the authority for identifying the puzzle. There are at most 25 patch
features, an 8-pixel local search, bounded deterministic robust fitting and
one current-frame verification cache. A cache is cleared on every camera tick.

OCR ownership is separate from display permission. Brief tracking loss hides
all entries and captured clue metadata without cancelling the read. Its result
can finish off-screen and is queued; solving starts only after the exact sample
is verified again. A late solver result remains hidden until reverified too.
Two mutually matching fresh detections of changed content retire the old job;
settings changes and Stop do so immediately. Five seconds of unverified loss
retires retained work, and the original 90-second OCR timeout is preserved.
Only one OCR job/solve is active. Temporary captured-frame canvases are released
on success, failure, outdated detection, replacement and Stop.

Before the first reading, the camera shows an outline, not 81 red boxes. Blank
answer slots remain unobscured. Red question marks are reserved for observed
printed marks that are unreadable; solver output cannot hide them. Capturing
uses exactly the displayed raw frame and its verified geometry, and never
accepts the clues or rules for the user.

## Tests

`web/tests/live-registration.test.js` covers small translations/rotation,
background changes and rejection of changed digits, erasure, fingers, weak
labels and boundary marks. `live-retention.test.js` covers pending/completed
OCR, provisional results, changed-board ownership, bounded loss and shutdown.
`live-interior-change.test.js` covers small stroke changes in both polarities.
Existing content, low-contrast, lifecycle and confidence tests stay in place.

`node scripts/live_motion_regressions.cjs` drives a real canvas MediaStream
through production detection, camera/session logic and Tesseract, with
continual jitter and an animated background. It uses the 22-clue pattern from
the reported screen failure, rendered independently; the user's photograph is
NOT committed. It delays real OCR to expose cancellation starvation, waits for
completed rather than provisional readings, tests covering/uncovering the grid
and changing one clue, and checks captured metadata. Out-of-grid pixel witnesses
prove scene changes reached the displayed video frame. A pending cancellable
solver stub isolates retention from normal repeated-search backoff in this
scanning suite; `live_camera_regressions.cjs` separately covers the real solver.

`python scripts/fetch_live_fixtures.py` retrieves 12 hash-selected records from
the **test** split of Lexski/sudoku-image-recognition at revision 733559b. It
fails on revision changes, missing data and oversized files. The selection is
made before running the scanner, not by retaining only pictures it can read.
The live-motion report measures static/self and translated-anchor tracking on
all twelve images. These known-corner checks measure tracking coverage, not
end-to-end detection or digit accuracy. Images remain untracked; reports retain
source revision, selection, file hashes and every success/failure.

## Additional document-video libraries

`corpus/motion_tracks.py` imports local SmartDoc 2015 `metadata.csv[.gz]` or
MIDV-500 `ground_truth` JSON directories into a common `clips/frames/corners`
manifest. It validates ordering/finite/convex quads and rejects empty or wrong
inputs. It copies only coordinates/frame references, not personal fields or
portraits. Full archives are **not** downloaded by routine CI. These importers
are tooling support, not a claim of having benchmarked those entire datasets.

```sh
python corpus/motion_tracks.py smartdoc /path/frames/metadata.csv.gz /tmp/smartdoc-tracks.json
python corpus/motion_tracks.py midv /path/document/ground_truth /tmp/midv-tracks.json
```

Sources and attribution:
- Lexski (CC0): https://huggingface.co/datasets/Lexski/sudoku-image-recognition
- SmartDoc (CC BY 4.0): https://github.com/jchazalon/smartdoc15-ch1-dataset
  Burie et al., *ICDAR2015 Competition on Smartphone Document Capture and OCR*.
- MIDV-500: Arlazarov et al., https://arxiv.org/abs/1807.05786. Refer to the
  downloaded dataset's individual source-image licenses for image reuse.

## Limits

Tracking/content checks can conservatively reject a blurred/aliased frame;
this hides overlays rather than inventing confidence. Large motion is handled
by redetection, not unbounded registration. A photograph replayed with controlled
motion is not a physical iPhone video test. Report registration coverage,
retention, time to first reading, cancellations and false stale displays
separately from static digit accuracy. No neural network or solver-derived
recognition is enabled by this change. Physical-device speed/memory remains a
separate validation task; there is no claim that the higher-detail checks are a
speedup.
