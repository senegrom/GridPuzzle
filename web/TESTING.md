# Browser acceptance and recognition measurements

The deployment build tests the actual Python solver and OCR WebAssembly in both Chromium and mobile WebKit; it does not substitute a JavaScript solver or mocked OCR. Browser versions and raw scan measurements are recorded in the uploaded report artifact.

## Recognition is measured before correction

For scans with at most 150 numeric crops, each narrow digit is read three times: in the sparse-text atlas, and on its own as a single character from its binary crop and from its grayscale crop. The readings vote; unanimity of at least two readers clears the review flag, any disagreement or a lone reading keeps it. Across eight fonts in Chromium and WebKit this raised clean correct readings from 364 to 453 of 480 digits and removed the only unflagged misread.

Generated acceptance fixtures record raw cells, confidence/review flags and discrepancies **before** manual correction. A wrong or missed clue without a review flag fails. Generated fixtures are baselines, not claims about arbitrary photographs, handwriting or publisher styles.

The generated browser suite also requires exact transcription of a binary 4×4 Sudoku and a Numbrix grid with multi-digit clues. Unit regressions verify complete glyph grouping with speckle removal, threshold-boundary pixels in both polarities, and correction of invalid Str8ts/Kakuro readings and incompatible KenKen cages without weakening import or solve validation.

The deployment also runs two real user-provided newspaper crops from `Examples/BrowserScanner/Newspaper/` through the same production scanner and self-hosted Tesseract.js path. `newspaper-regressions.json` compares the raw transcription with hand-checked `ground-truth.json` and fails on any unsafe unflagged discrepancy or incorrect Str8ts black-cell geometry.

An earlier baseline run of the 2026-09-07 fixtures in Chromium 153.0.8010.12 and WebKit 26.6 recorded:

- shaded Sudoku: **24/24** printed values correct, no structural black cells, no unsafe discrepancies;
- Str8ts: **19/20** printed values correct, exact 22-cell black layout, with the one missed white-cell clue flagged for review and no unsafe discrepancies.

That historical run's generated suite read all baseline, serif, shifted and 4×4 values exactly in both browsers. Chromium also reads the perspective/shadow case 30/30; WebKit reads it 29/30 and flags the miss. Production code never substitutes fixture answers.

Automatic classification is treated as a trust boundary: automatically identified puzzles remain `needsReview` until their rules are confirmed. Str8ts black cells are structural data and remain review-gated even when OCR is otherwise clean.

## How the browser suites run

Most suites in `scripts/` are built on `scripts/harness.cjs`: `serve()` starts
Python's `http.server` for the built site on a port the system picks (under
`/GridPuzzle/` through the `_preview` link when a suite needs the Pages path)
and stops it however the suite ends, `engines()` runs the suite in Chromium
and WebKit on a fresh phone-sized context with the service worker blocked,
collects page errors, screenshots a failing engine and writes one report per
engine under `browser-artifacts/`, and `baselineSite()` builds the two-root
directory the paired suites use to compare the scanner with a pinned earlier
one. The offline smoke suite asks `serve()` for a fixed port (8765), since it
stops and restarts its origin and the service worker's cache must still belong
to it. Three suites serve the site themselves: `ocr_latency` from its own Node
server on port 8777, which can serve a second build beside it; `solver_update`
from a Node server on a port the system picks, to control what each request
returns; and `detect_benchmark_regressions` through the corpus benchmark
runner, which starts `http.server` on port 8782. `review_safety` and
`structural_capture` do not run alone: `live_camera` and `review_safety` call
them with their page. The service-worker unit tests share
`web/tests/service-worker-fixture.js`, an in-memory CacheStorage with the
install, activate and fetch events driven by hand.

### Suite inventory

The 26 suites under `scripts/` (`harness.cjs` is the shared runner, not a
suite) and the workflow jobs that run them. `build` is the deployment gate's
main job in `browser-pages.yml`, `live-acceptance` its fresh-runner job on the
built artifact; `recognition` and `live` are the two parallel jobs of
`scan-input.yml` ("Scanner quality").

