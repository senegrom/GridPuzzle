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

`live_recovery_regressions.cjs` supplies a real canvas MediaStream to the
production camera, detector, tracking worker and Tesseract; one printed cell is
resampled to simulate lost optical detail and the next phase restores the
original raster. No OCR values, confidence, uncertainty, quality scores, corners
or identity proofs enter the pipeline; reference values only score the output.
A real targeted reply can be delayed to test a changed puzzle, and paused
playback tests the freshness heartbeat. Raw before/after values, flags, calls
and scheduling statistics are kept in `live-recovery.json`. These fixed cases
are regression controls, not a representative corpus or an accuracy gain.

`live_soak_regressions.cjs` runs twenty camera sessions per browser with
resolution changes and delayed replies from the real tracking worker, with
controlled video clocks and OCR so that only resource ownership is measured:
worker counts, owned timers and source/scratch buffers must return to zero
after each Stop. It is not a heap or device benchmark.

`external_replay_regressions.cjs` replays the first three entries of the
hash-selected Lexski test slice through automatic detection, tracking and real
OCR; reference corners and values never reach the recognition path. Its report
keeps no-read and quality rejections, errors, natural uncertainty and
cell-level scores, and treats ambiguous pencil marks separately from printed
givens. It records coverage; it is not a gate and not a promise that external
images pass OCR.

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

## Background tracking and targeted retries

The live camera sends transferable pixels to `live-tracking-worker.js`. Feature
extraction, registration and content verification do not run on the interface
thread. There is one active operation, one replaceable latest video frame and
one pending detector-anchor request. Up to eight worker-owned anchors are
retained, with current reading/reference anchors protected from eviction. The
worker keeps grayscale evidence, not extra RGBA source copies. Stop, settings
changes and errors terminate the worker and fence its replies. A two-second
worker deadline fails closed; manual capture remains available without a
synchronous registration fallback.

A verification result is drawn only with its own source snapshot, never with a
newer video frame. Verified views come in two tiers. A snapshot up to 500
milliseconds old is live. One older than that, up to the worker's two-second
deadline, is still drawn — marked DELAYED in the preview bar, in the canvas's
`data-delayed` attribute and in its accessible label — so a device whose
tracking takes a second per frame gets a lagging overlay rather than none;
reads and solves still run on it, since every frame is verified individually.
Beyond two seconds the camera shows an unverified fresh frame, and a worker
that never answers reaches the failure, backoff and Restart path. Neither tier
is a measured phone speedup or a promise that image copying and rendering are
off-thread.

After a complete numeric reading, a substantially clearer cell interior can
trigger a targeted retry through `Scanner.readCells`. At most 12 uncertain,
marked numeric cells are sent to OCR, twice per cell at most, with a 1.5-second
minimum interval. Identical quality does not retrigger work; identical encoded
crops can skip OCR, and repeated evidence cannot vote. Warp/preparation still
runs for the complete grid so the crop geometry is consistent, but the atlas
and independent numeric samples contain only selected cells. Structural cage
and Kakuro targets retain the full-read/manual-review path.

The original reading anchor is never replaced by a chain of retries. A retry
must match the same rules and original content, and both original and retry
samples must be reverified before its results can apply. Confident or explicitly
confirmed clues are not replaced; absent marks cannot delete earlier clues.
Changed proposals remain uncertain and require review. Solver answers do not
participate. These controls do not constitute an accuracy gain on unseen photos.

A failed or timed-out targeted read retires only its own request; the preceding
full reading and its source stay available, but only current identity
verification can authorize their display, and a late reply cannot restore a
retired scene or replace a newer retry. Each cell has two automatic attempts.
A request reserves an attempt before it starts; an explicit identical-crop
skip or a zero-OCR result refunds it, an error or timeout consumes it. The
1.5-second interval and the clarity threshold keep unchanged evidence from
looping. Once every remaining cell is exhausted, the status line and the
diagnostics ask for manual review instead of promising another retry.

`live_features_regressions.cjs` tests the real worker, transfer/queue behaviour,
selected-cell Tesseract calls, identical-crop skipping and diagnostic download
privacy in Chromium and WebKit. The moving-video and real-solver integration
suites still run separately. Unit tests additionally cover stopped workers,
late results, failures, changed sources and manually protected cells.

## Frame scheduling and paint work

