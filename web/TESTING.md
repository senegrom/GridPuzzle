# Browser acceptance and recognition measurements

The deployment build tests the original Python solver, not a JavaScript
substitute, in both Chromium and mobile WebKit. The browser version is recorded
in each JSON report. The native non-slow suite and JavaScript unit tests are
independent additional checks.

## Recognition is measured before correction

The acceptance fixture is a generated, high-contrast printed 9x9 Sudoku with
30 givens. `results.json` records the raw cells, number of correct readings,
uncertainty flags and discrepancies. Any wrong or missed fixture clue without
a review flag fails the test. Recognition accuracy on this fixture is not a
claim about newspaper photographs, handwriting or arbitrary publisher styles.

When a flagged reading needs correction, the test uses the actual cell editor
and visible source crop to simulate human review. The correction count is
reported separately. The final solution must match the original reference
puzzle exactly; solving a different, weaker transcription is not accepted as a
recognition success. Production code never substitutes the fixture answers.

## Offline test method

The preview site is served below `/GridPuzzle/`, like the intended Pages site.
After hash-verified offline preparation, the test stops the HTTP server and
verifies from Node that the origin is unreachable. A `cache: 'no-store'` fetch
from the controlled page must still read `model.js`, demonstrating service-worker
cache use rather than an HTTP-cache hit. It then reloads the page, starts a fresh
Python worker, solves, imports a photo and runs fresh OCR while the server
remains stopped. No remote CDN or recognition service is available to fill gaps.

Earlier runs also exercised Playwright's `context.setOffline(true)`.
Chromium passed. WebKit 26.0 and 26.6 reported an internal error during document
navigation before the app could reload, including through `location.reload()`.
The server-shutdown test avoids relying on that synthetic network-state path
without allowing the app to retrieve missing assets from the network.

This is not a physical-iPhone airplane-mode, autofocus or installation test.
Those hardware checks still need a real device.

## Other assertions

All eleven solver families, small/large phone layouts, clue editing, stale-result
invalidation, undo, type changes preserving clues, cancellation and clean worker
restart, pagehide cleanup, persistent scan uncertainty, denied-camera fallback,
photo-overlay geometry invalidation, and absence of external runtime requests
are covered. Reports and screenshots are uploaded as workflow artifacts.