| Suite | Proves | Runs in |
| --- | --- | --- |
| `app_review_regressions.cjs` | file download/import, camera-preference races and modal behaviour in the real UI | `live-acceptance` |
| `browser_regressions.cjs` | generated OCR, perspective and review regressions on the production scanner | `build` |
| `browser_smoke.cjs` | all twelve families through the real Pyodide solver, offline reload with the origin stopped | `build` |
| `detect_benchmark_regressions.cjs` | one corrupt image cannot discard the detection results around it | inside `scanner_settings` |
| `editor_reread_regressions.cjs` | the cell dialog's re-read, Use proposal, Save and Undo, with controlled OCR completions (a UI test, not a measurement) | `live-acceptance` |
| `external_replay_regressions.cjs` | three external pictures through automatic detection, tracking and real OCR: no wrong, missed or invented clue unflagged; a picture the app declines to read is recorded, not failed | `live` |
| `live_camera_regressions.cjs` | real canvas MediaStream, production OCR, solver and IndexedDB: live solutions, exact shutter pixels, reload and delete | `build` (first step) |
| `live_features_regressions.cjs` | the real tracking worker, transfer and queue behaviour, selected-cell OCR and diagnostic download privacy | `live-acceptance` |
| `live_motion_regressions.cjs` | a moving 22-clue scene is read in one pass without motion cancellation; external-picture tracking | `live-acceptance` |
| `live_recovery_regressions.cjs` | degraded-to-clear automatic recovery of one printed cell with nothing injected | `live-acceptance` |
| `live_soak_regressions.cjs` | twenty camera sessions leave no workers, timers or buffers behind | `live-acceptance` |
| `newspaper_regressions.cjs` | the two real newspaper crops: no wrong, missed or invented clue unflagged | `build` |
| `ocr_latency_regressions.cjs` | one warm OCR engine is reused across reads; times are reported, not enforced | `build` |
| `ocr_quality_regressions.cjs` | contrast, resolution, blur and generated-clue quality floors with zero unflagged discrepancies | `recognition`; `build` on pushes and manual runs |
| `photo_read_regressions.cjs` | a failed, malformed or cancelled photo read preserves the solved board, overlay and session | `build` |
| `play_regressions.cjs` | Play mode against the real solver: answers, clashes, checking, hints, completion, reload | `build` |
| `play_safety_regressions.cjs` | scan confirmation for Check and Hint, uniqueness, cancellation and late callbacks | `build` |
| `recognition_fragments_regressions.cjs` | damaged glyphs stay complete, marked and reviewable | `recognition` |
| `recognition_segments_regressions.cjs` | paired narrow-number and quality cases against a pinned baseline scanner; no previously correct cell lost | `recognition` |
| `review_safety_regressions.cjs` | single-clue changes retire overlays; faint clues keep ink evidence; deleted pictures stay deleted | inside `live_camera` |
| `scan_input_regressions.cjs` | original-detail decoding, EXIF orientation, local cell alignment and end-to-end photo scans against a pinned baseline | `recognition` |
| `scanner_repair_regressions.cjs` | retained black clues, reload and undo, failed re-detection, import limits, cage-operator validation | `build` |
| `scanner_settings_regressions.cjs` | dimension and type corrections, undo and the solver with deterministic scanner results | `build` |
| `solver_update_regressions.cjs` | a two-tab service-worker update while an old solver worker is still initializing | `build` |
| `structural_capture_regressions.cjs` | changed cage labels, walls and signs invalidate the live view; pictures are owned across tabs | inside `review_safety` |

Two suites depend on an earlier step in the same job: `recognition_segments`
and `scan_input` compare against `browser-artifacts/ocr-quality.json`, which
`ocr_quality` writes (run alone, they stop with a message saying so), and
`live_motion` and `external_replay` need `live-fixtures/` from
`scripts/fetch_live_fixtures.py`.

## Offline test method

The preview is served under `/GridPuzzle/`, matching Pages. After hash-verified offline preparation, the test stops the HTTP server and verifies that the origin is unreachable. The page then reloads, starts a fresh Python worker, solves, imports a photo and performs fresh OCR while the origin remains unavailable.

Unit tests verify that `/GridPuzzle/?query=...` navigation maps to cached `index.html`, while real subpaths are not silently rewritten. Explicit offline preparation re-hashes the complete asset set; startup status is only a presence check. Assets are content-addressed, so updates reuse unchanged verified bytes.

This is not a physical-iPhone airplane-mode, autofocus, installed-camera or storage-eviction test. Those require hardware.

## Other assertions

Coverage includes all twelve solver families, phone layouts, malformed imports, Str8ts black metadata, early cage/Kakuro validation, solve-ready checks, play mode (answers, clashes, checking, hints, completion, persistence, reveal) with solver warm-up, clue editing, stale-result invalidation, undo, no-op removal guards, bounded keyboard navigation, type changes preserving clues, cancellation/restart, pagehide cleanup, persistent scan uncertainty, denied-camera fallback, photo-overlay invalidation, cache recovery and absence of external runtime requests.

