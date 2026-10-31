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
collects the uncaught errors of every page the suite opens, screenshots a
failing engine and writes one report per engine under `browser-artifacts/`,
and `baselineSite()` builds the two-root directory the paired suites use to
compare the scanner with a pinned earlier one.

A report starts as `{ browser, version, errors, ended, cleanupErrors }`, the
suite adds what it measures, and `status` says `passed` or `failed`, with the
failure's stack in `failure`. `errors` and `ended` are kept by `watch()`
(`scripts/watch.cjs`, which the harness exports) for the browser and every
context and page the suite opens on it, and `cleanupErrors` by the close that
ends each engine. `errors` holds the pages' uncaught errors: the suite's own
page's by their message, and any other page's as `<message> (<url>)`, with
that page's URL (`structural_capture`'s second tab, the paired suites'
baseline pages, the pages `stale_build_checks` and `import_safety_checks`
open in contexts of their own); no suite listens for page errors itself, so
each is collected once. `ended` holds what ended a page without the suite
asking: `page crashed`, `page closed`, `context closed` or `browser
disconnected`, each with the `seconds` since the browser was launched and a
page's `url`; a close the suite or the harness asks for (`close()` on the
page, its context or the browser) is not recorded. Either of these two lists
fails the engine, also when the suite
carried on, and what ended leads the failure in the report, in the log and in
the error the run ends with, one line before Playwright's message:
`<event> <seconds> s after launch (<url>)`, joined by semicolons. Playwright
gives a crash no reason, and the call a crash interrupts fails with `Target
crashed` in Chromium, but in WebKit with the `Target page, context or browser
has been closed` of a lost browser's calls: all that `live_noise`'s WebKit
failure in run 39571397193 said. A lost browser's interrupted call fails
before Playwright reports the closes behind it, so a failure that says its
target is gone (`Target page, context or browser has been closed`, `Target
crashed` or `Page crashed`) waits for that news, until the browser has
disconnected and for at most a second, before it is led; any other failure
is led at once, so that the screenshot shows the page as the failure left
it. `ended` is written with the report after the browser is closed, so it
can also hold what ended after the failure was led. The suites that launch
browsers of their own (`browser_smoke`, `solver_update` and `ocr_latency`,
which keep all three lists in their own reports and fail on each, with `ok:
false` for a `status` of `failed`, and
the detection check inside `scanner_settings`, which fails on its page's
errors and whose record leads its failure in `scanner-settings.json`) watch
them the same way. `ocr_latency` also runs as `engines()` does: every engine
`BROWSER_ENGINES` selects, also after one has failed, with its report
written after each and the first failure rethrown after the last.
`harness_regressions.cjs` checks all this in real browsers, and
`web/tests/harness-watch.test.js` checks the records and the wait with
stand-ins for Playwright's objects (`web/tests/playwright-stand-ins.js`),
and that every script that launches a browser watches it, fails on its
pages' errors, opens its contexts inside its `try`, closes it through
`watch()` and keeps all three lists in a report that names the browser's
version, written right after the close; `web/tests/ocr-latency.test.js` runs
`ocr_latency` on the stand-ins.

The close that ends an engine cannot hold a run up. `browser.close()` alone
can wait for ever: Playwright kills a browser that has not closed after 30
seconds, but sets no limit on what it waits for after that, and in one of 37
local runs of `harness_regressions`, with the host loaded, the WebKit "lost"
case left a process waiting for a close that never came, with no WebKit report
and no word of why, which had to be killed by hand; on CI only the job's
timeout would have ended it. So a suite closes a browser through the
`close(name)` of what `watch()` returns, which waits for 30 seconds
(`CLOSE_LIMIT` in `scripts/watch.cjs`). That limit covers this close and no
other call: on a browser that is up but stuck, Playwright sets no limit on
`page.evaluate()` or `context.close()`, so a suite's own call can still wait
there for ever; on a browser that has gone they end at once. The hang below
is the exception: with a WebKit child still holding the pipes, a closed page's
calls end at once, but `context.close()` waits as `browser.close()` does. A
close that rejects or runs out of time is printed on stderr and kept in the
report's `cleanupErrors`, the list of strings the corpus reports have, as
`browser: browser cleanup timed out` or `browser: <its error>`; the list is
empty after a close that worked. Such a cleanup failure says that the browser
did not close when asked. It says nothing against what the suite checked
before that, but a run that leaves a browser behind has not passed: an engine
that passed fails, with the cleanup failure in `failure`, and an engine that
failed keeps its own failure first. Every engine still runs, and its report is
still written. In `harness_regressions` such a failure reads `<case>: <engine>
closes`, with `browser: browser cleanup timed out`. The detection check inside
`scanner_settings` closes its browser through the corpus runner, whose report
must have no `cleanupErrors`.

