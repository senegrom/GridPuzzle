# Live camera

The live camera reads a printed puzzle held in front of the phone and draws the
recognised clues onto the same view, with a solution preview when the
transcription has exactly one solution. This document covers what it shows and
saves, how a handheld grid keeps its identity, what tracking costs, how changed
print is noticed, how the camera recovers, and how all of it is tested.

Every test named here uses simulated camera streams, controlled completions or
retained photographs. None is a physical-phone test: autofocus, exposure,
motion, installed-app behaviour, speed, memory and battery on real hardware
remain separate validation work, and no timing here is a measured phone
speed-up.

## What the camera shows

Open **Scan with camera** and hold the whole grid steady. The camera stays open
while recognition and the local Python solver work in the background; the
preview needs no second board or confirmation dialog. **Read stable camera
frames automatically** can pause recognition; it never presses the shutter.

Green numbers are recognised printed values, yellow numbers with a question
mark are uncertain readings, and a red `?` is an unresolved cell, including a
printed mark OCR could not read. Blue numbers, and blue Slitherlink edges, are
entries from a completed, unique solution to the current transcription. Blank
black cells are not answer slots, and a retained unread printed mark is never
painted over in blue. Before the first reading the camera shows only the
grid's outline, not a red box per cell: red question marks are reserved for
observed marks that are unreadable, and solver output cannot hide them.
Recognition can still fail when the photograph holds too little visible
evidence; the colours do not guarantee a correct transcription.

Live solutions are **previews**, not confirmation that the photograph or the
inferred rules are right. Conflicting readings, incomplete structural data,
unread printed digits and nonunique results produce no blue answers; readings
flagged for review can take part in a labelled preview but stay yellow.
**Review captured clues** carries the inferred family and box settings and
every OCR warning into the editor, where Solve, Check and Hint still need the
usual confirmation. If the detected grid contradicts the selected rules (a
9 × 6 board while Sudoku is selected, a 12 × 12 Str8ts), the outline is shown
with the reason and no cell overlay is attempted until the type or the grid
settings change.

The camera waits for stable detections and reads the sharper sampled frame.
One recognition job and one preview solve run at a time, and a sampled frame is
released as soon as recognition has used it. Recognition has a 90-second
deadline, after which the camera can retry; the preview solver has a 90-second
runtime-loading deadline and an 8-second search budget, while the full editor
keeps its longer configurable budgets. Detection, recognition, tracking and
solving run in workers. Closing the camera, backgrounding the page, changing
settings or losing the stream cancels the matching work, and frames that are
never explicitly captured are never stored.

### Warm workers

The page runs one Python interpreter. With automatic solving on, opening the
camera hands the page's idle or warming interpreter to the previews (otherwise
the previews load their own when the camera opens), and closing the camera
hands it back unless a preview search is running, which only termination can
stop. Solve after live scanning therefore starts without downloading and
starting Python again. Without automatic solving the camera takes no
interpreter, and the page's is released while the camera is open. The preview
runtime is warmed once per camera session and reloaded in the background after
a search budget had to terminate it. Realignment cancels an active search but
keeps an idle or warming worker; the first frame and settings changes do not
discard it. Warm-up failures and timeouts are retired, so later requests retry
without inheriting a broken worker.

Starting a Tesseract worker and loading its language data costs more than a
whole read on a phone, and the camera reads a scene several times, so each
Scanner keeps one OCR host and one geometry worker alive across reads. The
camera warms the OCR engine together with the preview solver when it opens.
Realignment cancels a pending read cooperatively, between recognition calls,
and keeps the engine (a stuck atomic call is replaced after two seconds);
closing the camera releases everything. Fresh pixel buffers are transferred
between workers rather than copied. The atlas pass finishes long before the
independent per-digit checks, so its readings are offered as a provisional,
fully review-flagged (yellow) preview that never starts a solve; only the
checked transcription does. A small in-memory cache reuses isolated readings
only for byte-identical crops read in the identical segmentation mode, never
for approximate matches, cell indices or solver answers; it holds at most 256
entries or two megabytes of keys and is cleared with the engine.

### Faint and dim printed marks