Editor regressions check independent numeric/cage warnings through both edit forms, Undo and reload; JSON drafts through view changes and asynchronous solver results; accessible labels for solved cells and Kakuro targets; and superseded JSON import errors. Unit tests also exercise delayed photo decode failures after cancellation or replacement, while preserving errors from the active import.

The browser suite also requires exact transcription of transparent PNGs through both image decode paths, and verifies detected/manual scan dimensions through Board refreshes, editing-tool changes and Undo. Controlled service-worker tests cover activation in another tab, a click racing activation, and initial installation without an unnecessary reload.

Layout/editor coverage includes changing scan families while retaining an existing board, correcting and applying Sudoku box dimensions, and keeping the controls available in automatic mode and after Undo. Keyboard regressions select, extend, deselect and save both cages and inequalities with Enter, Space and arrow keys, checking focus after each board redraw.

Camera lifecycle tests cover cancellation while permission, video playback or grid detection is pending. Chromium and WebKit tests also exercise the application's cancellation wiring with controlled media, verifying that editing and solving stop capture and ignore queued detection callbacks.

Both browsers exercise a real two-tab service-worker update while an old dedicated solver worker is initializing, then request its original verified archive online and with the origin server stopped. This focused lifecycle fixture controls the initialization delay; the full solver and OCR checks above still use the production runtimes. Unit tests cover changed and reused archive bytes, repeated updates, workers that are not enumerable yet, and cleanup after the owning clients close. Old solver archives are retained for the tabs and workers present at activation and pruned at a later activation once those clients have gone.

The `Build and deploy phone scanner` workflow is the full Chromium/WebKit deployment gate. A push to master runs it, and deploys, only when it changes what the site or the gate reads: `web/`, `gridsolver/`, `LICENSE`, the build and fixture scripts, the suites, the three corpus modules the scanner-settings suite loads, `Examples/BrowserScanner/`, the workflow and the setup-scanner action, documents excluded. A pull request that changes any of these meets the whole gate before merge. `Scanner quality` runs the recognition suites and the external-picture replay in two parallel jobs on pull requests that touch the scanner, and `Browser branch tests` runs the unit tests and parse checks on every pull request. Normal Linux/Windows CI and forward compatibility remain independent. All five start on every pull request, so that their checks always report; in all but `Browser branch tests` a first job decides whether the rest needs to run.


## Play confirmation and uniqueness

`scripts/play_safety_regressions.cjs` exercises scan confirmation for Check,
Hint and final-cell checking in Chromium and mobile WebKit. Back and Escape
leave warnings and answers untouched; confirmation resumes only the requested
private action, and a replaced board invalidates it. The real Pyodide solver
checks both completions of a blank 2x2 Latin square: neither may be marked
wrong or overwritten by a hint from an arbitrary solution. Reveal remains
available for inspecting multiple solutions.

Controlled delayed callbacks test Stop and mode changes, followed by a fresh
real solver check. Node tests execute the production action/worker handlers
with controlled browser I/O, covering cached-result races, superseded requests,
construction/postMessage failures, worker errors and deadlines. Unfinished
searches cannot populate the private unique-solution cache.

## Import ownership and shared boundary checks

A selected JSON file or applied JSON draft supersedes older pending reads,
including when the newer input fails size, syntax or shape validation. Cancelling
an empty file picker does not supersede existing work. Production-handler tests
exercise both late successes and late errors; the scanner-repair browser suite
repeats the races through real file inputs and the advanced-data editor.

The shared payload fixtures now check browser editability and solve-readiness as
separate contracts against the native adapter. Explicit malformed black metadata
is rejected rather than normalized to an empty list. Str8ts dimensions must be
2 through 9, and fully blocked Str8ts/Hidato drafts remain editable but cannot be
submitted for solving. Numbered black cells do not satisfy Str8ts's white-cell
requirement.

Duplicate Hidato and Numbrix clues also remain editable, but fail solve-ready
validation consistently with the native path loader.

## Play photo-view privacy

`web/tests/editor-followup.test.js` exercises the production view handlers.
Entering Play hides retained full-solution photo overlays and disables photo
view, photo export and alternative-solution controls. Leaving Play preserves
answers and the computed solution, allowing the photo view to be restored.
The existing scanner-repair browser suite covers the same transition with real
DOM/canvas and the Pyodide solver, while retaining all import-boundary checks.


## Transactional reading and dependency-changing updates

`web/tests/photo-read-transactions.test.js` delivers late scanner successes, failures
and progress even after cancellation. Rejected dimensions, boxes and crops must
supersede older scans without changing accepted state. Failed, stopped, timed-out
or invalid replacement reads preserve results, mappings, caches and undo history;
only an accepted replacement commits. The photo-read acceptance suite repeats
these checks through real controls with a real Pyodide-solved photograph.

