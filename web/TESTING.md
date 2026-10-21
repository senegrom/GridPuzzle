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
runner, which starts `http.server` on port 8782. The stale-build check inside
`photo_read` serves the built site from a Node server on a port the system
picks too, as built and then as later deploys would serve it. `review_safety` and
`structural_capture` do not run alone: `live_camera` and `review_safety` call
them with their page. The service-worker unit tests share
`web/tests/service-worker-fixture.js`, an in-memory CacheStorage with the
install, activate and fetch events driven by hand.

The `Build and deploy phone scanner` workflow is the full Chromium/WebKit deployment gate. A push to master runs it, and deploys, only when it changes what the site or the gate reads: `web/`, `gridsolver/`, `LICENSE`, the vendored licence texts, the build and fixture scripts, the suites, the three corpus modules the scanner-settings suite loads, `Examples/BrowserScanner/`, the workflow and the setup-scanner action, documents excluded. A pull request that changes any of these meets the whole gate before merge. Every master deployment waits for `live-acceptance` on a separate runner, which downloads `scanner-static-build` from that run, checks its build identifier and runs the moving-feed and cross-feature suites on that exact artifact before Pages can publish, and for `live-camera`, which does the same for the live-camera suite beside it. `Scanner quality` runs the recognition suites and the external-picture replay in two parallel jobs on pull requests that touch the scanner, and weekly on master, since no push runs them. `Browser branch tests` runs the unit tests and parse checks on every pull request, and the tests of the jobs that decide what runs (`pytest -m gate`), which must not sit behind those jobs. Normal Linux/Windows CI and forward compatibility remain independent. All five start on every pull request, so that their checks always report; in all but `Browser branch tests` a first job decides whether the rest needs to run.