A low-resolution white digit on a black cell can be too dim for the fixed
white-pixel threshold: when that first mark detector finds no glyph, a bounded
local-contrast fallback looks for a substantial connected central mark.
Likewise, when the normal foreground threshold misses a white-cell digit, a
bounded local-contrast pass can keep it despite dark grid lines elsewhere in the
image. Flat black cells, empty cells, shallow texture, noise, gradients and
shading are excluded, with negative regression controls. Recovered glyphs stay
flagged even when the readers agree; plausible central ink without a usable
numeric component is carried as unread evidence rather than as a blank answer
slot; preprocessing never infers a numeric value.

The atlas, binary and grayscale readers are unchanged. When the two individual
readers disagree or miss a numeric crop, up to 24 crops per scan get one
raw-line (Tesseract PSM 13) retry; agreement already obtained on clean crops is
not disturbed, and large boards keep the existing grayscale budget. Retry
evidence votes only on the complete observed number, and rescued or changed
proposals stay flagged. No solved values, fixture answers or guessed
substitutions enter recognition. This is a bounded fallback, not a guarantee
for arbitrary photographs or handwriting.

## Shutter and saved pictures

**Save picture** freezes and stores the exact annotated camera frame on screen,
including the colour legend and PREVIEW label. It is not a fresh, differently
positioned frame: capture revalidates against the displayed raw frame and its
verified geometry, the coloured overlay is never fed back into OCR, and capture
never accepts the clues or rules for the user. The camera stops and the picture
stays on the same screen, also when the page is hidden meanwhile (an app
switch, the lock screen, a download prompt): only a live camera is released on
hide, and a captured still holds no camera. Escape closes the camera panel like
a dialog and returns focus to the Scan button.

The latest captured PNG is saved as exact bytes in this browser's IndexedDB,
also on WebKit backends that cannot store Blob objects, and appears under
**Last saved picture** after reload. **Download PNG** exports a separate copy;
**Delete saved picture** removes the browser copy. Web apps do not silently add
pictures to the system Photos library. Private mode, storage quotas and browser
eviction may prevent persistence; failures are shown and the in-memory picture
stays downloadable, so download important pictures separately. The shutter is
the only exception to the photo policy: imported photographs and uncaptured
live frames are neither persisted nor uploaded, and only one captured PNG is
kept, with no hidden camera history.

Saves and deletes take ownership when requested, before byte conversion or
database opening finishes, and a new capture replaces the previous one only
after its transaction succeeds. Every save or delete first requests an
origin-wide Web Lock. Under that short lock an IndexedDB transaction writes a
fresh ownership token, and a delete also removes the picture atomically; PNG
encoding and conversion run outside the lock and outside transactions, and a
save's final readwrite transaction checks the durable token before writing.
Older work, in this tab or another, therefore cannot resurrect a deleted
picture or overwrite a newer one, even when its conversion or database opening
finishes late, and ownership does not depend on timestamps or synchronized
clocks. The gallery reserves ownership at the shutter call, before
`canvas.toBlob`. Queue and database waits are bounded. Without cross-context
coordination, persistent mutations fail explicitly; scanning and PNG download
stay available, and an earlier saved picture is not silently removed. Messages
stay tied to their request, and a failed write keeps the existing saved image.

Database version 2 keeps the existing store and both old picture formats, and
stops still-open version-1 app code from reopening the database and writing
without the ownership checks; such an old app must reload before it can save
or delete again.

## Tracking a handheld grid

### Identity through motion

The camera registers bounded local image patches across the detected grid: at
most 25 patch features, an 8-pixel local search around where the anchor last
matched, and bounded deterministic robust fitting of a projective transform for
small translations, rotation and scale. Only then are the content checks below
applied. Registration is not identity: a fitted rectangle alone never
authorizes an overlay or captured metadata. Content sampling uses up to 1280
pixels; detection keeps its 640-pixel budget.

Each read stays anchored to its captured pixels, and verification compares with
that anchor, never with a chain of drifting successor frames; background pixels
and timers are not the authority for identifying the puzzle. One current-frame
verification cache is cleared on every camera tick. The fitted corners must
stay within 16 pixels of where the anchor last matched, so a grid that jumps
further cannot be found by verification alone. The next detection finds it:
when an anchor operation matches a retained anchor at the new detection, it
records where, and the following verifications search there, so the reading
re-locks instead of being lost after five seconds and read again.

