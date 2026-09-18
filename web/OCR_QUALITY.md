# OCR quality

How printed clues are read once the grid is found, what each mechanism was
measured to do, and the suites that keep it. Grid detection is in
[GRID_DETECTION.md](GRID_DETECTION.md), the live workflow in
[LIVE_SCANNING.md](LIVE_SCANNING.md), the suites' method in
[TESTING.md](TESTING.md).

Every recovery below is a proposal for review: it never draws replacement
strokes, substitutes numbers, or uses solver answers or fixture truth as OCR
evidence, and a recovered reading keeps its review flag even when the numeric
readers agree.

## Line mode for wide numbers, contrast normalization

Wide numeric crops are re-read as a single text line (PSM 7) rather than
excluded from re-reading; narrow crops keep character mode (PSM 10). Binary,
grayscale and atlas readings vote on the complete number, and disagreement
requires review. The 64-pixel sample height and white border stay: word mode
still shortened some `11` readings, and a 48-pixel sample regressed recognition.

Faded images with usable contrast receive black-level normalization before
ink and structural black-cell detection. The 0.1st percentile estimates the
black reference; the 99.5th percentile checks that at least 48 intensity
levels remain. Images with a black reference below 64 and nearly uniform
images are left untouched, and the white endpoint stays at 255 so shaded
Sudoku paper is not stretched. The photograph itself is not modified, and an
adjusted scan requires confirmation even with an explicit type.

The extra readings cost time on multi-digit boards. Grayscale rereads are
limited to scans with at most 150 numeric crops, under the cancellable workers
and deadlines every scan has.

Measured on the scanner before these two changes, in Chromium 153.0.8010.12
and WebKit 26.6 with the pinned runtimes. Counts are numeric clues; the common
34 scans combine two browsers, the two newspaper crops at original and half
resolution, blur and 35% contrast, and generated numbers in three font families
at original contrast, blur and 35% contrast.

| Measurement | Before | After |
| --- | ---: | ---: |
| Correct numeric clues, common cases | 866/892 | 885/892 |
| Correct generated numeric clues | 532/540 | 540/540 |
| Generated-clue review flags | 410 | 15 |
| Unflagged discrepant cells, common cases | 44 | 0 |
| Original newspaper clues, each engine | 44/44 | 44/44 |
| 35%-contrast Str8ts, Chromium | 14/20 | 20/20 |
| 35%-contrast Str8ts, WebKit | 14/20 | 19/20 |
| Black-cell positions at 35% contrast, each engine | 0/22 | 22/22 |

Half-resolution Str8ts still missed three numbered black clues in each engine,
all flagged. These are bounded regression measurements, not an accuracy
estimate for arbitrary photographs, handwriting or publisher layouts.

## Shaded cells and the automatic type

An explicitly selected Sudoku discards structural black metadata, so its final
puzzle alone could hide a shaded cell wrongly detected as black, which on the
faded newspaper crop could change an automatic proposal. Black-cell detection
therefore requires most interior pixels, as well as the cell mean, to fall
below the same adaptive darkness threshold: a dark printed digit cannot make
lighter shaded paper pass by lowering its mean. The quality suite observes the
unmodified geometry-worker black mask before classification, even for explicit
Sudoku, and scans the original and faded newspaper crops in automatic mode in
both engines. A reviewed `2`/`9` misreading in WebKit at 65% contrast is why
the degraded automatic cases allow one flagged numeric error, as the strong-fade
cases do; the normal-photo accuracy floor, exact black-cell geometry, correct
automatic family and zero unflagged discrepancies are still required.

## Fragmented printed marks

A narrow print or glare gap can split a glyph into pieces below the component
height threshold. The recognizer joins nearby, substantially aligned vertical
fragments inside one numeric crop, smallest gaps first, and keeps the complete
bounding box, so a short cap or foot beside a taller body and a fragmented
trailing digit beside a connected leading digit survive. Grouping requires
substantial ink, horizontal overlap and a short member in each pair, bounds
the total height and the gap, and considers at most 24 candidate components;
speckles, remote marks and two intact neighbouring digits stay separate. A
joined crop is `recoveredMark` and reviewed. When several substantial glyphs
share one numeric line the crop uses line mode even when narrow, since two
slim glyphs can pass the aspect test for a single character.