`web/tests/runtime-update.test.js` changes WASM, stdlib and lock-file bytes across
multiple builds, tests both legacy and immutable paths, and checks online/offline
routing, full Python installation, activation races and eventual cache cleanup.
`scripts/solver_update_regressions.cjs` repeats dependency-changing two-tab updates
in Chromium and WebKit. Both old and new workers must obtain their own dependency
versions after the origin is shut down. A byte-identical module with different
relative dependencies specifically guards against cached Response URL leakage.
`tests/test_web_runtime_build.py` verifies stamped URLs and complete manifest
coverage without downloading dependencies.

## OCR quality

[OCR_QUALITY.md](OCR_QUALITY.md) describes each recognition mechanism with its
measurements and the acceptance suites. The production OCR quality suite runs
in Chromium and mobile WebKit, using real Tesseract and fixed reference clues:
in Scanner quality on pull requests, and in the deployment gate on every
deployment.

## Live detector recovery

`web/tests/live-camera-recovery.test.js` tests the production live-camera module
with a controlled detector, clock and canvas. Changing settings must immediately
cancel pending geometry work; a stalled detection has an eight-second deadline
and retries while video remains active. Start/Stop cycles reset the pipeline,
repeated Start is idempotent, and retired detector cleanup or solver errors must
not cancel a newer request. The real MediaStream browser suite repeats settings
and deadline recovery, keeping exact displayed-PNG capture and colour checks.

`web/tests/fragmented-clues.test.js` covers complete fragmented crops in both ink
polarities and trailing digits, rejected speckles, unchanged connected glyphs,
and mandatory review/red unknown status before any solver-backed blue entries.

## Review hardening

`web/tests/review-hardening.test.js` covers the fixes from the webapp code review:
a captured still survives the page being hidden while a live camera is released,
track-ended listeners are attached before playback is awaited, Escape closes the
camera panel and restores focus, the preview blocker names the real obstacle,
an invalid guide puzzle leaves the canvas state balanced and produces a message
instead of a per-frame error, the saved-picture download reuses its long-lived
object URL, a version-1 picture database without its store is reset, a running
task disables Check and Hint, Str8ts `#` cells outside the black list are named,
board-shrinking edits drop stale indices, and the solver worker keeps its
interpreter across Python exceptions while retrying failed loads. The runtime
tests additionally pin that one long-lived tab no longer retains every later
build, and that an ambiguous legacy dependency answers with a legible 502.

## OCR engine reuse

`web/tests/ocr-engine-reuse.test.js` covers the reusable OCR runtime (one host
across warm-up and consecutive reads, prompt rejection of superseded reads with
suppressed partials, the two-second replacement of a stuck call, disposal, and
recovery after decoding errors), the host's exact-image cache and cooperative
cancellation, geometry worker reuse with transferred buffers, and provisional
live readings that never start a solve. `scripts/ocr_latency_regressions.cjs`
measures the real engines and asserts reuse and safety.

## Puzzle image corpus

A local corpus of puzzle images with targets lives outside the repository (by
default `E:\OneDrive\Coding\PuzzleCorpus`, override with `PUZZLE_CORPUS`); it holds
only images and one `<name>.json` target each. `corpus/SOURCES.md` lists where
every set comes from and under which licence, `corpus/build_corpus.py` fetches
and normalises the downloaded sets, and `corpus/render_puzzles.py` draws the
families that no public photograph corpus covers.

`node corpus/benchmark.cjs --family sudoku --set wichtounet-newspaper --limit 50`
runs the production detector, OCR and voting over a selection and scores it
against the targets: correct, wrong, missed and invented clues, unflagged
errors, whether the grid was found, the corner error as a percentage of the
grid diagonal, and per-image timings. `--true-corners` feeds the target
outline instead of the detector's, which separates recognition from detection;
`--engine webkit` switches browser. Results go to
`browser-artifacts/corpus-benchmark.json`. It is a measurement, not a gate.

### Corpus correctness and low-contrast review regressions

`node --test web/tests/*.test.js` includes semantic corpus scoring regressions:
reversed, missing, invented and duplicate inequalities; production-read singleton
cages; member ordering and aliases; blocked and numbered-black topology; and
perfect-result gating. `python -m pytest -q tests/test_corpus_targets.py` validates
stored witnesses against the native rules, including the formerly impossible
four-cell Killer cage and 150 seeded generators. Neither suite downloads images.