OCR ownership is separate from display permission. Brief tracking loss hides
every entry and captured clue metadata without cancelling the read: its result
can finish off-screen and is queued, solving starts only after the exact sample
verifies again, and a late solver result stays hidden until reverified too.
Two mutually matching fresh detections of changed content retire the old job;
settings changes and Stop do so at once. Five seconds of unverified loss retire
retained work, and the 90-second OCR timeout still applies. Time while the
worker builds an anchor does not count towards those five seconds, since no
verification can arrive meanwhile; before, an anchor of about seven seconds or
more reset the reference each time, so reading never started and the help line
repeated "Grid lost". Temporary captured-frame canvases are released on
success, failure, outdated detection, replacement and Stop.

### Background tracking and its cost

The live camera sends transferable pixels to `live-tracking-worker.js`, so
feature extraction, registration and content verification do not run on the
interface thread. There is one active operation, one replaceable latest video
frame and one pending detector-anchor request. Up to eight worker-owned anchors
are retained, with the current reading and reference anchors protected from
eviction, and the worker keeps grayscale evidence, not extra RGBA source copies.
Stop, settings changes and errors terminate the worker and fence its replies.
Each operation fails closed after its own deadline: two seconds for a
verification, twenty for an anchor. With one shared two-second deadline, every
anchor on a device whose verifications approach two seconds failed and ended in
Restart.

Verification cost grows with the anchors it checks, since each one is a
registration and a full content comparison. An anchor operation re-matches
every retained anchor, so the reference, the best frame and a challenger are
compared with each new detection there. A verification checks only the anchors
whose proofs are read: the reading's own anchor, the frame being read, a
pending candidate, and the guide while no preview is shown. A settled reading
therefore verifies one anchor per frame where it used to verify three or four.
Each operation computes the frame's grayscale and integral image once for all
its anchors. On six noisy real photographs in desktop Chromium at 960 and 1280
pixels (2026-09-24), a verification of one anchor takes 51-66 ms (63-79 ms
before these changes), and of three anchors 140-177 ms (194-244 ms). An anchor
with three retained anchors costs 1.1 to 1.2 times a verification of the same
three, and 19-27 ms to build alone. Earlier ratios of ten times (a synthetic
9x9 board) and 67-131 times (photographs) compared against verifying an
unchanged frame, which returns before registration and the content comparison.
Verifications wait while an anchor is built, and grid detection's own
eight-second deadline no longer covers anchoring. Manual capture remains
available without a synchronous registration fallback.

### Live and delayed views

A verification result is drawn only with its own source snapshot, never with a
newer video frame. Verified views come in two tiers. A view is live while the
snapshot on screen is at most 500 milliseconds old. Once one is older, the view
is still drawn — marked DELAYED in the preview bar, in the canvas's
`data-delayed` attribute and in its accessible label — so a device whose
tracking takes a second per frame gets a lagging overlay rather than none. It
returns to live only after snapshots have stayed within 500 milliseconds for
two seconds: with replies of 300-400 ms, or pauses while an anchor is built,
the age crosses 500 ms on every reply and the label would otherwise flip with
it. A reply is adopted while its own snapshot is at most two seconds old and
newer than the last adopted one, also after the display has fallen back to an
unverified frame; its snapshot replaces that frame. A new detection waits
until the pending candidate has been verified or rejected, so with slow replies
each candidate is verified before the next replaces it, and reads and solves
run on the delayed tier. A shown snapshot older than two seconds gives way to
an unverified fresh frame: from about a second per verification the overlay
alternates with such frames, and near two seconds it is rarely shown. The help
line does not follow that alternation: it announces "Aligning the grid" only
once the view has stayed unverified for two seconds, because verified replies
can arrive that far apart; announcing every gap alternated it with the status
six to eight times every five seconds. A worker that never answers reaches the
failure, backoff and Restart path (see Recovery). Neither tier promises that
image copying and rendering are off-thread.

### Detection pacing

Grid detection starts every 300 ms, counted from the start of the previous
detection, while the grid is being acquired or re-found. Once a reading is
shown, or is running or finished while its own frame still verifies (the last
reply covering it, within four seconds, verified it rather than rejecting it),
a new detection only offers a sharper frame, clues to retry or a changed grid,
which the verification's content check notices as well. It then waits at least
a second after the previous candidate's verdict, and, when the last anchor took
more than 250 ms, three times that anchor's time plus the two-second settle:
the worker verifies nothing while it builds an anchor, and such an anchor ages
the view onto the delayed tier. Re-detecting every second from its start kept
the view DELAYED whenever anchors took half a second or more: with 30 ms
verifications and anchors of 0.5-2 s, the fake-clock simulation of the real
camera, tracker and tracking core showed the preview live 0% of the time, and
now 73-80%.