The run must then still end, and a process that gave up on a close may not
end by itself. Probed on real browsers on Windows, with nothing sabotaged: the
hang above is WebKit's web process staying on after the browser's main process
has exited. It comes on a loaded host when a call is in flight to the page as
the close comes, as in the "lost" case. WebKit's child processes inherit the
main process's four stdio pipes, and Node, and with it Playwright's close,
waits for those pipes, so it waits for as long as that child lives: past half
an hour here. Playwright's kill after 30 seconds goes to the main process,
which has gone; on Linux it goes to the main process's process group, which
takes the children too. With the browser still up, its pipes and its process
keep Node alive in the same way. Playwright has no public handle on any of
this, so the last step of a suite's run, in `main()` and at the end of the
suites with browsers of their own, is `exitIfUnclosed()`, which after a close
that failed, and only then, exits the process with its exit code, or with 1 if
the suite made nothing of the failure. By then the reports are written.
`process.exit()` still runs what listens for the process's exit: the harness's
clean-up, and Playwright's, which kills every browser it launched and has not
seen end. On Windows that does not reach a child whose main process has gone:
it stays behind after the run, with its empty temporary directories, until it
ends by itself or someone ends it. A browser still up at that exit can also
leave its temporary profile, if it has not let go of it in time. A runner that
requires a suite or calls its `run()` keeps its process, and ending it is then
up to that runner. `harness_regressions.cjs` checks all this on real browsers,
in a process of its own, `web/tests/harness-close.test.js` the close and the
process's end with stand-ins, `solver_update`'s and `browser_smoke`'s too, and
`corpus/benchmark-runner.cjs` shares the timed clean-up, with its own 5
seconds.

A browser that is up but will not give a suite its context or page fails that
engine like any other failure: every suite makes its report first and opens
both inside the `try` that fails an engine, so the failure is led, the browser
closes through `watch()`, the report is written and the next engine runs. Until
October 2026 `browser_smoke` and `solver_update` opened them before that `try`:
the browser stayed up, its pipes held Node and the run never ended, with no
report for that engine and no next one. With no page there is nothing to read,
so such a report has no screenshot and none of the page's `status` and `state`
in `browser_smoke`, and no `results` or `workerDebug` in `solver_update`. A
browser that does not launch at all ends the run there, with exit code 1 and
no report for that engine: nothing is up to hold it.
`web/tests/harness-close.test.js` runs both scripts as they are with each call
refused, on a stand-in Playwright and, for `browser_smoke`, a stand-in for
Python's server on a port the system picks, since the job that runs the unit
tests sets up neither Python nor Playwright.

The offline smoke suite asks `serve()` for a fixed port (8765), since it
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

The `Build and deploy phone scanner` workflow is the full Chromium/WebKit deployment gate. A push to master runs it, and deploys, only when it changes what the site or the gate reads: `web/`, `gridsolver/`, `LICENSE`, the vendored licence texts, the build and fixture scripts, the suites, the three corpus modules the scanner-settings suite loads, `Examples/BrowserScanner/`, the workflow and the setup-scanner action, documents excluded. A pull request that changes any of these meets the whole gate before merge. Every master deployment waits for `live-acceptance` on a separate runner, which downloads `scanner-static-build` from that run, checks its build identifier and runs the moving-feed and cross-feature suites on that exact artifact before Pages can publish, and for `live-camera`, which does the same for the live-camera suite beside it. `Scanner quality` runs the recognition suites, and the external-picture replay with the harness's own check, in two parallel jobs on pull requests that touch the scanner, and weekly on master, since no push runs them. `Browser branch tests` runs the unit tests and parse checks on every pull request, and the tests of the jobs that decide what runs (`pytest -m gate`), which must not sit behind those jobs. Normal Linux/Windows CI and forward compatibility remain independent. All five start on every pull request, so that their checks always report; in all but `Browser branch tests` a first job decides whether the rest needs to run.

