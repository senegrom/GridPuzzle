# Browser acceptance and recognition measurements

The deployment build tests the actual Python solver and OCR WebAssembly in both Chromium and mobile WebKit; it does not substitute a JavaScript solver or mocked OCR. Browser versions and raw scan measurements are recorded in the uploaded report artifact.

## Recognition is measured before correction

Every single-glyph digit is read three times: in the sparse-text atlas, and on its own as a single character from its binary crop and from its grayscale crop. The readings vote; unanimity of at least two readers clears the review flag, any disagreement or a lone reading keeps it. Across eight fonts in Chromium and WebKit this raised clean correct readings from 364 to 453 of 480 digits and removed the only unflagged misread.

Generated acceptance fixtures record raw cells, confidence/review flags and discrepancies **before** manual correction. A wrong or missed clue without a review flag fails. Generated fixtures are baselines, not claims about arbitrary photographs, handwriting or publisher styles.

The generated browser suite also requires exact transcription of a binary 4×4 Sudoku and a Numbrix grid with multi-digit clues. Unit regressions verify complete glyph grouping with speckle removal, threshold-boundary pixels in both polarities, and correction of invalid Str8ts/Kakuro readings and incompatible KenKen cages without weakening import or solve validation.

The deployment also runs two real user-provided newspaper crops from `Examples/BrowserScanner/Newspaper/` through the same production scanner and self-hosted Tesseract.js path. `newspaper-regressions.json` compares the raw transcription with hand-checked `ground-truth.json` and fails on any unsafe unflagged discrepancy or incorrect Str8ts black-cell geometry.

For the 2026-09-07 fixtures, Chromium 153.0.8010.12 and WebKit 26.6 both produce:

- shaded Sudoku: **24/24** printed values correct, no structural black cells, no unsafe discrepancies;
- Str8ts: **19/20** printed values correct, exact 22-cell black layout, with the one missed white-cell clue flagged for review and no unsafe discrepancies.

The same run's generated suite reads all baseline, serif, shifted and 4×4 values exactly in both browsers. Chromium also reads the perspective/shadow case 30/30; WebKit reads it 29/30 and flags the miss. Production code never substitutes fixture answers.

Automatic classification is treated as a trust boundary: automatically identified puzzles remain `needsReview` until their rules are confirmed. Str8ts black cells are structural data and remain review-gated even when OCR is otherwise clean.

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

The `Build and deploy phone scanner` workflow is the single full Chromium/WebKit deployment gate. Lightweight PR browser CI runs unit/parse checks; normal Linux/Windows CI and forward compatibility remain independent.


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