### Frame scheduling and painting

`live-frame-scheduler.js` follows newly presented video through one-shot
`requestVideoFrameCallback` calls where the browser has them; presentation
counts tell a genuinely new frame from a repeated one, including live streams
whose media timestamp is zero. Without native callbacks it falls back to
decoded-frame counts, then to an advancing media clock. A native callback that
has gone silent is abandoned only after a second without one and two
independent advances of the playback counters, with dropped frames subtracted;
a timer or the media clock alone cannot authorize the switch, and callbacks
from before the switch are fenced. Repeated starts and shutdown fence every old
callback.

Expensive snapshots run at most every 100 ms, back off to 250 ms once a reading
is settled and up to 300 ms when recent worker timing calls for it; the
latest-frame queue stays bounded. A separate 100 ms heartbeat expires the
overlay when presentation is over 500 ms old, or the accepted tracking evidence
is older than the two-second limit above, even if no video callback arrives, so
a detector reply can never sample a stalled video into fresh evidence. Every
heartbeat still validates freshness and the current solver preferences, but a
paint is issued only when the raw image, geometry, reading or solution has
changed; a new frame, a changed proposal, a solution toggle or an expired proof
invalidates that cache at once. Captures copy the exact displayed image
synchronously, never a later frame. These are processing intervals, not sensor
frame rates.

## Noticing changed print

No whole-frame thumbnail or motion fingerprint certifies clues; the camera
keeps none. The content comparison works on observed pixels from a
bounded-resolution copy of the frame, never on OCR output or solver answers.
Each cell has an area-sampled 24-by-24 signature of raw averages, including
white-on-black marks, and overlapping small label regions and full strips along
shared cell boundaries cover cage labels, walls and Futoshiki signs. Every
region must match independently. Structural strips keep their measured ink
contrast instead of stretching thin grid lines to black, and a smaller change
budget preserves small constraints without turning registration jitter into
constant rereading. Labels, inequality signs, cage edges and both ink
polarities all take part; unchanged solved scenes keep their battery-saving
backoff.

When two signatures are compared, the polarity and the contrast stretch come
from the reference region and apply to both, so they cannot flip between two
views of the same print; only the paper (or black) level follows each frame,
from the mean of a histogram band rather than a single percentile, which
absorbs a uniform illumination change. Light ink on a dark ground is assumed
only when the bright band clearly dominates. This anchoring replaced per-frame
normalisation after the comparison was first measured on real photographs, on
14 September 2026, and failed: each frame had chosen its own polarity and paper
level, so a blank strip of grey paper could flip between dark and light ink,
and a quarter-pixel shift, sensor-like noise or a six percent brightness change
read as changed print on five of six corpus photographs; a jittered newspaper
stream reset the live view twelve times in twenty-five seconds. Synthetic
boards alone cannot stand in for halftone paper.

Each region passes two tests. The high-contrast test counts samples that differ
by more than 64 levels at the best of the small shifts; when every shift fails,
the best raw registration alone is forgiven a tenth of the local contrast,
because a grid line thinner than the sample spacing cannot be interpolated to a
fractional shift, while a shift chosen merely to hide a change gets no
allowance, which keeps a small changed cage label visible. The low-contrast
residual test runs unblurred at the best raw registration only, so it cannot
pick another shift to hide weak ink behind a strong grid line; it allows sensor
noise, a bounded relative illumination change and a fraction of the local edge
contrast for sub-sample jitter, then requires even weak residual strokes to
agree. Identical and near-noise regions skip that work. It catches an 8
becoming a 3, or a 3 becoming an 8, down to print contrast 15 on a clean print,
and light strokes on a dark ground from about 45.