`live-frame-scheduler.js` follows newly presented video through one-shot
`requestVideoFrameCallback` calls where the browser has them; presentation
counts tell a genuinely new frame from a repeated one, including live streams
whose media timestamp is zero. Without native callbacks it falls back to
decoded-frame counts, then to an advancing media clock. A native callback that
has gone silent is abandoned only after a second without one and two
independent advances of the playback counters, with dropped frames subtracted;
a timer or the media clock alone cannot authorize the switch, and callbacks
from before the switch are fenced. Repeated starts and shutdown fence every
old callback.

Expensive snapshots run at most every 100 ms, back off to 250 ms once a
reading is settled and up to 300 ms when recent worker timing calls for it;
the latest-frame queue stays bounded. A separate 100 ms heartbeat expires the
overlay when presentation or accepted tracking evidence is over 500 ms old
even if no video callback arrives, so a detector reply can never sample a
stalled video into fresh evidence. Every heartbeat still validates freshness
and the current solver preferences, but a paint is issued only when the raw
image, geometry, reading or solution has changed; a new frame, a changed
proposal, a solution toggle or an expired proof invalidates that cache at
once. Captures copy the exact displayed image synchronously, never a later
frame. The preview solver is warmed once per camera session, and only while
automatic solving is enabled. These are processing intervals, not sensor
frame rates or a measured phone speedup.

## Worker failure, backoff and restart

A tracking failure backs off for two seconds, then four; the third consecutive
failure stops automatic tracking and the camera offers **Restart live
scanning** (`tracking-recovery.js`). One successful message does not clear the
streak; two seconds of sustained verified work does. Restart retires the prior
work, fences its replies and starts the callbacks and the worker again. Manual
capture stays available throughout, and stale evidence stays hidden. Stop
releases the scratch canvases and any pending read samples as well as the
timers and workers.

## Re-reading one clue: ownership

The editor's per-clue re-read (described from the user's side in
`LIVE_SCANNING.md`) is a numeric-only `Scanner.readCells` call on the retained
rectified photograph. Identical source pixels reuse a cached proposal, up to
eight per source, for crops of at most 65,536 pixels; new pixels cause a new
read. A proposal is owned by the generation, image, cell, source and photo
signature that requested it and by an open dialog with an unchanged draft:
closing or reopening the editor, changing the source or puzzle, or editing the
field discards a late result. A 90-second deadline retains the unchanged draft.
The cache never promotes confidence, and nothing is inferred from a solution.

## Diagnostic timings

`scan-metrics.js` keeps bounded numeric windows of the latest 128 samples per
measurement: painting, frame age, tracking latency, queue work and the time to
the first completed reading. P50 and P95 describe the window; means, maxima and
counts describe the session. Render requests are counted separately from
actual paints, and repeated updates of one frame do not double-count its
tracking measurement. The export carries numbers only, never images or free
text. They are app timings, not sensor frame rates or battery estimates.

## Noise units and acquisition diagnostics

The interior comparison stretches contrast against its original anchor. Its
four-level sensor-noise floor is now scaled into the same units as those
stretched samples, instead of amplifying ordinary paper fluctuations into
changed-content evidence. High-contrast guards and unstretched structural
regions retain their existing bounds. A registered rectangle alone still never
proves identity, and no solver result supplies missing clue pixels.

The tracking worker returns bounded rejection reasons (cell, structural region,
geometry or missing anchor), with numeric region indices only, never image bytes.
Repeated rejected candidates surface an explicit alignment message and Restart;
Save picture retains the independent single-photo crop/read route. These reasons
help distinguish pre-OCR acquisition failure from OCR, rendering or worker delay.

`live_noise_regressions.cjs` runs automatic type/grid detection, the real tracking
worker and Tesseract on a continually re-noised grey/blue synthetic board, then
covers it and changes a digit. Labels score output only. No user photograph is
committed. This is a bounded failure regression, not proof that every noisy or
blurred phone capture will match; diagnostics without imagery cannot establish
an exact visual cause.

Successful worker recovery uses the supported two-second verification cadence:
at least three distinct successes spanning two seconds clear earlier failures.
Sparse or repeated timestamps do not; three consecutive failures still require
an explicit restart. Display ownership and the 500ms live/two-second delayed
snapshot limits are unchanged.

After capturing or handing a capture to the clue editor, diagnostic source
ownership changes explicitly. Stage history and readings remain, but previous
image inclusion consent is cleared. A newly previewed opt-in can include the
retained photo; closing the camera/capture cannot fall back to an unrelated photo.
