# Browser acceptance and recognition measurements

The deployment build tests the actual Python solver and OCR WebAssembly in both Chromium and mobile WebKit; it does not substitute a JavaScript solver or mocked OCR. Browser versions and raw scan measurements are recorded in the uploaded report artifact.

None of these suites is a physical-phone test: airplane mode on a real iPhone, autofocus, the installed camera, storage eviction, VoiceOver and device speed or memory need hardware. Generated fixtures are regression baselines, not claims about arbitrary photographs, handwriting or publisher styles.

## Recognition is measured before correction

For scans with at most 150 numeric crops, each narrow digit is read three times: in the sparse-text atlas, and on its own as a single character from its binary crop and from its grayscale crop. The readings vote; unanimity of at least two readers clears the review flag, any disagreement or a lone reading keeps it. Across eight fonts in Chromium and WebKit this raised clean correct readings from 364 to 453 of 480 digits and removed the only unflagged misread.

Generated acceptance fixtures record raw cells, confidence/review flags and discrepancies **before** manual correction. A wrong or missed clue without a review flag fails. The generated browser suite also requires exact transcription of a binary 4×4 Sudoku and a Numbrix grid with multi-digit clues. Unit regressions verify complete glyph grouping with speckle removal, threshold-boundary pixels in both polarities, and correction of invalid Str8ts/Kakuro readings and incompatible KenKen cages without weakening import or solve validation.

The deployment also runs two real user-provided newspaper crops from `Examples/BrowserScanner/Newspaper/` through the same production scanner and self-hosted Tesseract.js path. `newspaper-regressions.json` compares the raw transcription with hand-checked `ground-truth.json` and fails on any unsafe unflagged discrepancy or incorrect Str8ts black-cell geometry. An earlier baseline run of the 2026-09-07 fixtures in Chromium 153.0.8010.12 and WebKit 26.6 recorded:

- shaded Sudoku: **24/24** printed values correct, no structural black cells, no unsafe discrepancies;
- Str8ts: **19/20** printed values correct, exact 22-cell black layout, with the one missed white-cell clue flagged for review and no unsafe discrepancies.

That historical run's generated suite read all baseline, serif, shifted and 4×4 values exactly in both browsers. Chromium also reads the perspective/shadow case 30/30; WebKit reads it 29/30 and flags the miss. Current measurements are in the workflow reports, and production code never substitutes fixture answers.

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

The `Build and deploy phone scanner` workflow is the full Chromium/WebKit deployment gate. A push to master runs it, and deploys, only when it changes what the site or the gate reads: `web/`, `gridsolver/`, `LICENSE`, the vendored licence texts, the build and fixture scripts, the suites, the three corpus modules the scanner-settings suite loads, `Examples/BrowserScanner/`, the workflow and the setup-scanner action, documents excluded. A pull request that changes any of these meets the whole gate before merge. Every master deployment waits for `live-acceptance` on a separate runner, which downloads `scanner-static-build` from that run, checks its build identifier and runs the moving-feed and cross-feature suites on that exact artifact before Pages can publish. `Scanner quality` runs the recognition suites and the external-picture replay in two parallel jobs on pull requests that touch the scanner, and weekly on master, since no push runs them. `Browser branch tests` runs the unit tests and parse checks on every pull request, and the tests of the jobs that decide what runs (`pytest -m gate`), which must not sit behind those jobs. Normal Linux/Windows CI and forward compatibility remain independent. All five start on every pull request, so that their checks always report; in all but `Browser branch tests` a first job decides whether the rest needs to run.

### Suite inventory

The 26 suites under `scripts/` (`harness.cjs` is the shared runner, not a
suite) and the workflow jobs that run them. `build` is the deployment gate's
main job in `browser-pages.yml`, `live-acceptance` its fresh-runner job on the
built artifact; `recognition` and `live` are the two parallel jobs of
`scan-input.yml` ("Scanner quality"). The camera suites are described in more
detail in [LIVE_CAMERA.md](LIVE_CAMERA.md).

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
| `live_noise_regressions.cjs` | a board re-noised in every frame is read once through automatic detection, the real tracking worker and OCR; covering it keeps the reading and a changed digit replaces it | `live-acceptance` |
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

## Unit tests by area

`node --test web/tests/*.test.js` runs every browser unit test; the Python
side is in the bounded pytest suite.

