# Browser acceptance and recognition measurements

The deployment build tests the actual Python solver and OCR WebAssembly in both Chromium and mobile WebKit; it does not substitute a JavaScript solver or mocked OCR. Browser versions and raw scan measurements are recorded in the uploaded report artifact.

## Recognition is measured before correction

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

Coverage includes all twelve solver families, phone layouts, malformed imports, Str8ts black metadata, early cage/Kakuro validation, solve-ready checks, clue editing, stale-result invalidation, undo, no-op removal guards, bounded keyboard navigation, type changes preserving clues, cancellation/restart, pagehide cleanup, persistent scan uncertainty, denied-camera fallback, photo-overlay invalidation, cache recovery and absence of external runtime requests.

Editor regressions check independent numeric/cage warnings through both edit forms, Undo and reload; JSON drafts through view changes and asynchronous solver results; accessible labels for solved cells and Kakuro targets; and superseded JSON import errors. Unit tests also exercise delayed photo decode failures after cancellation or replacement, while preserving errors from the active import.

The browser suite also requires exact transcription of transparent PNGs through both image decode paths, and verifies detected/manual scan dimensions through Board refreshes, editing-tool changes and Undo. Controlled service-worker tests cover activation in another tab, a click racing activation, and initial installation without an unnecessary reload.

The `Build and deploy phone scanner` workflow is the single full Chromium/WebKit deployment gate. Lightweight PR browser CI runs unit/parse checks; normal Linux/Windows CI and forward compatibility remain independent.