The five jobs that run suites (`build`, `live-acceptance`, both `live-camera` legs, `recognition` and `live`) run in the Playwright image of the version `.github/actions/setup-scanner` installs, `mcr.microsoft.com/playwright:v1.64.1-noble` pinned by digest, on `ubuntu-24.04` runners. The image brings Chromium, WebKit and their system packages, so no job installs packages with apt or downloads browsers; before, `npx playwright install --with-deps` waited on the runner's Ubuntu mirror in every job, once for 19 minutes of a 20-minute job. The jobs run as the runner's user and mount the runner's DejaVu and Lato fonts read-only, because the image lacks them: the suites draw DejaVu, and WebKit's serif, sans-serif and monospace are DejaVu (without them it drew those in WenQuanYi Zen Hei). setup-scanner stops without DejaVu; Lato is mounted only to keep the runner's font set, since nothing draws it, so a runner image without it stops nothing. With these fonts both engines drew, in the image of Playwright 1.63, what they had drawn under the old setup, pixel for pixel: a probe compared the eleven families the suites write their test pictures in, at every size the suites use, the fonts the app draws on its canvases, at their weights, and the page's own CSS fonts, with and without Lato. A Playwright update changes the version in setup-scanner and the image tag and digest in the five jobs together: `tests/test_workflows.py` checks that they agree, and setup-scanner stops in an image of another version. Its new engines can draw differently. From 1.63 to 1.64, a probe of the suites' text, the app's canvas text, the fixture photos' decoding and the canvas resampling found Chromium (153 to 156) unchanged pixel for pixel, and WebKit (26.6 to 27.2) unchanged except that canvas text set with `textBaseline = "middle"` now sits higher, with the same glyphs: the suites' text, which most suites set that way, by up to 7 px (FreeSans and FreeSerif up to 1 px either way), and the app's own by up to 2 px, since `app.js`, `photo-flow.js` and `live-overlay.js` draw the solution over the photo, the corner numbers and the live overlay's digits and legend the same way. The suites pass with that, but if Safari ships this WebKit change, those labels sit higher there too. The recognition suites still read every clue they read before (only some review flags moved). `live_recovery_regressions.cjs` failed in WebKit because its scene turned on its digits' exact pixel position: its blur reached into a structural strip of the content comparison, and the OCR read or flagged the blurred clue depending on where its strokes fell. It now draws its digits by their ink, blurs only the part of the retried clue's cell that no strip samples, with a Gaussian it computes itself, and keeps each decision it tests well inside its limit at any digit offset of up to 3 px, in both engines. WebKit 27.2 also reports a `style-src` violation for its own inline style on every `<select>`, once per page load, which `browser_smoke.cjs` ignores in WebKit only, up to that count on each select's line, so an inline style on such a line still fails in both engines. Playwright 1.64.1 kept 1.64.0's browser builds (Chromium 156.0.8078.4, WebKit 27.2), and its image is built from the same Dockerfile on the same Ubuntu base; it fixes two driver bugs, Electron's first window and Chromium 155+ aborting a preflighted cross-origin redirect while a route is registered. The image's Ubuntu release must be the runners', since setup-python takes Python from the runner's tool cache (Ubuntu 26.04's Python cannot load `ssl` in the 24.04 image), so moving to Ubuntu 26.04 is one deliberate change: the image's `-resolute` variant, tag and digest, on `ubuntu-26.04` runners, not `ubuntu-latest`. The test can only read the tag, so setup-scanner's first step compares the image's release with the runner's, whose `/etc/os-release` the jobs mount at `/run/host/os-release`, and stops a job whose image and `runs-on` disagree.

### Suite inventory

The 27 suites under `scripts/` (`harness.cjs` is the shared runner,
`watch.cjs` the watch it keeps on its browsers and their timed close, which
the suites with browsers of their own and the corpus benchmark runner share, and
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
| `harness_regressions.cjs` | the harness itself: a page that crashes while its suite waits (Chromium, through a CDP session's `Page.crash`), a page in a context the suite opened that crashes while the suite carries on, and a browser that goes away each fail the engine and lead its failure (in the report, the log and the error thrown), with the event, its time and the page's URL in `ended`; a page that is gone gets no screenshot, the suite's own page still there one; a suite's own failure on a page that is still there is led by nothing and gets its screenshot at once; a context the suite closes itself is no news; every engine runs after the first failure; uncaught errors thrown in the suite's page, in a tab it opens beside it and in a page in a context it opens each fail the engine though the suite carries on, all in `errors`, the other pages' with their URL; a close that never settles, with the browser left running or after it was closed past the harness, ends the run by itself all the same, in a process of its own: exit code 1, the timed-out close in `cleanupErrors` and on stderr, the next engine run and none of the processes Node started for the run left running | `live` |
| `live_camera_regressions.cjs` | real canvas MediaStream, production OCR, solver and IndexedDB: the live video as the display (no camera frame on the canvas before the freeze, one at it; the canvas in the video's box on phone, tablet and desktop screens, and taking the touches), live solutions frozen until Clear (camera kept on, video paused but attached; turned off by an app switch), the frozen row at 320 px with and without Start preview and a legend whose counts take no room of their own, a live capture without automatic solving (a fresh verified frame with its reading, shown as stored), the paper a quarter turn round (no freeze; the help line and the export say the grid looks sideways), the freeze's wait for clearer clues, off by default (frozen without waiting for a yellow clue's retries) and ticked through its checkbox (saved, restored, three seconds held with its text), a captured reading's review in the editor (as many cells highlighted as the frozen picture shows yellow, with the reading's note), a captured reading that looks upside down (every digit highlighted under the turn note while its still is read again; read turned, the turned reading replaces it under review, read as it lies, it keeps its own flags and note, after a first note that the page may still be turned, pointing to Rotate; the check's task ends either way), exact shutter pixels, reload and delete | `live-camera`, one job per engine |
| `live_features_regressions.cjs` | the real tracking worker in both pixel transports (a bitmap read back in the worker, which Chromium must decide for, and the page's own readback) with the same verdicts and corners, on a frame tracked at its own size and on a 1600 × 1600 one scaled to 1280 × 1280, and, wherever bitmaps are decided, the same pixels (within 2) and each transport's anchor verified on the other's pixels at its corners; transfer and queue behaviour, selected-cell OCR and diagnostic download privacy | `live-acceptance` |
| `live_motion_regressions.cjs` | a moving 22-clue scene is read in one pass without motion cancellation, with pixel witnesses in the frame the camera adopted; external-picture tracking when `live-fixtures/` is there | `live-acceptance` |
| `live_noise_regressions.cjs` | a board re-noised in every frame is read once through automatic detection, the real tracking worker and OCR; covering it keeps the reading and a changed digit replaces it with a reading of the new digit, every blank cell blank and no wrong clue unflagged (on some noisy frames the OCR misreads another clue, a 5 or a 1 as a 3, and flags it); where bitmaps are decided, a frame whose bitmap reads back transparent and one whose bitmap is 1 × 1 are each lost alone (the reading stays, read once, on bitmaps), also right after the change | `live-acceptance` |
| `live_recovery_regressions.cjs` | degraded-to-clear automatic recovery of one printed cell with nothing injected | `live-acceptance` |
| `live_soak_regressions.cjs` | twenty camera sessions leave no workers, timers, buffers or open ImageBitmaps behind (every bitmap transferred to a tracking worker or closed) | `live-acceptance` |
| `newspaper_regressions.cjs` | the two real newspaper crops: no wrong, missed or invented clue unflagged | `build` |
| `ocr_latency_regressions.cjs` | one warm OCR engine is reused across reads; times are reported, not enforced | `build` |
| `ocr_quality_regressions.cjs` | contrast, resolution, blur and generated-clue quality floors with zero unflagged discrepancies | `recognition`; `build` on pushes and manual runs |
| `photo_read_regressions.cjs` | a failed, malformed or cancelled photo read preserves the solved board, overlay and session; through the real codecs, JPEG imports with EXIF orientations 1-8 get bounded, correctly turned previews and original-detail crops, also where `createImageBitmap` refuses `imageOrientation: "from-image"` as Safari before 17.2 does, and a HEIC the browser cannot decode is refused by name without a full decode (`import_safety_checks.cjs`), WebP imports with EXIF 1-8, with or without ImageBitmap, are turned once, in the preview and in the original-detail crop after 0-3 user turns (`webp_import_checks.cjs`), a real failed service-worker install is retried by its Reload button without losing the saved puzzle, and a page left on the previous build after a deploy, under its own service worker and with the real OCR, kept open (the deploy waits up to 20 s for the browser's own update check after its last navigation): **Download for offline use**, which starts no worker, brings the update banner through the worker's own check at its first missing file; when the deploy changed the OCR runtime, the read and the next download then name **Update app & reload**; after a deploy with the same runtime the page reads the newspaper photo and prepares offline use from that build's identical files while its worker gets that build installed, and reads it again after the update (`stale_build_checks.cjs`) | `build` |
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

### Running the suites from an export

The suites run from an export of a commit too (`git archive <commit> | tar -x
-C <dir>`), as when testing a commit without checking it out. Extract it
outside every checkout and Node project: inside a checkout, the build takes
that checkout's `HEAD` for its build id, and inside either, npm installs into
the nearest folder above that holds a `node_modules` or `package.json`, both
without a word.
Three things differ from a checkout:

- **The build id.** An export has no `.git`, and `scripts/build_web.py` takes
  the build id from `git rev-parse HEAD`, so there it stops with "not a git
  repository". Give it the git directory of a checkout whose `HEAD` is the
  exported commit, which `git -C <checkout> rev-parse --absolute-git-dir`
  prints (for a worktree, its directory under the repository's
  `.git/worktrees/`): `GIT_DIR=<that directory> python scripts/build_web.py`.
  Nothing is written there, and the site carries the commit's own build id,
  as a checkout's build does (`build-info.json` names the commit). Without
  such a checkout, run `git init` in the export and commit once (`git -c
  user.name=export -c user.email=export@localhost commit --allow-empty -m
  export`, which needs no git identity): the site then carries that commit's
  id, which serves the suites as well. `scan_input` and
  `recognition_segments` need a `GIT_DIR` that holds their pinned commit,
  which such a repository does not, since `baselineSite()` takes their
  pinned files from `git show`.
- **`node_modules`.** The repository has no `package.json` at its root.
  Install Playwright as `.github/actions/setup-scanner/action.yml` does, at
  the version it pins: `npm install --no-save --package-lock=false
  --ignore-scripts playwright@<that version>`, then `npx playwright install
  chromium webkit` where that version's browsers are not installed yet. Or
  link a checkout's `node_modules` into the export (on Windows a junction,
  which needs no privilege).
- **File times.** `tar -x` dates every file at the commit's time, on a whole
  second. WebKit on Windows (27.2) dates a file it opens itself in whole
  seconds, and a file modified on a whole second now and then a second early;
  a read of a `File` whose date has changed since the `File` was made fails:
  with `NotFoundError`, "The object can not be found here.", or, in
  `createImageBitmap`, with `InvalidStateError`. Given a path,
  Playwright's `setInputFiles` lets WebKit open the file, so in an export on
  Windows the app refuses a photo chosen that way now and then: in a probe
  that chose such a file 40 times, 87 of 160 reads failed, and none failed for a
  file dated half a second later, in Chromium, or for the same bytes handed
  over as `{ name, mimeType, buffer }`. Every suite therefore hands the page
  its files as bytes, which `tests/test_node_tooling.py` checks. The
  stale-build check chose its photo by path until October 2026: from an
  export, its WebKit run stopped at its 120-second wait for "Grid found."
  after the app had refused the photo, before or after the update.
  `web/tests/stale-build-photo.test.js` checks without a browser that it
  hands the photo over as bytes, waits through the app's progress, and stops
  at once, with the app's words, when the app refuses it. `tar -x -m` dates the files at the extraction instead.
  A checkout dates its files when it writes them, which is almost never on a
  whole second, so CI's runners do not meet this.

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
- **Imports and editing:** `import-lifecycle.test.js` and `photo-read-transactions.test.js` deliver late successes, failures and progress after cancellation or replacement; `photo-read-waits.test.js` holds a new photograph's grid detection open, with the app's own task controller: Read puzzle tapped meanwhile is answered and waits without stopping it (Stop shown, Solve, Check and Hint disabled), then is the same Read as one tapped once the detection ended, whichever way the detection ends (a grid, suggested boxes, an unconfident lattice, no grid, a failure, a timeout, a job the scanner gave up); Stop, a new photograph, a capture, Rotate, a corner moved by pointer or keyboard, Hide photo, an edit and Find grid each drop it, also when the stopped detection answers late, while a Read tapped during the detection that Rotate or Find grid then starts waits for that one (also when the first detection answers after it began), a tap after Hide photo and Adjust scan waits again, and a Read after Stop reads at once though the stopped detection has not answered; a double and a triple tap read once; and Find grid makes a Read wait only on the untouched fallback crop (also after a corner handle was touched but not moved); a Read of a picture taken while the help line named a turn has the same board and notes, the turn's note first, whether it waited or was tapped once the detection ended (solved automatically through the corners found, every cell under review through the crop as it is); and, on screen, with the two status lines sampled from a 10 ms timer between tasks as a paint sees them, the answer's promise stays through the elapsed time's ticks and a second tap, the elapsed time after it, while the Read's own lines carry none; each stop without a status of its own (a corner moved by pointer or keyboard, or only touched; a Play cell opened and a change of editing tool, through `app.js`'s own handlers; any other task stop without a message), before and after the elapsed time showed, leaves "Stopped." over "Read puzzle reads the crop as it is." at once, and a Read then reads at once; Stop, an edit, Find grid, Rotate, the camera and a cell selected with the Cages or Inequalities tool (`app.js`'s own handler, which then says how many cells are selected) keep their own lines, also when the stopped detection answers late; Hide photo puts back the line the detection started with, a capture's turn included, then its elapsed time; a status set while the Read waits without stopping it (`app.js`'s answer to a Play tap on a clue cell) replaces the answer, its second line then taken by the elapsed time as any status's, the Read still follows, and a later stop or Hide photo leaves that status; a stopped detection that answers late replaces only the answer still on screen; and `app.js` hands the flow the task controller's `keep`, whose kept line `controllers.test.js` checks on a mock clock. It also holds open the decode of a photograph chosen while another is in the crop editor: chosen from the photo library or with the phone's camera app while a Read waits, it shows "Opening the photo…", then the elapsed time, as a task (Stop shown, Solve, Check and Hint disabled), never "Stopped.", and opens on its fallback crop with its grid searched, as before, without stopping a running task (while the stop of the detection it replaces ends the page's warm solver, as before), and with no word of a photograph not opened once it has; a Read tapped meanwhile is answered, its promise kept with the elapsed time after it, reads and changes nothing of the photograph before it, and is the same Read, board, notes and saved session as one tapped as soon as the photograph opened, waiting for its grid; Find grid, Rotate and a corner moved by pointer or keyboard are answered, the answer kept with the elapsed time after it, stop nothing and leave that photograph, its crop and the layout as they are, and with a Read waiting are answered with the Read's promise, the Read then following the new photograph's grid; Hide photo drops a waiting Read and puts back the opening's line; each stop says at once that the photograph was not opened, with or without a Read waiting, through `app.js`'s own handlers where it has them: Stop and a cell opened to edit its clue with "The new photo was not opened." in place of "Search unfinished…", Undo with it as its second line, an edit and a cell selected with the Cages or Inequalities tool with it after their own second line, and a Play cell, a change of editing tool or any other task stop without a message with "Stopped." over it, also in place of a line set while the photograph opened (`app.js`'s answer to a Play tap on a clue cell, the elapsed time under it), as Stop does then; each leaves the page's warm solver, after which a Read reads the photograph before it at once; the camera (also while it asks for permission), a new board (`app.js`'s `loadPuzzle`) and another photograph (its decode waiting for the first's) drop it under their own lines alone; a photograph that cannot be decoded ends the opening with its error and reads nothing; a picture handed from the camera to the crop editor and the photograph Rotate makes have their grid searched from the tap itself; Stop during a detection or a Read with no photograph opening ends the page's warm solver, as before; and `app.js` tells the flow when a task stops, its `onStop`, run as it is, ending the page's warm solver on a stop of a running task unless that task was a photograph being opened; `input-safety.test.js` and `tests/test_web_api.py` check the shared `web/tests/fixtures/payloads.json` against both the browser's editability and solve-readiness and the native adapter, and `tests/test_web_api.py` covers the rest of the Python data contract. `play-actions.test.js` also keeps a single rule-change note when the rules change between cage families, and `app.test.js` checks the page shell: every button's accessible name begins with the words it shows (not with a symbol), and a focused board cell keeps a mark of another colour when it is also selected.
- **Photo import and orientation:** `photo-import.test.js`, `photo-orientation-entries.test.js`, `photo-orientation-agreement.test.js` and `webp-import.test.js` import synthetic JPEG, PNG and WebP containers through stub decoders: the bounded metadata walk, the decode request in either orientation, Orientation entries the browsers ignore and entries Safari's ImageIO may read its own way, damaged or engine-dependent EXIF imported without a squeeze, the files the walk refuses or leaves to the decoder, and the WebP neutralize-and-turn path through original-detail reads and user turns. `photo-orientation-option.test.js` imports and reads through a stub that refuses `imageOrientation: "from-image"` with a TypeError, as Safari before 17.2 does: the import and the original-detail decode ask again without the option (a quarter turn by the turned photo's short side alone, so that a photo stored portrait keeps its full landscape preview), and a bitmap that comes back unturned goes to the full decode, or to the preview for a read. `image-dimensions.test.js` reads crafted HEIC headers (`tests/heif-fixture.js`: the primary item's size, never a tile's or the thumbnail's, its `irot`, box versions, AVIF left out, truncated and damaged headers), and `heic-import.test.js` imports them where the browser decodes HEIC, turns it otherwise than its `irot`, refuses "from-image" or cannot decode HEIC at all. `photo-import-queue.test.js` and `photo-detail-queue.test.js` cover the decode queue that imports and reads share. `photo-orientation.test.js` and `photo-half-turn.test.js` cover the still photograph's quarter- and half-turn checks on synthetic and recorded readings (the half turn's failures and cancellation too), `photo-cage-turn.test.js` a cage puzzle's check by its sums (`cageSum`'s rules for Killer and KenKen and the grid size they go by, the bar, ties, a failed or cancelled turned reading, a check superseded during its first or last turned reading or cancelled from its progress message, its time budget (the first reading's time counted, the reading in progress stopped and the first reading kept, a superseded check's budget stopping nothing of the newer read), the types and reads it leaves alone, and recorded Sumdoku and Killer readings from every side), `scanner-orientation-recovery.test.js` the quarter-turn trials' failures and cancellation, and `photo-orientation-transactions.test.js` the photo flow taking a turned reading (`photo-flow.test.js` checks that such a reading waits for review instead of solving automatically, and that each term of the automatic solve after a Read holds it back alone: a flagged clue, flagged structure, a reading without a given, the box unticked). `photo-box-frames.test.js` models a sideways page geometrically (Rotate's transform moves its printed corners, the detector reports them in the image's frame, the reader turns by them) and checks that its printed boxes survive turned Reads, Find grid, Rotate, Undo, the next photograph and a live capture of the page, and that a suggested layout still waits for confirmation after a half-turned Read. `photo-capture-orientation.test.js` covers the orientation check of a capture handed to the editor, with the app's own task controller: the cue (`turnCue`) on upside-down, sideways and upright readings, and not on readings with too few glyphs to measure; every digit highlighted under a first note naming the possible turn, in the editor and the saved session, while the still is read again as a photograph; a turned reading replacing the capture's under review (Undo bringing back the highlighted capture); the capture's own warnings given back when the still reads the way it lies, under a first note that the page may still be turned, pointing to Rotate (no highlight, no automatic solve); the highlight and the note kept when the check fails, is stopped by an edit or Stop, or runs out of time; the check's task ended (Stop hidden, Solve, Check and Hint available) in each case; the handoff's own status; no check for an upright or too poor reading or a grid that is not square; a grid that is not square whose reading shows either cue (upside down, by the help line's cue or the still check's alone, or sideways) kept with its own warnings under a first note that points to Rotate, without being read again; a capture without a reading taking the turn its help line named to the crop editor's status as each detection starts and ends (as it ends, Read puzzle on a square grid, Rotate first on any other, for the size detected or, with no grid found, the controls', square or not; as a detection starts on the untouched crop, the turn alone, before a grid found square or not and before a detection that fails; as Find grid starts on a crop a detection set, with a grid found or without one, the check for the controls' size, square or not, which a Read tapped then reads at; again after Find grid, not after Rotate; nothing without a turn) and to the first note of each Read that leaves its picture the way it lies, for the size it reads at, square or not: a Read that waited for the grid (its answer, "Still finding the grid…", and the line that leads into it name no turn) at the size found, controls square or not and grids found square or not, or through the crop as it is at the controls' size when no grid is found or the detection fails, before that crop's note; a Read tapped later; a later Read of the same picture, once; none from a Read that turns the picture, which keeps the turned reading's notes, nor from a later Read through the corners it turned, also once a corner of them was moved by keyboard or pointer, an Undo of that Read left a crop whose corner had moved, an Undo of a later Read through them (one that read the page upright, also after a corner moved, or turned it again) brought them back with their turn, or a Find grid or a Read failed or was stopped, and the note again once Undo, Find grid or a second turned Read brings back corners in the picture's own frame, and on the next capture's picture; none after Rotate or without a turn; no flag moved (a clean reading solved automatically); the note before the reading's own notes and a suggested box layout's; a sideways Killer or KenKen capture read again as a photograph of its type and, read as it lies, kept under the note that points to Rotate, and for one without a reading the crop editor's turn and the first note of a Read that keeps it as it lies, or with no grid found under 6 × 7 controls the Rotate hint and a Read refused at that size; and, on 20,000 random readings, the help line's cue (`turnedPage`) implying the still check's (`turnCue`) for the same turn. `photo-flow.test.js` also checks that Review captured clues copies the capture's flagged clues, flagged structure, black-cell readings and notes into the editor and the saved session, and highlights a digit read twice inside the boxes the capture was read with, as the captured picture shows it yellow.
- **Grid detection and layout:** `grid-lines.test.js` pins each rule of the line stage on synthetic warps (thin and light-grey lines, digit columns, a dropped line, a stray line, cage walls, the one-axis fallback); `grid-size-range.test.js` checks rounded large-grid pitches and rectangular counts through `estimateGrid` and `findGrid`; `scan-layout.test.js` and `live-camera-recovery.test.js` keep irrelevant hidden box values from blocking non-boxed families while invalid Sudoku and Killer boxes still block recognition; `scan-layout.test.js` also covers boxes suggested from the grid size (only where the size leaves a choice, retired once a reading with them is confirmed or other boxes are set; `photo-flow.test.js` checks that a live capture keeps a confirmed one retired, that one a capture was read with is named in the capture's notes, also through its orientation check, retires once the capture is confirmed and stands until then, and that confirming a capture of a type without boxes leaves it standing) and flags for a digit repeated inside the chosen boxes.
- **Service worker and updates:** `runtime-update.test.js` changes WASM, standard-library and lock-file bytes across builds and checks online and offline routing, the full Python installation, activation races and cache cleanup; `offline-retry.test.js` drives the production service worker with controlled network failures and its own deadline clock; `install-deadline.test.js` bounds every installation phase and re-hashes a damaged stored shell entry before publishing; `stale-build.test.js` drives the worker of a page left on the previous build after a deploy (files it never stored come from a newer build's identical copies, never from bytes of another digest, and a file the deploy changed is reported gone; when the origin's list names another build, the worker asks the browser for that build's worker before it fetches a copy, once per build, also for files missed at the same time, never when nothing is missing, when a stored list names the copy, or when the origin's list names its own build or cannot be read, and a check that fails, throws or never answers changes nothing) and the OCR runtime's advice to update when OCR fails to load online (not offline, and not when a deadline expires); `offline-lifecycle.test.js`, `offline-update.test.js` and `offline-core-choice.test.js` cover preparation, updates (one found while the page is open reaches the banner through `updatefound`, and one found while a download or a read runs leaves it to finish, the advice naming it only once it is installed) and which Tesseract core is stored; `tests/test_web_runtime_build.py` verifies stamped URLs and complete manifest coverage without downloading dependencies.
- **Workers and robustness:** `worker-lifecycle.test.js` covers OCR and scan cancellation and worker cleanup; `visible-deadlines.test.js` hides and shows a fake page on a mock clock: a Read's, an OCR job's, OCR loading's and image processing's deadlines and a cancelled OCR job's 2-second bound stop while the page is hidden and still stop a task stuck while it is visible, a deadline that fired never fires again, and the search limit keeps to the clock; `solver-worker.test.js` keeps the solver worker's interpreter across Python exceptions and shares one load between a warm-up and the solve that follows; each module's own test file pins its individual fixes from the code reviews (for example `photo-flow.test.js` a captured still surviving page hide and Escape restoring focus, `capture-store.test.js` the saved-picture download reusing its object URL, and `controllers.test.js` a running task disabling Check and Hint).
- **Corpus tooling:** `corpus-score.test.js`, `corpus-runner.test.js` and `corpus-detect-runner.test.js` cover semantic scoring (reversed, missing, invented and duplicate inequalities, singleton cages, member ordering, blocked and numbered-black topology, perfect-result gating, digit review apart from structural review) and the benchmark runners' checkpoints and failure handling (a report held open on Windows, a page that crashes as Chromium or as WebKit reports it, or between two reads, and a page that throws, which `pageErrors` records however the run ends and which changes nothing else, included) and the detection report, with and without `--live`; `corpus-benchmark.test.js` covers the photo-flow harness, `tests/test_corpus_benchmark_cli.py` the benchmark's option checks (through Node, since the command line stays out of the deployment's inputs), and `photo-flow.test.js` runs the benchmark's page reader and the photo flow on the same readings, which must flag the same digits; `tests/test_corpus_targets.py` validates stored witnesses against the native rules, `tests/test_corpus_source_layout.py` the collectors and `tests/test_corpus_rendering.py` the renderer (the sum-only Killer set included). None downloads images.

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
later images continue. A page that crashes or closes, a lost browser, or a
read that fails because its page is gone ends the run instead: the runner
watches its browser with the suites' `watch()`, since a crashed page is
neither closed to Playwright nor in a disconnected browser, and reads no
further image once it has heard one. The image being read keeps its error,
and a crash heard between two reads fails no image. Whenever a run ends
early, the images it did not read are listed in `notRun` (each `family`,
`set` and `name`): not run, rather than failed one by one. Reports carry
`status`, `failure`, `ended`, `pageErrors`, `cleanupErrors`, `totalImages`,
`completedImages` and `notRun`; `failure` says once why a run ended, led by
what ended as a browser suite's failure is
(`page crashed 812.4 s after launch (http://127.0.0.1:8780/)` on the line
before Playwright's message, or before the runner's
`The benchmark's page or browser is gone` when no read failed), and `ended`
records it. `pageErrors` lists the uncaught errors of the run's pages as
`watch()` collects them (the benchmark's own page's by their message, any
other page's as `<message> (<url>)`). It is in every report however the run
ended: empty until the browser has started, in a checkpoint what was thrown by
then, and in the final save what was thrown until the browser was asked to
close. It is a record and nothing more: the benchmarks measure and are not a
gate, so a page error changes no `status`, `failure`, `notRun`, `summary` or
exit code. Context, browser and HTTP-server clean-up is attempted
independently and never replaces the primary failure. On Windows a
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