- **Camera and live tracking:** listed under "Tests" in [LIVE_CAMERA.md](LIVE_CAMERA.md). `camera-lifecycle.test.js` also covers cancellation while permission, video playback or grid detection is pending, and editing and solving stopping capture.
- **Recognition:** [OCR_QUALITY.md](OCR_QUALITY.md) names each mechanism's tests. `fragmented-clues.test.js` covers complete fragmented crops in both ink polarities and trailing digits, rejected speckles, unchanged connected glyphs, and review or red unknown status before any solver-backed blue entry.
- **Play:** `play-actions.test.js` runs the production action and worker handlers with controlled browser I/O: cached-result races, superseded requests, construction and postMessage failures, worker errors and deadlines. `app.test.js` covers Play hiding full-solution photo overlays.
- **Imports and editing:** `import-lifecycle.test.js` and `photo-read-transactions.test.js` deliver late successes, failures and progress after cancellation or replacement; `input-safety.test.js` and `tests/test_web_review3.py` check the shared `web/tests/fixtures/payloads.json` against both the browser's editability and solve-readiness and the native adapter; `tests/test_web_api.py` covers the Python data contract.
- **Grid detection and layout:** `grid-lines.test.js` pins each rule of the line stage on synthetic warps (thin and light-grey lines, digit columns, a dropped line, a stray line, cage walls, the one-axis fallback); `grid-size-range.test.js` checks rounded large-grid pitches and rectangular counts through `estimateGrid` and `findGrid`; `scan-layout.test.js` and `live-camera-recovery.test.js` keep irrelevant hidden box values from blocking non-boxed families while invalid Sudoku and Killer boxes still block recognition.
- **Service worker and updates:** `runtime-update.test.js` changes WASM, standard-library and lock-file bytes across builds and checks online and offline routing, the full Python installation, activation races and cache cleanup; `offline-retry.test.js` drives the production service worker with controlled network failures and its own deadline clock; `offline-lifecycle.test.js`, `offline-update.test.js` and `offline-core-choice.test.js` cover preparation, updates and which Tesseract core is stored; `tests/test_web_runtime_build.py` verifies stamped URLs and complete manifest coverage without downloading dependencies.
- **Workers and robustness:** `worker-lifecycle.test.js` covers OCR and scan cancellation and worker cleanup; `solver-worker.test.js` keeps the solver worker's interpreter across Python exceptions and shares one load between a warm-up and the solve that follows; each module's own test file pins its individual fixes from the code reviews (for example `photo-flow.test.js` a captured still surviving page hide and Escape restoring focus, `capture-store.test.js` the saved-picture download reusing its object URL, and `controllers.test.js` a running task disabling Check and Hint).
- **Corpus tooling:** `corpus-score.test.js`, `corpus-runner.test.js` and `corpus-detect-runner.test.js` cover semantic scoring (reversed, missing, invented and duplicate inequalities, singleton cages, member ordering, blocked and numbered-black topology, perfect-result gating) and the benchmark runners' checkpoints and failure handling; `tests/test_corpus_targets.py` validates stored witnesses against the native rules, and `tests/test_corpus_source_layout.py` the collectors. None downloads images.

## Offline test method

The preview is served under `/GridPuzzle/`, matching Pages. After hash-verified offline preparation, the test stops the HTTP server and verifies that the origin is unreachable. The page then reloads, starts a fresh Python worker, solves, imports a photo and performs fresh OCR while the origin remains unavailable.

Unit tests verify that `/GridPuzzle/?query=...` navigation maps to cached `index.html`, while real subpaths are not silently rewritten. Explicit offline preparation re-hashes the complete asset set; startup status is only a presence check. Assets are content-addressed, so updates reuse unchanged verified bytes.

## Puzzle image corpus and benchmarks

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

`node corpus/detect_benchmark.cjs [--set names] [--limit N]` runs the
detector alone over every corpus image with corner ground truth, at the live
and photograph scales, and prints per set how many grids were found with the
right size and corners within 3% of the diagonal, how many quads the line
stage rejected, and the time per frame (`--engine webkit` switches browser);
`web/GRID_DETECTION.md` explains the stages and records the measurements.

Both benchmarks share one checkpointing runner. The report is saved before
start-up, after each image and after clean-up, so browser loss, SIGINT or
SIGTERM leave a partial report with every resource closed; bad JSON,
undecodable images and recoverable scan errors become individual error rows and
later images continue. Reports carry `status`, `failure`, `cleanupErrors`,
`totalImages` and `completedImages`; context, browser and HTTP-server clean-up is
attempted independently and never replaces the primary failure. The command
exits nonzero for an incomplete run, any failed image or a failed clean-up, and
a hard kill or lost disk access keeps only the last checkpoint. The detection
benchmark writes a `formatVersion` 1 object rather than a bare array: per-image
measurements sit in `results`, with a per-set, per-scale `summary`. The numeric
`error` inside each scale is corner error; a top-level row `error` is an input
or execution failure, excluded from the success metrics and counted as
`failed`. Malformed targets and undecodable images count toward the per-set
`--limit`; images without corner truth are excluded. The `scanner_settings`
gate calls `detect_benchmark_regressions.cjs` for real browser PNG decoding and
HTTP-server clean-up in both engines.