The existing `scripts/live_camera_regressions.cjs` gate also runs the extended
`structural_capture_regressions.cjs` matrix: 36 grey-sign lifecycle cases across
three ink levels, both orientations, flips/erasures and all three asynchronous
phases, in each engine. The pre-existing black-sign, label/wall, illumination,
jitter, capture migration and cross-tab ordering checks are retained.

### Real-photograph freshness controls

`scripts/structural_capture_regressions.cjs` feeds the two newspaper crops in
`Examples/BrowserScanner/Newspaper` to the live-content comparison as camera
frames and asserts that a quarter- and half-pixel shift, four levels of noise,
both together and a six percent brightness change read as the same print, while
an erased clue, a changed grey sign (also under shift and noise) and an added
cage wall read as changed. `web/tests/anchored-content.test.js` pins the
anchored polarity and the raw signature format. Synthetic boards alone cannot
stand in for halftone paper here: the comparison that shipped in PR #39 passed
every synthetic control and failed on real photographs.

### Grid detection

`node corpus/detect_benchmark.cjs [--set names] [--limit N]` runs the
detector alone over every corpus image with corner ground truth, at the live
and photograph scales, and prints per set how many grids were found with the
right size and corners within 3% of the diagonal, how many quads the line
stage rejected, and the time per frame; `web/GRID_DETECTION.md` explains the
stages and records the measurements. `web/tests/grid-lines.test.js` pins each
rule of the line stage on synthetic warps: thin and light-grey lines, digit
columns, a dropped line, a stray line, cage walls, and the one-axis fallback.

The benchmark shares the OCR benchmark's checkpointing runner and writes a
`formatVersion` 1 object rather than a bare array: per-image measurements sit
in `results`, and `status`, `failure`, `cleanupErrors`, `totalImages`,
`completedImages` and the per-set, per-scale `summary` describe completion.
The numeric `error` inside each scale is corner error; a top-level row
`error` is an input or execution failure, excluded from the success metrics
and counted as `failed`. The report is saved before start-up, after each
image and after clean-up, so browser loss, SIGINT or SIGTERM leave a partial
report with every resource closed. Malformed targets and undecodable images
are recorded individually and count toward the per-set `--limit`; images
without corner truth are excluded. `--engine webkit` is available.

### Unavailable corpus sources

`tests/test_corpus_source_layout.py` checks that a missing registered source
subfolder, or missing required metadata, preserves the images, targets and
provenance already built, while a source that is readable and genuinely empty
can still be rebuilt to an empty set. The bounded Python suite discovers it.

### Scanner review regressions

`web/tests/grid-size-range.test.js` checks rounded large-grid pitches and
rectangular counts through both `estimateGrid` and `findGrid`, retaining the
existing light-line, dense-digit, missing-line and black-cell controls.
`scan-layout.test.js` and `live-camera-recovery.test.js` ensure irrelevant
hidden box values never block non-boxed families, while invalid Sudoku and
Killer Sudoku boxes still prevent recognition.

`web/tests/corpus-detect-runner.test.js` exercises detection checkpoints,
malformed targets, decode failures, browser loss, interruption, cleanup and
selection. The existing `scripts/scanner_settings_regressions.cjs` gate also
runs real hidden-control UI transitions and calls
`scripts/detect_benchmark_regressions.cjs` for real browser PNG-decoding and
HTTP-server cleanup in both engines. These UI tests control OCR responses;
they do not claim new photographic OCR accuracy.

The detection benchmark report is now a versioned envelope with a `results`
array and explicit run/failure metadata; see `GRID_DETECTION.md` before
updating any external consumers of its previous bare-array output.

## Cross-feature reliability

`node scripts/app_review_regressions.cjs` exercises actual file download/import,
scan review and Play metadata, legacy definitions, malformed-backup rejection,
Kakuro conflict feedback, camera focus trapping and the live auto-solve setting
in Chromium and WebKit. The preference race checks control OCR and solver
replies to release obsolete jobs deliberately; they do not measure OCR accuracy.
The separate moving-feed and real camera/solver suites retain that coverage.

`web/tests/offline-retry.test.js` runs the production service worker with
controlled network failures and its own deadline clock. It covers stalled
manifests, assets and bodies, integrity/quota failures, shared downloads across
tabs, reconnection, and late retired requests. No five-minute real-time waits
or relaxed verification checks are required.

Every master deployment waits for `live-acceptance` on a separate runner. It
downloads `scanner-static-build` from that run, checks its build identifier,
and runs the moving-feed and cross-feature suites before Pages can publish.
This is the exact deployment artifact, not an independently rebuilt site.