`web/tests/recognition-fragments.test.js` covers both ink polarities, unequal
and three-piece glyphs, trailing digits, intact narrow numbers, speckle and
remote-mark rejection, review flags and sample routing;
`web/tests/fragmented-clues.test.js` keeps a missed reading red in the live
preview rather than a blue answer slot. `scripts/recognition_fragments_regressions.cjs`
runs eight fixtures through the production scanner and real Tesseract in
Chromium and mobile WebKit, requiring complete crops, intact control clues,
the black-cell layout and zero unflagged errors: damaged clues must stay
complete, marked and reviewable, not become perfectly readable.

## Truncated multi-digit readings

Preparation keeps the absolute boxes of two or three separately located,
non-overlapping glyphs in a numeric crop, left to right. The count is a lower
bound on the number's length, since touching digits share a component, so a
longer reading is never shortened to match it. Whole-number recognition runs
first; only when no isolated whole-crop reading is at least the detected
length are the glyphs read one at a time, each from a grayscale crop padded to
the midpoint of the empty gap so a neighbour cannot leak in. At the voting
boundary a complete existing alternative is preferred to a truncated majority,
marked `lengthRecovered` with confidence zero; a proposal assembled from
per-glyph reads requires every glyph to return exactly one numeric character
and is marked `segmentedRead`, also at confidence zero. Even unanimous
whole-number readings stay uncertain when shorter than the glyph count.

The per-glyph reads share the 24-extra-read ceiling with the raw-line retries,
which run first in their original order. Preparation is capped at 72 glyph
crops per scan and disabled above the 150-clue grayscale limit; exact-image
caching and cancellation apply. `ocrStats.segmentReads` counts attempted
per-glyph reads including cache hits.

`web/tests/ocr-segments.test.js` and `ocr-length-floor.test.js` cover the
geometry, crop pixels in both polarities, malformed input, budgets, evidence
precedence, review, cache ownership and cancellation.

## Compressed numeric clues

A narrow `7` can read as `1`, and a compressed multi-digit clue can lose parts
even after the per-glyph fallback. Narrow value and black-value crops with
intact extraction geometry (not fragment-recovered crops, labels or signs) are
also read from two horizontal resamplings of the padded grayscale sample, at
1.5x and 2x, in single-line mode. A correction requires both scales to return
the same bounded numeric string with a score of at least 75 each, a heuristic
cutoff. The two readings are correlated, so they take no part in majority
voting and can never certify each other as confident; they change only an
already uncertain reading, cannot lengthen or shorten a full-length one, and
yield to a longer existing alternative. An accepted change is
`aspectRecovered` with confidence zero.

Width retries use what remains of the same 24-extra-read budget after the
raw-line and per-glyph retries, both reads of a pair must fit before it starts,
and cancellation or an error during either read emits nothing. Packing is
capped at 48 aspect variants (24 pairs) with bounded canvas sizes and PNG
lengths, and boards above the 150-clue limit pack none. `ocrStats.aspectReads`
counts attempts including cache hits, `calls` counts engine work.

`web/tests/ocr-aspect.test.js` and `ocr-aspect-host.test.js` cover eligibility,
unchanged source canvases, evidence precedence, scores, duplicate and malformed
results, packing limits, retry priority, cache ownership and cancellation.

## Acceptance suites

`scripts/ocr_quality_regressions.cjs`, run by `newspaper_regressions.cjs` and
by the Scanner quality workflow, scans the newspaper crops and generated one-,
two- and three-digit clues at 35% and 65% contrast, half resolution and blur,
with two font, size and position cases held out from candidate selection. It
requires exact black-cell geometry, zero unflagged discrepancies, minimum
correct counts, bounded numeric review flags and the confirmation warning when
contrast is adjusted; raw measurements are kept in
`browser-artifacts/ocr-quality.json`.

`scripts/recognition_segments_regressions.cjs` compares the production scanner
with a pinned baseline scanner in the same browsers and fonts: 26 narrow-number
cases that must be transcribed exactly, twelve held-out FreeSans and FreeSerif
cases, and every cell of the 66 quality cases, rejecting any newly lost
correct cell or unflagged discrepancy even where the minimum-accuracy gate
would allow a flagged error. The fixtures share their variations with the
quality suite so they cannot drift apart.

These suites use known corners and mostly generated print. They are regression
controls, not an accuracy estimate for unseen photographs or handwriting, and
they do not measure grid detection. Tesseract's own guidance on segmentation
and preprocessing: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
