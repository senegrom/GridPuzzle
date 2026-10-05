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
path with an explicit note. Imports and original-detail reads share one decode
queue (`withPhotoDecode` in `photo-detail.js`), so one native decode runs at a
time: a new read or import waits for an earlier, superseded decode (whose bitmap
is closed on arrival) instead of starting beside it. After 15 seconds a waiter
leaves the queue without releasing the decoder it waited for. A read then uses
the preview with the note that original-detail decoding is unavailable (its
photo was never decoded, so it does not say decoding failed); an import is
refused with "Another photo is still decoding. Wait a moment and retry." The
original import's 30 MB file limit and 120 MP downscaled / 24 MP full-decode
limits are unchanged.
A selected crop cannot recover detail absent in the original. This is a bounded
improvement, not an unlimited full-resolution decoder for 48/120 MP sources.

The import (`importPhoto` in `photo-import.js`, which the corpus benchmark
shares) reads the EXIF orientation itself before any decoder runs, from a
bounded walk of the file's metadata: the first JPEG APP1 "Exif" block, a PNG
eXIf chunk before IDAT, or a WebP EXIF chunk (bare TIFF or behind an
"Exif\0\0" prefix). It takes the Orientation from IFD0, or from the ExifIFD when
IFD0 has no usable entry, and ignores an entry that is not a SHORT with count 1
and a value from 1 to 8, as Chromium, Firefox and WebKit do.

- JPEG and PNG are decoded with `imageOrientation: from-image`, so the browser
  applies the orientation. Both bounded resize dimensions, in the oriented
  axes, are requested only where every engine agrees on the result: no
  orientation, a flip or half turn (2 to 4, which keep the axes), or a usable
  IFD0 SHORT behind the standard JPEG identifier. Engines differ on damaged
  EXIF, on PNG eXIf (WebKitGTK has no PNG EXIF support) and on an orientation
  found only in the ExifIFD (WebKit's JPEG decoder reads IFD0 only). There the
  import requests one width that keeps the long side within 1600 whichever way
  the browser turns the photo, so the preview keeps the browser's own aspect
  ratio and is never squeezed; the cost is a smaller preview (1200 x 900 for a
  4:3 photo) when the decoded photo comes out landscape.
- WebP decoders differ in whether they apply EXIF at all. The import rewrites
  the two bytes of the orientation value to 1 in a copy of the encoded file,
  without decoding or copying pixels, decodes that copy as stored, and applies
  the declared quarter turns and mirroring itself, once.
- Damaged EXIF (a broken TIFF header, offsets or counts outside the block,
  stray bytes between JPEG segments, more than 4096 segments or chunks) imports
  the photo as the browser shows it, through the same single width. The one
  refusal left is a segment or chunk that runs past the end of the file or its
  container: "The photo orientation could not be checked safely. Save a copy
  from your photo app, then try again."

The preview keeps its source transform: the retained encoded file (for a WebP,
the neutralized copy) carries `(turns, mirrored)`, the quarter turns and
horizontal mirroring the import applied, and Rotate adds the user's quarter
turns to it (`rotatePhotoSource`). On Read the original is decoded the same
way, the corners are inverse-mapped through that transform to the decoded
source (`detailPlan`), and the extracted crop is mirrored and turned back by the
same `transformPhotoContext` the import used. No EXIF-blind source crop
coordinates are used. The original file is not uploaded, persisted in autosave
or added to training data.

The EXIF tag is only as good as the phone's guess, and a page shot flat on a
table is labelled with whichever way the phone happened to be held: the corpus
holds 18 such photographs (16 a quarter turn off, 2 a half turn). A still
photograph therefore checks its own reading (`Scanner.orient`): clue glyphs
are taller than wide, so when the clue-sized single glyphs are wider than tall
(median height/width under 1) and fewer than half the value regions read as
confident digits, both quarter turns are read through the same crop with its
corners turned, and one is kept only when it reads clearly more confident
digits (at least 8, and at least twice the upright count plus 3). The reading
then says so in its first note and carries `turns`; the photo flow turns its
crop corners with it. Half turns keep upright-shaped glyphs and are left to
Rotate: a poor reading alone is too common (handwriting, blur) to pay for
another read. The live camera, targeted re-reads and non-square grids keep
their orientation.

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
heuristics, not OCR probabilities or a reliable glare classifier.

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
boundaries, review flags and clue-vs-grid focus ranking. `photo-import.test.js`,
`photo-orientation-entries.test.js`, `photo-orientation-agreement.test.js` and
`webp-import.test.js` cover the import's orientation handling, and
`photo-import-queue.test.js` and `photo-detail-queue.test.js` the shared decode
queue. Camera lifecycle tests cover quality guidance, recovery and manual
capture.

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
None of this is a physical-phone test: focus noise, paper texture, camera
quality, speed and memory need field testing on devices, and no improvement
there is claimed. The Scanner quality workflow keeps the raw reports.