The five jobs that run suites (`build`, `live-acceptance`, both `live-camera` legs, `recognition` and `live`) run in the Playwright image of the version `.github/actions/setup-scanner` installs, `mcr.microsoft.com/playwright:v1.64.1-noble` pinned by digest, on `ubuntu-24.04` runners. The image brings Chromium, WebKit and their system packages, so no job installs packages with apt or downloads browsers; before, `npx playwright install --with-deps` waited on the runner's Ubuntu mirror in every job, once for 19 minutes of a 20-minute job. The jobs run as the runner's user and mount the runner's DejaVu and Lato fonts read-only, because the image lacks them: the suites draw DejaVu, and WebKit's serif, sans-serif and monospace are DejaVu (without them it drew those in WenQuanYi Zen Hei). setup-scanner stops without DejaVu; Lato is mounted only to keep the runner's font set, since nothing draws it, so a runner image without it stops nothing. With these fonts both engines drew, in the image of Playwright 1.63, what they had drawn under the old setup, pixel for pixel: a probe compared the eleven families the suites write their test pictures in, at every size the suites use, the fonts the app draws on its canvases, at their weights, and the page's own CSS fonts, with and without Lato. A Playwright update changes the version in setup-scanner and the image tag and digest in the five jobs together: `tests/test_workflows.py` checks that they agree, and setup-scanner stops in an image of another version. Its new engines can draw differently. From 1.63 to 1.64, a probe of the suites' text, the app's canvas text, the fixture photos' decoding and the canvas resampling found Chromium (153 to 156) unchanged pixel for pixel, and WebKit (26.6 to 27.2) unchanged except that canvas text set with `textBaseline = "middle"` now sits higher, with the same glyphs: the suites' text, which most suites set that way, by up to 7 px (FreeSans and FreeSerif up to 1 px either way), and the app's own by up to 2 px, since `app.js`, `photo-flow.js` and `live-overlay.js` draw the solution over the photo, the corner numbers and the live overlay's digits and legend the same way. The suites pass with that, but if Safari ships this WebKit change, those labels sit higher there too. The recognition suites still read every clue they read before (only some review flags moved). `live_recovery_regressions.cjs` failed in WebKit because its scene turned on its digits' exact pixel position: its blur reached into a structural strip of the content comparison, and the OCR read or flagged the blurred clue depending on where its strokes fell. It now draws its digits by their ink, blurs only the part of the retried clue's cell that no strip samples, with a Gaussian it computes itself, and keeps each decision it tests well inside its limit at any digit offset of up to 3 px, in both engines. WebKit 27.2 also reports a `style-src` violation for its own inline style on every `<select>`, once per page load, which `browser_smoke.cjs` ignores in WebKit only, up to that count on each select's line, so an inline style on such a line still fails in both engines. Playwright 1.64.1 kept 1.64.0's browser builds (Chromium 156.0.8078.4, WebKit 27.2), and its image is built from the same Dockerfile on the same Ubuntu base; it fixes two driver bugs, Electron's first window and Chromium 155+ aborting a preflighted cross-origin redirect while a route is registered. The image's Ubuntu release must be the runners', since setup-python takes Python from the runner's tool cache (Ubuntu 26.04's Python cannot load `ssl` in the 24.04 image), so moving to Ubuntu 26.04 is one deliberate change: the image's `-resolute` variant, tag and digest, on `ubuntu-26.04` runners, not `ubuntu-latest`. The test can only read the tag, so setup-scanner's first step compares the image's release with the runner's, whose `/etc/os-release` the jobs mount at `/run/host/os-release`, and stops a job whose image and `runs-on` disagree.

### Suite inventory

The 26 suites under `scripts/` (`harness.cjs` is the shared runner, and
`import_safety_checks.cjs`, `webp_import_checks.cjs` and
`stale_build_checks.cjs` are parts of `photo_read_regressions.cjs`; none is a
suite) and the workflow jobs that run
them. `build` is the deployment gate's
main job in `browser-pages.yml`; `live-acceptance` and the per-engine
`live-camera (chromium)` and `live-camera (webkit)` are its three fresh-runner
jobs on the built artifact; `recognition` and `live` are the two parallel jobs of
`scan-input.yml` ("Scanner quality"). The camera suites are described in more
detail in [LIVE_CAMERA.md](LIVE_CAMERA.md).

| Suite | Proves | Runs in |
| --- | --- | --- |
| `app_review_regressions.cjs` | file download/import, camera-preference races, the frozen solution's Clear (tab order, a setting changed while frozen) and modal behaviour in the real UI; the shutter named by the words it shows, and keyboard focus visible on a selected board cell, in another colour, in the Cages and Inequalities tools | `live-acceptance` |
| `browser_regressions.cjs` | generated OCR, perspective and review regressions on the production scanner | `build` |
| `browser_smoke.cjs` | all twelve families through the real Pyodide solver, offline reload with the origin stopped | `build` |
| `detect_benchmark_regressions.cjs` | one corrupt image cannot discard the detection results around it; `--live` measures the live camera's quick path (a lattice of dots, a grid to the photograph's path, is none in its column) | inside `scanner_settings` |
| `editor_reread_regressions.cjs` | the cell dialog's re-read, Use proposal, Save and Undo, with controlled OCR completions (a UI test, not a measurement) | `live-acceptance` |
| `external_replay_regressions.cjs` | three external pictures through automatic detection, tracking and real OCR: no wrong, missed or invented clue unflagged; the two clean pinned photographs must complete an 81-cell reading in each engine within 25 seconds, while the third may be declined and is recorded | `live` |
| `live_camera_regressions.cjs` | real canvas MediaStream, production OCR, solver and IndexedDB: the live video as the display (no camera frame on the canvas before the freeze, one at it; the canvas in the video's box on phone, tablet and desktop screens, and taking the touches), live solutions frozen until Clear (camera kept on, video paused but attached; turned off by an app switch), the frozen row at 320 px with and without Start preview and a legend whose counts take no room of their own, a live capture without automatic solving (a fresh verified frame with its reading, shown as stored), the paper a quarter turn round (no freeze; the help line and the export say the grid looks sideways), the freeze's wait for clearer clues, off by default (frozen without waiting for a yellow clue's retries) and ticked through its checkbox (saved, restored, three seconds held with its text), a captured reading's review in the editor (as many cells highlighted as the frozen picture shows yellow, with the reading's note), a captured reading that looks upside down (every digit highlighted under the turn note while its still is read again; read turned, the turned reading replaces it under review, read as it lies, it keeps its own flags and note; the check's task ends either way), exact shutter pixels, reload and delete | `live-camera`, one job per engine |
| `live_features_regressions.cjs` | the real tracking worker in both pixel transports (a bitmap read back in the worker, which Chromium must decide for, and the page's own readback) with the same verdicts and corners, on a frame tracked at its own size and on a 1600 × 1600 one scaled to 1280 × 1280, and, wherever bitmaps are decided, the same pixels (within 2) and each transport's anchor verified on the other's pixels at its corners; transfer and queue behaviour, selected-cell OCR and diagnostic download privacy | `live-acceptance` |
| `live_motion_regressions.cjs` | a moving 22-clue scene is read in one pass without motion cancellation, with pixel witnesses in the frame the camera adopted; external-picture tracking when `live-fixtures/` is there | `live-acceptance` |
| `live_noise_regressions.cjs` | a board re-noised in every frame is read once through automatic detection, the real tracking worker and OCR; covering it keeps the reading and a changed digit replaces it; where bitmaps are decided, a frame whose bitmap reads back transparent and one whose bitmap is 1 × 1 are each lost alone (the reading stays, read once, on bitmaps), also right after the change | `live-acceptance` |
| `live_recovery_regressions.cjs` | degraded-to-clear automatic recovery of one printed cell with nothing injected | `live-acceptance` |
| `live_soak_regressions.cjs` | twenty camera sessions leave no workers, timers, buffers or open ImageBitmaps behind (every bitmap transferred to a tracking worker or closed) | `live-acceptance` |
| `newspaper_regressions.cjs` | the two real newspaper crops: no wrong, missed or invented clue unflagged | `build` |
| `ocr_latency_regressions.cjs` | one warm OCR engine is reused across reads; times are reported, not enforced | `build` |
| `ocr_quality_regressions.cjs` | contrast, resolution, blur and generated-clue quality floors with zero unflagged discrepancies | `recognition`; `build` on pushes and manual runs |
| `photo_read_regressions.cjs` | a failed, malformed or cancelled photo read preserves the solved board, overlay and session; through the real codecs, JPEG imports with EXIF orientations 1-8 get bounded, correctly turned previews and original-detail crops, also where `createImageBitmap` refuses `imageOrientation: "from-image"` as Safari before 17.2 does, and a HEIC the browser cannot decode is refused by name without a full decode (`import_safety_checks.cjs`), WebP imports with EXIF 1-8, with or without ImageBitmap, are turned once, in the preview and in the original-detail crop after 0-3 user turns (`webp_import_checks.cjs`), a real failed service-worker install is retried by its Reload button without losing the saved puzzle, and a page left on the previous build after a deploy, under its own service worker and with the real OCR, kept open (the deploy waits up to 20 s for the browser's own update check after its last navigation): **Download for offline use**, which starts no worker, brings the update banner through the worker's own check at its first missing file; when the deploy changed the OCR runtime, the read and the next download then name **Update app & reload**; after a deploy with the same runtime the page reads the newspaper photo and prepares offline use from that build's identical files while its worker has that build installed, and reads it again after the update (`stale_build_checks.cjs`) | `build` |
| `play_regressions.cjs` | Play mode against the real solver: answers, clashes, checking, hints, completion, reload | `build` |
| `play_safety_regressions.cjs` | scan confirmation for Check and Hint, uniqueness, cancellation and late callbacks | `build` |
| `recognition_fragments_regressions.cjs` | damaged glyphs stay complete, marked and reviewable | `recognition` |
| `recognition_segments_regressions.cjs` | paired narrow-number and quality cases against a pinned baseline scanner; no previously correct cell lost | `recognition` |
| `review_safety_regressions.cjs` | single-clue changes retire overlays (a frozen solution keeps its frame until Clear reads the change); faint clues keep ink evidence; deleted pictures stay deleted | inside `live_camera` |
| `scan_input_regressions.cjs` | original-detail decoding, EXIF orientation, local cell alignment and end-to-end photo scans against a pinned baseline | `recognition` |
| `scanner_repair_regressions.cjs` | retained black clues, reload and undo, failed re-detection, import limits, cage-operator validation | `build` |
| `scanner_settings_regressions.cjs` | dimension and type corrections, undo and the solver with deterministic scanner results | `build` |
| `solver_update_regressions.cjs` | a two-tab service-worker update while an old solver worker is still initializing | `build` |
| `structural_capture_regressions.cjs` | changed cage labels, walls and signs invalidate the live view (a frozen solution after Clear); pictures are owned across tabs | inside `review_safety` |

Three suites depend on an earlier step in the same job: `recognition_segments`
and `scan_input` compare against `browser-artifacts/ocr-quality.json`, which
`ocr_quality` writes (run alone, they stop with a message saying so), and
`external_replay` needs `live-fixtures/` from `scripts/fetch_live_fixtures.py`.
`live_motion` tracks those pictures too, but only when `live-fixtures/` is
there: without it, it skips that part, says so in its log and in its report
(`corpus: { skipped: "no live-fixtures/fixtures.json" }` in
`live-motion.json`) and passes on the rest. `web/tests/live-motion-pictures.test.js`
covers both cases without a browser.

### Live-camera suite timing

`live_camera_regressions.cjs` records the wall time of every phase per engine
in `live-camera.json` (`phases`, in start order; a nested phase is part of its
parent) and prints one line per phase. On the hosted runner (run 36181850845,
2026-09-25), in seconds:

| Phase | Chromium | WebKit |
| --- | ---: | ---: |
| live solve | 3.4 | 14.0 |
| capture and diagnostics | 0.3 | 1.9 |
| saved picture reload and deletion | 0.2 | 0.4 |
| moving away and closing | 3.8 | 12.4 |
| unread evidence | 1.1 | 9.2 |
| capture without a live reading | 0.8 | 9.4 |
| detector recovery: settings | 2.5 | 9.9 |
| detector recovery: deadline | 9.4 | 17.6 |
| review safety | 50.8 | 65.6 |
| · changed content | 6.9 | 9.2 |
| · capture ordering | 0.1 | 0.2 |
| · faint clues | 2.9 | 3.1 |
| · structural capture | 40.9 | 53.1 |
| · · structural changes | 4.4 | 6.2 |
| · · twelve faint structural variants | 34.7 | 44.2 |
| · · real photographs | 1.2 | 1.2 |
| · · picture ownership across tabs | 0.6 | 1.4 |
| total | 72.3 | 140.4 |

Since the solved view freezes until Clear, "moving away and closing" is
"moving away, Clear and closing", which holds the frozen view for 1.5 s and
watches the live view for 1.5 s after Clear, and two phases follow it:
"frozen, camera off" (an app switch while frozen, Clear asking for the camera
again, a second live solve and a frozen shutter) and "320 px" (a third live
solve on a 320 × 568 screen). The table predates them; two local Chromium
runs on a shared Windows host took 5.5 to 8.9, 2.0 to 5.9 and 1.3 to 2.9 s for
the three, where "live solve" took 5.2 to 5.6 s; the second run took 84 s in
all. "The freeze's wait, off by default and on through its checkbox" came
later still: a solve with the box as installed, two page loads, a solve on a
cold interpreter and the three-second wait. Without its first solve it took
5.3 to 9.5 s in three local Chromium runs (2026-10-08), where the whole suite
took 65 to 99 s; with it, 7.2 to 10.8 s in three runs whose whole suite took
68 to 86 s. Two phases came with it: "viewfinder layers", the first, which
starts the camera on a phone, a tablet and a desktop screen to check that the
canvas and the video share one box, and "live capture with automatic
solving off", after "320 px", a live capture that does not freeze. In run
39142492063 (2026-10-18) they took 0.7 and 1.6 s in Chromium and 20.9 and
10.2 s in WebKit, of 69.6 and 205.0 s in all. "A page lying sideways", after
"live capture with automatic solving off", came with the live view's turn
guidance: a page a quarter turn round, read with real OCR, does not freeze,
and the help line names the turn. It took 4.4 and 5.8 s in two local
Chromium runs (2026-10-20). Two phases after "the freeze's wait" follow a
capture into the editor: "a captured reading's review in the editor" (the
cells and note the frozen picture showed) and "a captured reading that looks
upside down, read again", turned and as it lies (the still read again for
its turn). They took 2.3 to 2.9 s and 2.1 to 2.6 s each in local Chromium runs
(2026-10-20 and 21). `web/tests/suite-docs.test.js` fails when this section
does not name a phase the suite times.

The twelve faint structural variants are over a third of the suite. It used
to be the first step of `build`, which every later job waits for; in its own
`live-camera` job beside `live-acceptance`, a pull request's gate went from
732 s (build 520 s, then live-acceptance 201 s) to 590 s (build 308 s, then
live-camera 271 s alongside live-acceptance 199 s), at about two more billed
runner minutes per run. Since then each engine has its own job
(`BROWSER_ENGINES` selects the harness's engine): on the pull request that
split it (run 36188868585) the stage after `build` took 203 s instead of
263-307 s, with Chromium's camera job at 112 s, WebKit's at 192 s and
`live-acceptance` at 203 s. The longest of the three varies between WebKit's
camera job and `live-acceptance`; splitting `live-acceptance` by engine too
would save only about ten seconds, so it stays one job.

## Unit tests by area

`node --test --test-timeout=60000 web/tests/*.test.js` runs every browser
unit test; the Python side is in the bounded pytest suite. With the timeout, a
regression that leaves a test waiting for ever (a decode queue that is never
released, say) fails that test by name after a minute instead of hanging the
run until CI's job limit.

- **Camera and live tracking:** listed under "Tests" in [LIVE_CAMERA.md](LIVE_CAMERA.md). `live-sampling.test.js` counts what the live camera samples and reads back while it aims at nothing and while it tracks a grid (snapshots, readbacks and the scratch canvases' sizes); no browser suite measures that. `live-transport.test.js` covers the bitmap transport on the camera (no tracking readback on the main thread, bitmaps transferred or closed whatever retires their frame, a frame lost to its bitmap, or to a readback of its own with no picture, costing that frame alone, the restart once bitmap frames keep being lost for half a second, and a video that keeps having no picture read back at the sampling interval rather than its frame rate; its simulation can drive the frame scheduler's `requestVideoFrameCallback` clock at a camera's frame rate), `live-tracker.test.js` its handshake and `live-tracking-pixels.test.js` the worker's readback. `camera-lifecycle.test.js` also covers cancellation while permission, video playback or grid detection is pending, and editing and solving stopping capture.
- **Recognition:** [OCR_QUALITY.md](OCR_QUALITY.md) names each mechanism's tests. `fragmented-clues.test.js` covers complete fragmented crops in both ink polarities and trailing digits, rejected speckles, unchanged connected glyphs, and review or red unknown status before any solver-backed blue entry. `cage-partition.test.js` covers the cage partition in both print styles (on grey paper, with outlines dashed 6 to 12% inside the cells, beside one stray heavy stroke, past Killer's box lines), the clue regions in pixels on two boards and the operator read from the crop `cageLabelCrop` makes; `cage-operator.test.js` each operator's shape, and each rule whose loss turned more right operators wrong than wrong ones right on the KenKen clues recorded from the corpus; `unread-signs.test.js` the review of Futoshiki signs, `readChevron`'s rules and `prepareScan` reading each sign region's chevron.
- **Play:** `play-actions.test.js` runs the production action and worker handlers with controlled browser I/O: cached-result races, superseded requests, construction and postMessage failures, worker errors and deadlines. `app.test.js` covers Play hiding full-solution photo overlays.
- **Imports and editing:** `import-lifecycle.test.js` and `photo-read-transactions.test.js` deliver late successes, failures and progress after cancellation or replacement; `input-safety.test.js` and `tests/test_web_api.py` check the shared `web/tests/fixtures/payloads.json` against both the browser's editability and solve-readiness and the native adapter, and `tests/test_web_api.py` covers the rest of the Python data contract. `play-actions.test.js` also keeps a single rule-change note when the rules change between cage families, and `app.test.js` checks the page shell: every button's accessible name begins with the words it shows (not with a symbol), and a focused board cell keeps a mark of another colour when it is also selected.
- **Photo import and orientation:** `photo-import.test.js`, `photo-orientation-entries.test.js`, `photo-orientation-agreement.test.js` and `webp-import.test.js` import synthetic JPEG, PNG and WebP containers through stub decoders: the bounded metadata walk, the decode request in either orientation, Orientation entries the browsers ignore and entries Safari's ImageIO may read its own way, damaged or engine-dependent EXIF imported without a squeeze, the files the walk refuses or leaves to the decoder, and the WebP neutralize-and-turn path through original-detail reads and user turns. `photo-orientation-option.test.js` imports and reads through a stub that refuses `imageOrientation: "from-image"` with a TypeError, as Safari before 17.2 does: the import and the original-detail decode ask again without the option (a quarter turn by the turned photo's short side alone, so that a photo stored portrait keeps its full landscape preview), and a bitmap that comes back unturned goes to the full decode, or to the preview for a read. `image-dimensions.test.js` reads crafted HEIC headers (`tests/heif-fixture.js`: the primary item's size, never a tile's or the thumbnail's, its `irot`, box versions, AVIF left out, truncated and damaged headers), and `heic-import.test.js` imports them where the browser decodes HEIC, turns it otherwise than its `irot`, refuses "from-image" or cannot decode HEIC at all. `photo-import-queue.test.js` and `photo-detail-queue.test.js` cover the decode queue that imports and reads share. `photo-orientation.test.js` and `photo-half-turn.test.js` cover the still photograph's quarter- and half-turn checks on synthetic and recorded readings (the half turn's failures and cancellation too), `scanner-orientation-recovery.test.js` the quarter-turn trials' failures and cancellation, and `photo-orientation-transactions.test.js` the photo flow taking a turned reading (`photo-flow.test.js` checks that such a reading waits for review instead of solving automatically, and that each term of the automatic solve after a Read holds it back alone: a flagged clue, flagged structure, a reading without a given, the box unticked). `photo-box-frames.test.js` models a sideways page geometrically (Rotate's transform moves its printed corners, the detector reports them in the image's frame, the reader turns by them) and checks that its printed boxes survive turned Reads, Find grid, Rotate, Undo, the next photograph and a live capture of the page, and that a suggested layout still waits for confirmation after a half-turned Read. `photo-capture-orientation.test.js` covers the orientation check of a capture handed to the editor, with the app's own task controller: the cue (`turnCue`) on upside-down, sideways and upright readings, and not on readings with too few glyphs to measure; every digit highlighted under a first note naming the possible turn, in the editor and the saved session, while the still is read again as a photograph; a turned reading replacing the capture's under review (Undo bringing back the highlighted capture); the capture's own warnings given back when the still reads the way it lies; the highlight and the note kept when the check fails, is stopped by an edit or Stop, or runs out of time; the check's task ended (Stop hidden, Solve, Check and Hint available) in each case; the handoff's own status; and no check for an upright or too poor reading or a grid that is not square. `photo-flow.test.js` also checks that Review captured clues copies the capture's flagged clues, flagged structure, black-cell readings and notes into the editor and the saved session, and highlights a digit read twice inside the boxes the capture was read with, as the captured picture shows it yellow.
- **Grid detection and layout:** `grid-lines.test.js` pins each rule of the line stage on synthetic warps (thin and light-grey lines, digit columns, a dropped line, a stray line, cage walls, the one-axis fallback); `grid-size-range.test.js` checks rounded large-grid pitches and rectangular counts through `estimateGrid` and `findGrid`; `scan-layout.test.js` and `live-camera-recovery.test.js` keep irrelevant hidden box values from blocking non-boxed families while invalid Sudoku and Killer boxes still block recognition; `scan-layout.test.js` also covers boxes suggested from the grid size (only where the size leaves a choice, retired once a reading with them is confirmed or other boxes are set; `photo-flow.test.js` checks that a live capture keeps a confirmed one retired, that one a capture was read with is named in the capture's notes, also through its orientation check, retires once the capture is confirmed and stands until then, and that confirming a capture of a type without boxes leaves it standing) and flags for a digit repeated inside the chosen boxes.
- **Service worker and updates:** `runtime-update.test.js` changes WASM, standard-library and lock-file bytes across builds and checks online and offline routing, the full Python installation, activation races and cache cleanup; `offline-retry.test.js` drives the production service worker with controlled network failures and its own deadline clock; `install-deadline.test.js` bounds every installation phase and re-hashes a damaged stored shell entry before publishing; `stale-build.test.js` drives the worker of a page left on the previous build after a deploy (files it never stored come from a newer build's identical copies, never from bytes of another digest, and a file the deploy changed is reported gone; when the origin's list names another build, the worker asks the browser for that build's worker, once per build, never when nothing is missing or when the list names its own build or cannot be read, and a check that fails, throws or never answers changes nothing) and the OCR runtime's advice to update when OCR fails to load online (not offline, and not when a deadline expires); `offline-lifecycle.test.js`, `offline-update.test.js` and `offline-core-choice.test.js` cover preparation, updates (one found while the page is open reaches the banner through `updatefound`, and one found while a download or a read runs leaves it to finish, the advice naming it only once it is installed) and which Tesseract core is stored; `tests/test_web_runtime_build.py` verifies stamped URLs and complete manifest coverage without downloading dependencies.
- **Workers and robustness:** `worker-lifecycle.test.js` covers OCR and scan cancellation and worker cleanup; `visible-deadlines.test.js` hides and shows a fake page on a mock clock: a Read's, an OCR job's, OCR loading's and image processing's deadlines and a cancelled OCR job's 2-second bound stop while the page is hidden and still stop a task stuck while it is visible, a deadline that fired never fires again, and the search limit keeps to the clock; `solver-worker.test.js` keeps the solver worker's interpreter across Python exceptions and shares one load between a warm-up and the solve that follows; each module's own test file pins its individual fixes from the code reviews (for example `photo-flow.test.js` a captured still surviving page hide and Escape restoring focus, `capture-store.test.js` the saved-picture download reusing its object URL, and `controllers.test.js` a running task disabling Check and Hint).
- **Corpus tooling:** `corpus-score.test.js`, `corpus-runner.test.js` and `corpus-detect-runner.test.js` cover semantic scoring (reversed, missing, invented and duplicate inequalities, singleton cages, member ordering, blocked and numbered-black topology, perfect-result gating, digit review apart from structural review) and the benchmark runners' checkpoints and failure handling (a report held open on Windows included) and the detection report, with and without `--live`; `corpus-benchmark.test.js` covers the photo-flow harness, `tests/test_corpus_benchmark_cli.py` the benchmark's option checks (through Node, since the command line stays out of the deployment's inputs), and `photo-flow.test.js` runs the benchmark's page reader and the photo flow on the same readings, which must flag the same digits; `tests/test_corpus_targets.py` validates stored witnesses against the native rules, `tests/test_corpus_source_layout.py` the collectors and `tests/test_corpus_rendering.py` the renderer (the sum-only Killer set included). None downloads images.

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
grid diagonal, and per-image timings. It reads each photograph as the photo
flow does: at most 1600 px on its long side (a larger original is read from its
detail, as `photoDetail` does), through the corners the detector
proposes at any confidence, with every cell flagged when those corners would
still need confirming: at a confidence of 0.8 or less, or when the detector
found a lattice of another size than the one read. A cell's digit counts as
flagged only where the flow's digit review would visit it, not for a cage's
or a sign's structural highlight. See `scoreVersion: 6` in
`corpus/SOURCES.md`. `--true-corners` feeds the target outline instead of the
detector's, which separates recognition from detection; `--engine webkit`
switches browser. Results go to `browser-artifacts/corpus-benchmark.json`. It
is a measurement, not a gate. An unknown option, a missing value, a limit
that is not a nonnegative whole number or an engine other than chromium or
webkit stops it before it starts, with a message, as does a missing `--list`
file or corpus directory; `--name=value` works as well as `--name value`.

`node corpus/detect_benchmark.cjs [--set names] [--limit N] [--live]` runs the
detector alone over every corpus image with corner ground truth, at the live
camera's and the photo flow's sizes (640 and 1600 pixels), both through the
still photograph's path (`findGrid`'s default), and prints per set how many
grids were found with the right size and corners within 3% of the diagonal,
how many quads the line stage rejected, and the time per frame
(`--engine webkit` switches browser). `--live` adds the live camera's own detection:
`findGrid(image, { thorough: false })` on the same 640-pixel drawing, the
size and path `web/live-camera.js` detects a frame with, as a third
measurement per image and a third line per set ("live at 640");
`web/GRID_DETECTION.md` explains the stages and records the measurements.

Both benchmarks share one checkpointing runner. The report is saved before
start-up, after each image and after clean-up, so browser loss, SIGINT or
SIGTERM leave a partial report with every resource closed; bad JSON,
undecodable images and recoverable scan errors become individual error rows and
later images continue. Reports carry `status`, `failure`, `cleanupErrors`,
`totalImages` and `completedImages`; context, browser and HTTP-server clean-up is
attempted independently and never replaces the primary failure. On Windows a
process holding the report open (someone checking progress, an editor) makes
the replacing rename fail; the runner retries it for about five seconds, and a
checkpoint that still cannot be saved is skipped with a warning, for the next
checkpoint or the final save to write. A final save still held after that keeps
the new report beside the old one (`<report>.<pid>.tmp`) and names it in the
error. Any other write failure ends the run. The command
exits nonzero for an incomplete run, any failed image or a failed clean-up, and
a hard kill or lost disk access keeps only the last checkpoint. The detection
benchmark writes a `formatVersion` 1 object rather than a bare array: per-image
measurements sit in `results` (`at640` and `at1600`), with a per-set, per-scale
`summary`. With `--live` each result also has `live`, the summary has one more
row per set, which says `thorough: false`, and the report's `live` field
records what that column measured (`{ "scale": 640, "thorough": false }`);
without it the report is as it was, its `options` saying `"live": false`. The
numeric `error` inside each measurement is corner error; a top-level row
`error` is an input or execution failure, excluded from the success metrics
and counted as `failed` in every row of its set. Malformed targets and
undecodable images count toward the per-set `--limit`; images without corner
truth are excluded. The `scanner_settings` gate calls
`detect_benchmark_regressions.cjs` for real browser PNG decoding and
HTTP-server clean-up in both engines, with `--live`, on a lattice of dots that
the photograph's path reads and the live camera's does not.
