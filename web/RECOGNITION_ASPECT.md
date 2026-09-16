# Review-only recovery of compressed numeric clues

The scanner can misread a narrow `7` as `1`, or lose parts of a compressed
multi-digit clue, even after its individual-glyph fallback. This follow-up to
PR #48 adds two horizontal resamplings (1.5x and 2x) of the entire padded
grayscale sample. It uses the existing Tesseract engine in single-line mode
and never consults the solver or fixture answers.

Only narrow value/black-value crops with intact extraction geometry qualify.
Fragment-recovered crops and structural labels/signs are excluded. The original
sample is not changed; the resamplings are optional extra images. A correction
requires both scales to produce the same bounded numeric string with a score
of at least 75 each. That cutoff is a heuristic, not a calibrated probability.
The two transformations are correlated, so they are excluded from ordinary
majority voting and can never certify each other as confident.

The final boundary only changes an already uncertain reading. Confident
ordinary readings are preserved. Component counts remain a lower bound;
longer complete readings cannot be shortened to match them. A full-length
reading cannot be lengthened or shortened by the new fallback, and an existing
longer OCR alternative blocks a shorter proposal. Accepted changes carry
`aspectRecovered: true` and confidence zero, retaining manual review.

## Resource and lifecycle limits

The existing raw-line and separated-glyph retries execute first. Width retries
only use the remaining portion of the same 24-extra-read budget. Both calls
must fit before a pair starts. Cancellation or an error during either read
cannot emit a partial pair or a stale final result. Identical pixel/mode cache
keys remain reusable without retaining old cell indices. `ocrStats.aspectReads`
counts attempts, including cache hits, while `calls` counts engine work.

Packing is independently capped at 48 aspect variants (24 pairs), with bounded
canvas dimensions and PNG payload lengths. Boards above the existing 150-clue
grayscale limit do not pack any aspect variants. Correct simple scans do not
receive speculative width OCR, though eligible crops incur bounded preparation
work. This change is not a scan-speed improvement claim.

## Verification

`ocr-aspect.test.js` and `ocr-aspect-host.test.js` test eligibility, unchanged
source canvases, evidence precedence, scores, duplicate/malformed results,
packing limits, retry priority, cache ownership and cancellation. The complete
JavaScript suite and runtime build contract remain required.

The real Chromium/mobile-WebKit comparison in
`scripts/recognition_segments_regressions.cjs` now uses the merged PR #48 scanner
at `23f7bc9e223410f5f64d749adcbce2b84be769bc` as its baseline. It retains the
original 26 narrow-number cases, requires exact transcription there, adds 12
held-out FreeSans/FreeSerif cases, and compares every previously correct cell.
The existing 66 quality cases are also rerun on the baseline and compared with
the candidate. Raw cells, flags, gains, losses, timings and calls are saved in
`recognition-quality-report/recognition-segments.json`.

These tests use known corners and predominantly generated print; they do not
measure end-to-end grid detection or establish an accuracy percentage for
arbitrary camera photographs or handwriting. The grid detector, puzzle-family
classifier and native solver are unchanged. See the PR and its completed
Recognition quality run for measured results.
