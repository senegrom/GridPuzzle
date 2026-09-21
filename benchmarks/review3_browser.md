# Review-three browser safety and lifecycle verification

The browser changes remain on the scanner branch. The native exact-partition and uncapped parallel-error fixes from master cb0819f are included without changing the solver's deduction hierarchy, exact matching/guarantees, branch ordering or positive-cap semantics.

## Fixes

- Validate dimensions before allocation and validate box/nested metadata before rendering or persistence. Invalid imported puzzles do not commit state. Malformed saved sessions fall back safely. Scan settings are captured once, checked before explicit-type OCR, and checked again before committing automatic-type results.
- Build in a staged directory and publish only after success. Only the designated repository _site or a new/owned external directory can be replaced. Source paths, Git metadata, repository ancestors, symlinks and unowned existing directories are refused. Older unmarked output directories must be moved aside once; they are never silently deleted.
- Ordinary asset requests, offline readiness and preparation share digest verification. Wrong cached bytes are evicted and refetched; failed network verification is never cached. Readiness checks actual assets sequentially. Cache quota failure does not break a verified online response.
- Every scan owns an OCR host from the beginning of worker initialization. Stop can terminate raw Tesseract children while language loading is pending; cancellation acknowledgements cannot be confused with late progress. Posting failures preserve their original error and clean up workers. Recognition has a whole-task timeout as well as per-worker fallback deadlines.
- Separate task control, edit snapshots, camera/photo flow and offline controls; format first-party sources. Compute grayscale once and run threshold/region preparation off the interface thread.

## Concurrent work preserved

The review branch merges scanner commit 9ea64d8 rather than overwriting it. Its grid-stroke/corner rejection is retained inside the new image worker, and guided clue review, nested input validation, recognition timeout, initial offline-button state and scanner variation tests are preserved. Confidence thresholds are not lowered.

## Completed verification

GitHub Actions run 34062123312 passed the combined non-slow Python suite, browser unit/lifecycle tests, build and both actual Chromium/mobile-WebKit browser suites. Earlier run 34061886549 additionally exercised the installed wheel for the same native/build code. Final normal PR CI also runs Linux/Windows wheel tests, forward compatibility, both browser suites and the combined regression suite.

`review3_browser.json` records 27 checks per engine, actual Python and OCR WASM, all eleven families, malformed-import and saved-state recovery, cancellation during real language initialization followed by a fresh scan, poisoned-cache recovery, and offline reload/solving/recognition with the origin server stopped. Both engines read all 30 baseline clues correctly without corrections; WebKit still conservatively flags two correct readings for review.

`review3_recognition.json` retains the separate generated scan-variation results and guided-review checks from the concurrent patch. Generated fixtures are not a representative real-world recognition benchmark. Physical-phone autofocus, camera behaviour, installation and storage eviction still require hardware testing. The 32 slow tests and full long-running corpora were not rerun. No universal speedup is claimed.

Temporary source-application scripts and write-enabled validation workflows have been removed. Permanent test workflows remain read-only.
