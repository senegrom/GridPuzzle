# Photo detail, clue quality and local cell boundaries

Three parts of the path from a picture to OCR: the original-detail crop a
still photograph gets, the clue-focused quality score the live camera picks
frames by, and the local refinement of numeric cell boundaries after
perspective correction. None of them involves Tesseract's configuration,
puzzle classification or the native solver.

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
files, unsupported ImageBitmap or decode errors retain the existing preview
path with an explicit note. Originals are decoded one at a time: a new read
waits for an earlier, superseded decode (whose bitmap is closed on arrival)
instead of falling back, and only a decoder silent for 15 seconds sends it to
the preview. The original import's
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
not contribute; both polarities work identically. A bounded connected stroke
inside the cell is required: paper grain, broad gradients and shading should
not dominate the quality score merely because they have grayscale variation.
The original newspaper photographs are checked explicitly against false quality
warnings in both browser engines. The lower part of the marked
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
external four-corner mapping are not modified. Both the uniform and locally
refined extractions are compared before OCR. A refined region is used only when
it finds a previously missing mark or strictly contains the old glyph bounds
with additional ink. Identical, shifted or smaller crops retain the original
entry, preserving its padding and avoiding unnecessary review of complete clues.
Every adopted correction remains review-flagged even when OCR agrees. This
corrects modest local spacing errors; it is not full curved-page dewarping or solver-based clue repair.

## Verification

`web/tests/scan-input.test.js` covers limits, quarter-turn coordinates, actual
crop ownership, decode failure/cancellation, line/blank/noise rejection, shared
boundaries, review flags and clue-vs-grid focus ranking. Camera lifecycle tests
cover quality guidance, recovery and manual capture.

`scripts/scan_input_regressions.cjs` runs real image decoding in Chromium and
mobile WebKit (all eight EXIF orientations plus user turns), original-photo
crop checks, a clipped-glyph geometry case and full-page detector-to-OCR cases.
A separate small-grid control stays below the existing detector's 7% area
threshold in both versions. Its explicit manual corner-selection route is tested
and reported separately; it is not counted as successful automatic detection.
It also compares every cell in the 66 quality cases against a pinned baseline
scanner with the same dependencies and browser versions, rejecting unnecessary
increases in review flags as well as newly lost correct cells. No expected
answers enter either recognizer. Raw reports distinguish geometry, pixel
mapping and transcription: a larger crop alone is not evidence of higher OCR
accuracy.

The small generated-page set and two repository photographs are regression
controls, not an independent representative estimate of phone scanning accuracy.
No physical iPhone speed, memory or real camera-quality improvement is claimed
without device testing. The Scanner quality workflow keeps the raw reports.
