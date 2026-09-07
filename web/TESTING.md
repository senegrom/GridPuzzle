# Browser acceptance and recognition measurements

The deployment build tests the actual Python solver and OCR WebAssembly in both Chromium and mobile WebKit; it does not substitute a JavaScript solver or mocked OCR. Browser versions and raw scan measurements are recorded in the report artifacts.

## Recognition is measured before correction

The acceptance fixture is a generated, high-contrast printed 9×9 Sudoku with 30 givens. `results.json` and `recognition-regressions.json` record raw cells, correct readings, uncertainty flags and discrepancies **before** any manual correction. A wrong or missed fixture clue without a review flag fails the test. Generated fixtures are regression baselines, not claims about newspaper photographs, handwriting or arbitrary publisher styles.

When a reading needs correction, the tests use the real editor and source crop. The final solution must match the original reference puzzle exactly; solving a weaker transcription is not accepted as recognition success. Production code never substitutes fixture answers.

Automatic puzzle classification is also tested as a trust boundary: an automatically identified boxed Sudoku remains `needsReview` until the user confirms its rules. Explicitly selecting Sudoku is a different user decision and may auto-solve an otherwise unambiguous scan.

## Offline test method

The preview is served under `/GridPuzzle/`, matching Pages. After hash-verified offline preparation, the test stops the HTTP server and verifies from Node that the origin is unreachable. A controlled fetch still reads cached first-party code, then the page reloads, starts a fresh Python worker, solves, imports a photo and performs fresh OCR while the origin remains unavailable.

Unit tests additionally verify that `/GridPuzzle/?query=...` navigation maps to cached `index.html`, while real subpaths are not silently rewritten. Offline readiness always re-hashes the complete asset set. Ordinary current-build requests may trust bytes that were already digest-verified before being written, avoiding repeated large-WASM hashing. Update installation reuses unchanged verified assets from the previous build and installs the new solver archive before old caches are retired.

Earlier runs also exercised Playwright's synthetic `context.setOffline(true)`. Chromium passed; WebKit 26.x reported an internal navigation failure before the app could reload. Stopping the real origin tests the service-worker path without depending on that WebKit automation behaviour.

This is still not a physical-iPhone airplane-mode, autofocus, installed-camera or storage-eviction test. Those require hardware.

## Other assertions

Coverage includes all eleven solver families, small/large phone layouts, malformed imports, early cage/Kakuro validation, clue editing, stale-result invalidation, undo, no-op removal guards, bounded keyboard navigation, type changes preserving clues, cancellation/restart, pagehide cleanup, persistent scan uncertainty, denied-camera fallback, photo-overlay invalidation, cache recovery and absence of external runtime requests.

The `Build and deploy phone scanner` workflow is the single full Chromium/WebKit deployment gate. Lightweight PR browser CI runs browser unit/parse checks only; normal Linux/Windows CI and forward compatibility remain independent.
