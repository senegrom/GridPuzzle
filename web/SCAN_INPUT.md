# Preserve detail, measure clue quality, refine local cell boundaries

These changes build on master `cecdd9c34b2cc049fe969efede6d177aba700d4e`.
They leave Tesseract, puzzle classification, the native solver and the experimental
neural network unchanged. The neural network remains disconnected from the app.

## Original-detail still-photo recognition

The file import still displays a maximum-1600-pixel preview. A weak association
retains the encoded file, not another full-resolution canvas. On Read, a temporary
ImageBitmap decodes the original, the selected grid is extracted into a canvas
with a maximum side of 1800, and the source bitmap is immediately closed. The
canvas is released after recognition, including rejection or cancellation.
The accepted photo, saved picture and overlay coordinates remain in the preview
coordinate system; only OCR receives the detailed crop and its mapped corners.

Input dimensions are checked BEFORE decoding. The enhancement is limited to
16 million source pixels: requesting a resized bitmap alone does not guarantee
that the browser decoder avoids a full-sized intermediate allocation. Larger
files, unsupported ImageBitmap, concurrent detail decoding or decode errors
retain the existing preview path with an explicit note. The original import's
30 MB file limit and 120 MP downscaled / 24 MP full-decode limits are unchanged.
A selected crop cannot recover detail absent in the original. This is a bounded
improvement, not an unlimited full-resolution decoder for 48/120 MP sources.

EXIF orientation is handled by decoding the entire bounded source with
`imageOrientation: from-image` before cropping. User quarter-turns are tracked
separately; corners are inverse-mapped to the oriented source and the extracted
crop is turned back. No EXIF-blind source crop coordinates are used. The original
file is not uploaded, persisted in autosave or added to training data.

## Clue-focused live-camera quality

The geometry worker measures the detected grid's cell interiors, excluding the
outer 20% containing heavy grid lines. Spatially equalised samples compare
Laplacian and gradient energy and ink contrast. Uniform blank and black cells do
not contribute; both polarities work identically. The lower part of the marked
cell score distribution informs frame selection rather than surrounding text.
The existing stability checks, sharp-frame retries, cancellation and backoff stay
in place. Older/injected detector results still support the original sharpness
fallback. A sparse/unassessable grid does not pretend to have calibrated quality.

Messages distinguish small numbers, blurry clues and low contrast. The shutter
still works when automatic recognition pauses. Scores and thresholds are
heuristics, not OCR probabilities or a reliable glare classifier. Focus noise,
paper texture and physical-phone camera behaviour require wider field testing.

## Local numeric-cell boundary refinement

After perspective correction, thin dark lines are sought within 14% of each
expected boundary, independently in each row/column strip. At least 75% of the
strip must support a dark line with light flanks. Missing, thick, double or
ambiguous lines retain the uniform grid. Subpixel/tiny movements are ignored;
cell dimensions may change by no more than 25%. Adjacent accepted cells share
measured boundaries. Already aligned cell bounds preserve the old rounding.

Only numeric regions and their later padding use these local bounds. Black-cell
classification, cage partitions, signs, labels, rectified-image pixels and the
external four-corner mapping are not modified. Every clue with changed geometry
remains review-flagged even when OCR agrees. This corrects modest local spacing
errors; it is not full curved-page dewarping or solver-based clue repair.

## Verification

`web/tests/scan-input.test.js` covers limits, quarter-turn coordinates, actual
crop ownership, decode failure/cancellation, line/blank/noise rejection, shared
boundaries, review flags and clue-vs-grid focus ranking. Camera lifecycle tests
cover quality guidance, recovery and manual capture.

`scripts/scan_input_regressions.cjs` runs real image decoding in Chromium and
mobile WebKit (all eight EXIF orientations plus user turns), original-photo
crop checks, a clipped-glyph geometry case and full-page detector-to-OCR cases.
It also compares every cell in the 66 existing quality cases against the exact
pre-change master with the same dependencies and browser versions. No expected
answers enter either recognizer. The existing fragment and number-quality
regressions are retained. Raw reports distinguish geometry, pixel mapping and
transcription: a larger crop alone is not evidence of higher OCR accuracy.

The small generated-page set and two repository photographs are regression
controls, not an independent representative estimate of phone scanning accuracy.
No physical iPhone speed, memory or real camera-quality improvement is claimed
without device testing. The workflow retains source and raw reports.
