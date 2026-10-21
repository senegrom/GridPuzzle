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
IFD0 has no usable entry, following the ExifIFD pointer (a LONG or IFD with
count 1) one level only. A SHORT with count 1 whose value is outside 1 to 8
(Android writes 0, 9 or 65535) is not usable and is ignored, as Chromium,
Firefox and WebKit ignore it. An Orientation entry of any other type or count
(a LONG 6, two SHORTs) counts as damaged EXIF below, because our users are on
iPhone Safari: Safari decodes with ImageIO, whose reading of such an entry is
unverified, and a squeezed preview would be visible.

- JPEG and PNG are decoded with `imageOrientation: from-image`, so the browser
  applies the orientation. Both bounded resize dimensions, in the oriented
  axes, are requested only where every engine agrees on the axes: no
  orientation, a flip or a half turn (1 to 4, wherever the value was found),
  or a quarter turn in a usable IFD0 SHORT behind the standard JPEG
  identifier. Engines differ on PNG eXIf (WebKitGTK has no PNG EXIF support),
  on a block behind a repeated JPEG identifier or an "Exif\0\0"-prefixed PNG
  eXIf (Skia ignores the first; Chromium, Firefox and libpng the second) and
  on an orientation found only in the ExifIFD (WebKit's JPEG decoder reads
  IFD0 only), and damaged EXIF has no value to trust. For a quarter turn (5 to
  8) found there, and for damaged EXIF, the import requests one width that
  keeps the long side within 1600 whichever way the browser turns the photo,
  so the preview keeps the browser's own aspect ratio and is never squeezed.
  The cost is a smaller preview whenever the decoded photo comes out
  landscape: 1200 x 900 instead of 1600 x 1200 for a 4:3 photo, 900 x 507
  instead of 1600 x 900 for 16:9, and 400 x 100 instead of 1600 x 400 for
  4:1. A portrait result keeps its 1600-pixel long side.
- Safari before 17.2 (iOS 16.4 to 17.1), like Firefox before 111, knows
  `imageOrientation` only as `none` or `flipY`, so `from-image` is a TypeError
  there. Its default, `none`, already applies the EXIF orientation (WebKit's
  `ImageBitmap.cpp` on safari-7615-branch; whatwg/html#7210), so the import
  asks again without the option, for the same bounded size, except where the
  browser must turn the photo a quarter: there both dimensions would hide a
  turn it skipped, so the retry names one dimension, the turned photo's short
  side (its width when the turned photo is portrait, its height when it is
  landscape). A bitmap the browser turned comes back at the full preview size,
  as on later versions, whatever the aspect ratio; one it did not turn comes
  back within that short side, its long side across the turned photo's, and
  is closed, and the photo goes to the full decode, which the browser turns
  itself. A photo that is square, or within a few pixels of square, cannot
  show a skipped turn this way; the versions that refuse the option turn
  photos by default. The original-detail decode retries the same way. Before, both
  decodes failed on those versions: every photo was decoded at full size (and
  refused over 24 megapixels), and no Read used the original's detail.
- WebP decoders differ in whether they apply EXIF at all. The import rewrites
  the two bytes of the orientation value to 1 in a copy of the encoded file,
  without decoding or copying pixels, decodes that copy as stored, and applies
  the declared quarter turns and mirroring itself, once.
- Damaged EXIF (a broken TIFF header, offsets or counts outside the block, an
  Orientation entry of another type or count, stray bytes between JPEG
  segments, more than 4096 segments or chunks) imports the photo as the
  browser shows it, through the same single width.
- HEIC, the iPhone's own format, reaches the import on an iPhone only from
  Choose File (the Files app): the Photo Library hands over a JPEG. A desktop
  browser can be handed one too: Safari 17 and later decode it, on a Mac as on
  an iPhone, and other browsers refuse it by name (below). It is HEIF
  (ISO/IEC 23008-12, a `ftyp` brand of `heic`, `heix` or `mif1`; AVIF, which
  shares the layout, stays out), and its size is the primary item's `ispe`
  (`pitm`, then its properties in `iprp`: `ipco` and `ipma`), on an iPhone a
  grid of tiles: never a tile's, the thumbnail's or a gain map's. The limits
  below trust that `ispe`. A grid states its output size again in its own
  item data, which is not read, so a crafted file whose grid is larger than
  its `ispe` meets only the browser's own decoder limits (which of the two
  sizes ImageIO follows is unverified): at worst it takes down the user's own
  tab. Its `irot` (a quarter turn or two) and `imir` (a mirror) take
  the place of the EXIF orientation, which is not read, and the browser
  applies them. Safari 17 and later decode HEIC with ImageIO; that its turn
  follows `irot` is unverified on a phone, so the import asks for one width,
  planned on the axes `irot` declares, and the preview keeps the browser's
  aspect ratio, never squeezed. That width keeps a bitmap the browser turned
  the other way within twice 1600 pixels, which costs a smaller preview only
  for a photo longer than 2:1. A browser that makes no HEIC bitmap (Safari
  before 17, Chrome, Firefox) cannot decode it at all, so no full decode is
  tried.