The residual test's noise floor is measured: 1.5 times the frame-to-frame noise
of the two regions compared (their median absolute difference at the chosen
registration, as a standard deviation), in the region's own units and never
below four levels, for the stretched cell interiors and the unstretched
structural strips alike. A clean print keeps the four-level floor; a grainy one
gets a floor that grows with its grain, so grain is not taken for a changed
clue, label, sign or wall. A fixed four-level floor in stretched units had
turned ordinary paper grain into changed content and blocked acquisition before
OCR started, and scaling it by the stretch (#73) raised it for every faint clean
print, missing an 8 becoming a 3 up to print contrast 80 and a 3 becoming an 8
up to 130. On synthetic 40-pixel cells, grain of ±4 to ±10 levels now produces
no false changes (#73: 7-17% at ±8 and ±10), a whole 9x9 board with ±8 grain at
30 pixels per cell stays unchanged (#73: 81% of pairs changed), and averaged
over that review's noisy sweep the 8/3 stroke is caught more often than under
#73. Heavy grain can still hide a faint stroke; detection falls as grain rises.

A mismatch takes the live session's invalidation path: pending recognition and
search are cancelled, provisional answers, delayed callbacks and captured
metadata are retired, and the new scene is read. Measured on paper photographs,
the comparison is robust to shifts of half a pixel at the 720-pixel working
size with noise and illumination change; at a full pixel one region in five can
still trip, and the whole-frame motion check retires the answer for larger
movement anyway. Photographs of screens (moiré) are not covered, and very small
or sub-noise marks remain heuristic.

## Recovery

### Reading again

Once a complete unique preview is showing, a still scene is not read again
until the picture or the settings change, or autofocus yields a substantially
sharper frame. An unresolved scene retries with a doubling interval (3, 6, 12,
then 24 seconds), so an unreadable page does not keep OCR busy. A sharpness gain
of both 30 percent and 40 points may retry after one second instead, also on a
provisional solved scene, since improved focus is new recognition evidence;
small focus fluctuations do not restart OCR. Each retry takes fresh pixels: a
released frame is never eligible merely because it was sharper, and frames
observed while OCR was pending do not outrank the next fresh capture.

### Targeted retries of uncertain clues

After a complete numeric reading, a substantially clearer cell interior can
trigger a targeted retry through `Scanner.readCells`. At most 12 uncertain,
marked numeric cells are sent to OCR, twice per cell at most, with a 1.5-second
minimum interval. Identical quality does not retrigger work; identical encoded
crops can skip OCR, and repeated evidence cannot vote. Warp and preparation
still run for the complete grid so the crop geometry is consistent, but the
atlas and independent numeric samples contain only the selected cells.
Structural cage and Kakuro targets keep the full-read and manual-review path.

The original reading anchor is never replaced by a chain of retries. A retry
must match the same rules and original content, and both original and retry
samples must be reverified before its results can apply. Confident or
explicitly confirmed clues are not replaced; absent marks cannot delete earlier
clues. Changed proposals remain uncertain and require review, and solver
answers do not participate. A failed or timed-out targeted read retires only
its own request: the preceding full reading and its source stay available, but
only current identity verification can authorize their display, and a late
reply cannot restore a retired scene or replace a newer retry. Each cell has two
automatic attempts; a request reserves an attempt before it starts, an explicit
identical-crop skip or a zero-OCR result refunds it, and an error or timeout
consumes it. Once every remaining cell is exhausted, the status line and the
diagnostics ask for manual review instead of promising another retry.

### Re-reading one clue in the editor

After **Review captured clues**, or a photo import, the editor's cell dialog
offers **Re-read this clue** for a clue that is still flagged uncertain, is
numeric, and whose cell matches the retained straightened photograph. It is not
offered in Play mode, for confirmed or confident clues, or for Kakuro, KenKen
and Killer puzzles, whose cage and sum targets keep the full-read path. The
re-read is a numeric-only `Scanner.readCells` call on the retained rectified
photograph; it shows OCR's proposal beside the field and changes nothing by
itself: **Use proposal** copies the number into the field, and the ordinary
**Save** confirms that one clue and stays undoable. Identical source pixels
reuse a cached proposal, up to eight per source, for crops of at most 65,536
pixels; new pixels cause a new read. A proposal belongs to the generation,
image, cell, source and photo signature that requested it and to an open dialog
with an unchanged draft: closing or reopening the editor, changing the source or
puzzle, or editing the field discards a late result, and a read that takes
longer than ninety seconds leaves the field as it was. The cache never promotes
confidence, and nothing comes from a solution.

### Tracking failures and Restart

A stalled grid detection has an eight-second deadline and retries while the
video stays active; a settings change cancels pending geometry work at once.
A tracking failure backs off for two seconds, then four; the third consecutive
failure stops automatic tracking and the camera offers **Restart live
scanning** (`tracking-recovery.js`). One successful message does not clear the
streak; two seconds of sustained verified work does. Restart retires the prior
work, fences its replies and starts the callbacks and the worker again. Until
then the shutter still captures the current frame by hand, and readings the
camera can no longer verify stay hidden rather than being shown on the wrong
frame. Start/Stop cycles reset the pipeline, a repeated Start is idempotent,
and retired detector clean-up or solver errors cannot cancel a newer request.
Stop releases the scratch canvases and any pending read samples as well as the
timers and workers.

The tracking worker returns bounded rejection reasons (cell, structural region,
geometry or missing anchor), with numeric region indices only, never image
bytes. Three rejected candidates in a row surface an explicit alignment message
and Restart until a candidate verifies, or until detection reports no grid, a
timeout, an error or a grid that does not fit the rules and says so instead;
Save picture keeps the independent single-photo crop and read route. These
reasons help tell acquisition failures before OCR from OCR, rendering or worker
delay.

## Diagnostic timings

`scan-metrics.js` keeps bounded numeric windows of the latest 128 samples per
measurement: painting, frame age, tracking latency, queue work and the time to
the first completed reading. P50 and P95 describe the window; means, maxima and
counts describe the session. Render requests are counted separately from
actual paints, and repeated updates of one frame do not double-count its
tracking measurement. The export carries numbers only, never images or free
text. They are app timings, not sensor frame rates or battery estimates.

## External pictures and document-video tooling

`python scripts/fetch_live_fixtures.py` retrieves 12 hash-selected records from
the **test** split of Lexski/sudoku-image-recognition at revision 733559b. It
fails on revision changes, missing data and oversized files, and the selection
is made before running the scanner, not by keeping only pictures it can read.
The images stay untracked; reports keep the source revision, selection, file
hashes and every success and failure.

`corpus/motion_tracks.py` imports local SmartDoc 2015 `metadata.csv[.gz]` or
MIDV-500 `ground_truth` JSON directories into a common `clips/frames/corners`
manifest. It validates ordering and finite, convex quads, rejects empty or wrong
inputs, and copies only coordinates and frame references, not personal fields
or portraits. Routine CI downloads no full archive, and no benchmark of those
datasets is claimed.

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

## Tests

Unit tests (`node --test web/tests/*.test.js`):

- `live-scanning.test.js`, `capture-store.test.js`, `ocr-retry.test.js`: colours,
  unread evidence, generation ownership, deadlines, transaction completion,
  unavailable storage and retry budgets; `capture-store` also covers transaction
  rollback, byte-storage round trips, same-context ordering and coordination
  failures.
- `live-latency.test.js`: retry ownership and scheduling. `review-safety.test.js`:
  content-change and deletion-ordering boundaries.
- `live-registration.test.js`: small translations and rotation, background
  changes, and rejection of changed digits, erasure, fingers, weak labels and
  boundary marks. `live-interior-change.test.js`: small stroke changes in both
  polarities. `anchored-content.test.js`: the anchored polarity and the raw
  signature format.
- `live-retention.test.js`: pending and completed OCR, provisional results,
  changed-board ownership, bounded loss and shutdown.
- `live-delayed-tier.test.js`: the two tiers, detection pacing and slow anchors;
  `live-relock.test.js`: re-locking after a jump and one verified anchor per
  settled frame.
- `live-camera-recovery.test.js`: settings changes, the detection deadline,
  Start/Stop cycles and retired completions, with a controlled detector, clock
  and canvas. `solver-handoff.test.js`: the interpreter handoff.
- `live-tracker.test.js` and `clue-recovery.test.js`: stopped workers, late
  results, failures, changed sources and manually protected cells in the
  tracking worker and targeted retries; `clue-reread.test.js`: the editor's
  per-clue re-read.
- `ocr-engine-reuse.test.js`: one OCR host across warm-up and reads, prompt
  rejection of superseded reads, the two-second replacement of a stuck call,
  disposal, the exact-image cache, cooperative cancellation, geometry-worker
  reuse and provisional readings that never start a solve.

Browser suites, in Chromium and WebKit (where each runs is in `TESTING.md`):

- `live_camera_regressions.cjs` gives a real canvas-backed MediaStream to the
  production camera with Tesseract, Pyodide and real IndexedDB: automatic
  solving without closing the camera, exact shutter pixels, review gating,
  reload and delete, motion and uncertain readings. It also runs
  `review_safety_regressions.cjs`, which changes and erases clues after solving
  and during delayed reads and searches in both ink polarities, keeps the jitter
  and brightness controls, checks faint mixed-contrast clues and verifies a
  deletion again after reloading, with camera completion callbacks controlled so
  races reproduce. That suite in turn runs
  `structural_capture_regressions.cjs`: horizontal and vertical inequality flips
  and erasures, cage labels and walls, lighting and jitter controls, pending and
  solved overlays, capture metadata, delayed encoding, conversion and database
  opening, reload after deletion, newer captures with identical timestamps, and
  two real tabs sharing IndexedDB and Web Locks. It includes 36 grey-sign cases
  per engine (RGB levels 150, 205 and 210, both orientations, flips and erasures,
  during reading, solving and solved display), and feeds the two newspaper crops
  in `Examples/BrowserScanner/Newspaper` as camera frames: a quarter- and
  half-pixel shift, four levels of noise, both together and a six percent
  brightness change must read as the same print, while an erased clue, a changed
  grey sign (also under shift and noise) and an added cage wall must read as
  changed.
- `live_motion_regressions.cjs` drives a real canvas stream through production
  detection, camera and session logic and Tesseract, with continual jitter and
  an animated background. It uses the 22-clue pattern from a reported screen
  failure, rendered independently (the user's photograph is not committed),
  delays real OCR to expose cancellation starvation, waits for completed rather
  than provisional readings, covers and uncovers the grid and changes one clue,
  and checks captured metadata; out-of-grid pixel witnesses prove that scene
  changes reached the displayed frame, and a pending cancellable solver stub
  isolates retention from repeated-search backoff. It also measures
  static/self and translated-anchor tracking on the twelve Lexski images, which
  is tracking coverage, not detection or digit accuracy.
- `live_recovery_regressions.cjs` resamples one printed cell to simulate lost
  optical detail and restores the original raster in the next phase, through the
  production camera, detector, tracking worker and Tesseract. No OCR values,
  confidence, uncertainty, quality scores, corners or identity proofs enter the
  pipeline; reference values only score the output. A real targeted reply can be
  delayed to test a changed puzzle, and paused playback tests the freshness
  heartbeat; raw values, flags, calls and scheduling statistics are kept in
  `live-recovery.json`.
- `live_features_regressions.cjs`: the real worker, transfer and queue
  behaviour, selected-cell Tesseract calls, identical-crop skipping and
  diagnostic download privacy.
- `live_noise_regressions.cjs` runs automatic type and grid detection, the real
  tracking worker and Tesseract on a continually re-noised grey and blue
  synthetic board, then covers it and changes a digit; labels score output only,
  and no user photograph is committed. Diagnostics without imagery cannot
  establish an exact visual cause.
- `live_soak_regressions.cjs` runs twenty camera sessions per browser with
  resolution changes and delayed replies from the real tracking worker, with
  controlled video clocks and OCR, so only resource ownership is measured:
  worker counts, owned timers and source and scratch buffers must return to zero
  after each Stop. It is not a heap benchmark.
- `external_replay_regressions.cjs` replays the first three hash-selected Lexski
  test entries through automatic detection, tracking and real OCR; reference
  corners and values never reach the recognition path. Its report keeps no-read
  and quality rejections, errors, natural uncertainty and cell-level scores, and
  treats ambiguous pencil marks separately from printed givens. It records
  coverage and is not a gate.
- `ocr_latency_regressions.cjs` reads the two newspaper crops five times on one
  Scanner and records cold and warm read times, the time to the first
  provisional reading, worker counts and cache hits; it asserts engine reuse and
  zero unflagged discrepancies, and reports rather than enforces wall-clock
  times. `OCR_BASELINE_SITE=<other _site>` times a second build in the same
  browser session for an A/B comparison. The OCR quality suite records retries
  and keeps its accuracy and zero-unflagged-discrepancy requirements.

These fixed cases are regression controls, not a representative corpus or an
accuracy gain.

## Limits

Tracking and content checks can conservatively reject a blurred or aliased
frame, which hides overlays rather than inventing confidence. Large motion is
handled by redetection, not unbounded registration. No neural network or
solver-derived recognition is used, and the higher-detail checks are not a
speed-up. Report registration coverage, retention, time to first reading,
cancellations and false stale displays separately from static digit accuracy.
Arbitrarily tiny, blurred or occluded marks may be indistinguishable; results
stay provisional, and the user reviews recognised clues and rules.