The import refuses a photo only in these cases:

- larger than 30 MB: "Please choose a photo smaller than 30 MB."
- dimensions not readable from the first 512 KB (another format, or a damaged
  header): "The photo dimensions could not be checked safely. Export it as
  JPEG, PNG or WebP, then try again." For a HEIC (its `meta` box must lie in
  those 512 KB): "The HEIC photo's dimensions could not be checked safely.
  Choose the photo from the Photo Library, which converts it to JPEG, or
  export it as JPEG, PNG or WebP, then try again."
- a HEIC the browser cannot decode: "This browser cannot open HEIC photos.
  Choose the photo from the Photo Library, which converts it to JPEG, or
  export it as JPEG, PNG or WebP, then try again."
- a width or height of 0: "The image is empty."
- more than 120 million pixels: "This photo is too large to decode safely on a
  phone. Use a smaller camera resolution or crop it first."
- before the metadata walk stops (at the EXIF block, a JPEG's start of scan or
  a PNG's first IDAT), a JPEG segment whose length is 0 or 1, or a JPEG segment
  or a PNG or WebP chunk that runs past the end of the file (for a WebP, of its
  RIFF container): "The photo orientation could not be checked safely. Save a
  copy from your photo app, then try again." The first IDAT's own length is
  not checked, so a PNG cut short inside its image data still reaches the
  decoder, as it did before the walk. A WebP's EXIF follows its bitstream, so
  a WebP cut short inside its bitstream is refused.
- no ImageBitmap resizing (missing or failed, or a retried bitmap the browser
  did not turn) for a photo of more than 24 million pixels: "This browser
  cannot downscale this large photo safely. Crop it in your photo app first,
  then try again."
- another decode still holding the queue after 15 seconds: "Another photo is
  still decoding. Wait a moment and retry."

A file the browser itself cannot decode fails with the browser's own error.

The preview keeps its source transform: the retained encoded file (for a WebP,
the neutralized copy) carries `(turns, mirrored)`, the quarter turns and
horizontal mirroring the import applied, and Rotate adds the user's quarter
turns to it (`rotatePhotoSource`). On Read the original is decoded the same
way, the corners are inverse-mapped through that transform to the decoded
source (`detailPlan`), and the extracted crop is mirrored and turned back by the
same `transformPhotoContext` the import used. No EXIF-blind source crop
coordinates are used: an original decoded with its long side across the
preview's (before the turns) is not used, and the read takes the preview with
the note that the original photo dimensions could not be checked. The original file is not uploaded, persisted in autosave
or added to training data.

The EXIF tag is only as good as the phone's guess, and a page shot flat on a
table is labelled with whichever way the phone happened to be held: the corpus
holds 21 such photographs (19 a quarter turn off, 2 a half turn). A still
photograph therefore checks its own reading (`Scanner.orient`): clue glyphs
are taller than wide, so when the clue-sized single glyphs are wider than tall
(median height/width under 1) and fewer than half the value regions read as
confident digits, both quarter turns are read through the same crop with its
corners turned, and one is kept only when it reads clearly more confident
digits (at least 8, and at least twice the upright count plus 3). The reading
then says so in its first note and carries `turns`; the photo flow turns its
crop corners with it. Box height and Box width describe the printed puzzle as
it stands upright, which is how a reading comes back once its turn is found
(or once Rotate has turned the photograph upright), so they apply as set: no
turned reading changes them, nor does Find grid, Rotate or the next
photograph, however it lies (Rotate swaps only the rows and columns of a grid
that is not square, which is never turned). A photograph read the way it lies
sideways, because its reading was not clearly better turned, gets them on its
sideways grid (Rotate turns it upright), as do the live camera's previews of a
sideways page. Boxes suggested from the grid size are that size's usual ones
(2 × 3 for 6 × 6), never transposed.

A half turn keeps upright-shaped glyphs, so a poor reading of upright-shaped
glyphs (median height/width above 1) takes a half-turn check instead. Read
upside down, a page's 0s, 1s and 8s still read as themselves, its 6s and 9s as
each other, most 2s as 4s and many 4s as 7s, all with confidence, but numbers
with a 2, 3 or 5 read with confidence only a 27th as often as on the same page
upright. So a poor reading with at least one confident digit and not one with
a 2, 3 or 5 is read once more through the crop turned half a turn, and that
reading is kept only when at least 5 of its confident numbers have a 2, 3 or 5
(`HALF_TURN_BAR`) and it reads clearly better: more confident digits than the
first reading, and at least 12 (`HALF_TURN_FLOOR`), or half its value regions
on a page with fewer. The second condition matters: some handwriting fonts
read an upright page's 8s, 3s or 5s as confident 3s and 5s upside down, so the
bar alone could turn an upright page. Whole-cell value boxes (a median of
exactly 1, as Kakuro entries have) say nothing of the glyphs and are not
checked. The reading then says the photograph was upside down and carries
`turns: 2`; the photo flow turns the crop corners two places and keeps the box
layout. Unlike a quarter-turned reading, it then waits for review: the photo
flow shows its note and does not solve it automatically however few cells are
flagged. "Half turns" in [OCR_QUALITY.md](OCR_QUALITY.md) has the
measurements. The live camera, targeted re-reads and non-square grids keep
their orientation; the live camera's help line says when a page looks sideways
or upside down, from the same cue, upside down only from five confident digits,
since no re-read confirms it there. A live capture handed to the editor is a
still photograph, though: when its live reading shows either cue, Review
captured clues highlights every digit under a note that the page may be turned
and reads the captured still again the same way; a reading taken turned
replaces the live one, under review like every capture, and one read the way it
lies gets its own warnings back ([LIVE_CAMERA.md](LIVE_CAMERA.md)).

A cage puzzle (Killer or KenKen chosen as the type) could take neither check:
every digit read on a cage board is under review, so its reading has no
confident digit to turn by, and its clues are cage sums, not value glyphs. It
takes a check of its own (`Scanner.cageTurn`), by the sums. Each sum is printed
in the top-left corner of its cage's top-left cell, which is where the reader
looks for it; a page lying turned puts every sum in another corner, mostly of
another cell, so it reads few sums. A sum counts when its cage can hold it
(`cageSum`: k distinct digits of a Killer cage sum to k(k+1)/2 to k(2n+1−k)/2,
a KenKen cage's target fits its operator and size), since the empty corners a
turned page offers still catch strokes that read as numbers. A reading with
such a sum in fewer than half its cages is read again in the other three
quarter turns, and the turned reading with the most is kept only when it reads
clearly better: at least 3 such sums (`CAGE_TURN_FLOOR`), sums in at least half
its cages, and more than twice as many as the first reading; a tie between two
turns keeps the first reading. The reading then names the turn in its first
note and carries `turns`, and like every cage reading it waits for review. The
three readings take several times the first one's time, and they count against
the 120 s a Read may take, past which the Read stops and keeps nothing. So the
check stops 90 s after the first reading began (`CAGE_TURN_BUDGET`, leaving the
rest for decoding the photograph): it stops the turned reading in progress and
keeps the first reading, as a Read without the check returns it. A turned page
whose upright reading finds sums in fewer than half its cages, or whose check
runs out of time, stays as it lies, its sums unread: turn it upright with
Rotate and Read again, and the upright reading is kept. Automatic detection
does not take this check (its cage readings come from per-cell clue strips and
were not measured turned). "Turned cage puzzles" in
[OCR_QUALITY.md](OCR_QUALITY.md) has the measurements.

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
queue. `photo-orientation.test.js`, `photo-half-turn.test.js` and
`scanner-orientation-recovery.test.js` cover a still photograph's own
quarter- and half-turn checks, `photo-cage-turn.test.js` a cage puzzle's check
by its sums (its time budget too), `photo-orientation-transactions.test.js` the
photo flow taking a turned reading. Camera lifecycle tests cover quality
guidance, recovery and manual capture.

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
