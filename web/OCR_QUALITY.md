# OCR quality

How printed clues are read once the grid is found, what each mechanism was
measured to do, and the suites that keep it. Grid detection is in
[GRID_DETECTION.md](GRID_DETECTION.md), the live camera in
[LIVE_CAMERA.md](LIVE_CAMERA.md), the suites' method in
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

`scripts/ocr_quality_regressions.cjs`, run by the Scanner quality workflow on
pull requests and by the deployment gate on pushes, scans the newspaper crops
and generated one-, two- and three-digit clues at 35% and 65% contrast, half
resolution and blur, with two font, size and position cases held out from
candidate selection. It requires exact black-cell geometry, zero unflagged
discrepancies, minimum correct counts, bounded numeric review flags and the
confirmation warning when contrast is adjusted; raw measurements are kept in
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

## KenKen and Killer cages

An explicit cage type is partitioned in the geometry worker
(`cagePartition`). Every interior cell edge is measured by thin strips
parallel to it. A Killer board, or a KenKen board printed in the Killer style,
splits where both neighbours show dashed-outline ink 6-12% inside the cell; a
KenKen board with at least two thick lines (the central 4% of the edge at most
0.35 of the paper's gray) splits at the thick lines instead. Killer's thick
3 x 3 box lines are never cage borders. Each cage's clue is read from its head
(top-left) cell: inside the dashed outline, or in the corner of a thick-bordered
cell, from a crop binarized at its own Otsu threshold, in the atlas. Every cage
stays under structural review ("check cage"), and an operator impossible for
the cage's size still drops it with a note.

The corpus gained a thick-bordered KenKen set for this (`janko-kenken-thick`).
Measured with `scoreVersion: 3` on the four cage sets (Chromium, 2026-09-28),
cages right before → after: dashed KenKen 0 → 1,108 of 2,508, thick KenKen 4 →
1,451 of 2,508 (its 13 boards that failed to read now read), janko Sumdoku
0 → 1,244 of 2,139, generated Killer 0 → 1,961 of 3,234; unflagged errors stay
0 and every cell of a cage board is highlighted, as before. Partitions alone are
exact on 359 of 360 dashed boards and 103 of 107 thick ones; the clue reading
is what is left (clean 69-93%, print 60-85%, perspective photo renders 9-24%),
with KenKen's "/" often read as "+". Nothing is claimed for real photographs,
which the corpus does not have for these families. Reading a board costs
between 80 ms less and 40 ms more than before (median per board, four sets),
since one clue region per cage replaces one per cell.

## Unread Futoshiki signs

Tesseract reads few inequality signs: on the corpus's 121 Futoshiki images
only 85 of 1,305 printed signs read as `<`, `>`, `^` or `v`; the rest reach the
reader as a region that reads as nothing, a digit or an operator. Such a region
used to be dropped, so the puzzle lost a constraint without a flag (1,187
unflagged errors). Now both cells of every sign region that did not read as a
sign go to structural review (`cageUncertain`), with a note giving the count;
Futoshiki readings already need review before solving. Structural review is
drawn like digit review, blocks Solve behind the same confirmation, and is
kept by sessions and backups, but it does not call the digits doubtful: the
guided digit review skips it and the cell reads "check sign". The highlights
stay until the transcription is confirmed, even after a sign is saved with
Inequality under Editing (a cell can border another unread sign), and they
survive re-applying Futoshiki; changing to another family clears them.

Measured with `scoreVersion: 3` on all 121 images (Chromium, 2026-09-28):
unflagged errors 1,187 → 0, flagged empty cells 96 → 1,924 of 3,823, flagged
correct clues 130 → 264; the median board goes from 0-4% to 48% of its cells
highlighted (at most 72%), 14-16 of them for signs. Almost all of that marks a
printed sign that really was not read: only 29 sign regions sit where no sign
is printed.

Each sign region now also gets a geometric reading (`readChevron`, in the
geometry worker): along the sign's axis the ink's cross-extent grows from the
apex to the open end, so a least-squares slope gives the apex side, which
points at the smaller cell. Only clear shapes count (ink at 8 or more
positions, the open end at least 1.6 times the apex end, a slope of at least
0.15); a clear chevron reads the sign, otherwise a sign-shaped OCR reading
does, otherwise the region stays unread. Every sign, read or not, stays a
proposal in structural review on both of its cells ("check sign"), so no
reading of a sign is ever unflagged; the note counts the signs read for
checking and the ones that could not be read. The automatic type still counts
OCR signs only. On the 120 rendered boards (clean, print and perspective
photo variants) all 1,293 printed signs are proposed right (the OCR proposed
82), none wrong or invented; correct clues go from 777 to 1,988 of 1,989
(the last is a flagged digit misread) and 119 of 120 boards read perfectly,
while the highlighted share stays at 48% since every sign is still for the
user to confirm. The corpus's only real Futoshiki photograph has no detected
grid, so its misplaced regions give 2 right, 2 wrong and 6 invented signs, all
flagged: nothing is claimed for real photographs yet. 144 `readChevron` calls
(a 9 x 9 board) take 1-2 ms.

## Pencil candidate notes

Screenshots and photographs of puzzles in progress carry pencil candidate
notes, and the reader proposed them as givens: on the real-photo corpus they
were the largest source of unflagged errors after detection failures. A value
glyph under 0.4 of the grid's own clue height (the 75th percentile of its value
glyphs) is a note: its cell gets no digit and stays under review as an unread
cell, so a clue in an unusually small hand or font is lost to review, never
silently. Grids with fewer than four value glyphs have no norm.

Measured on the corpus with `scoreVersion: 3` (Chromium, 2026-09-28):

| | Before | After |
| --- | ---: | ---: |
| Unflagged errors | 8,397 | 7,701 |
| Invented clues | 19,932 | 13,657 |
| Correct clues | 107,539 | 107,548 |
| Perfect readings | 1,357 | 1,416 |
| Flagged empty cells | 28,137 | 34,412 |

The removed inventions become flagged empty cells. Half the clue height, or an
extra small-and-off-centre test, also took handwritten answers and clues in
misaligned cells (up to 267 correct clues in one set) and were rejected; 0.4
loses at most 26 in any set. Removing note regions changes the OCR atlas, so
other cells' votes can change as well; the totals include that. The rule is
covered by `web/tests/candidate-notes.test.js`.

## Faint and coloured digits on dim photographs

A printed digit that the page-wide ink mask misses gets a second look in its
own cell, with a local threshold and shape tests, and a mark found there is
always reviewed (`recoveredMark`). That look used to require the cell's paper
to be at least 150, which a dim photograph's paper never is, so faint print,
red or pink print and digits on shaded boxes there fell through as empty cells
without a flag. The gate now follows the page: three quarters of its
80th-percentile gray, never above 150, so bright pages (and shaded panels on
them) keep the old behaviour. When the luminance look finds nothing and the
cell's darkest pixels are strongly coloured, the same look runs on the darkest
channel, in which coloured print is dark.

Measured on the whole corpus with `scoreVersion: 3` (Chromium, 2026-09-28, 3,853
read images): unflagged errors 7,597 → 7,536, missed clues 25,200 → 25,139,
correct clues 108,003 → 108,018; flagged empty cells 34,335 → 34,343 (23.05% →
23.06% of empty cells), invented clues and perfect readings unchanged. The new
atlas regions also change three other cells' votes to agreement on a wrong
digit. `web/tests/ink-recovery.test.js` covers the dim page, the bright page,
a shaded panel on a bright page, pale coloured print, and grainy or coloured
empty cells.

## Alternatives tried

A 26,731-parameter printed-digit network (two 3x3 convolutions and two dense
layers, trained on 24,200 synthetic crops in three font families) was measured
as a possible single-digit reader. It read 3,863 of 4,000 held-out generated
digits in unseen font families and rejected 380 of 400 non-digits, but 11 of
its 3,233 answers scored at least 0.99 were still wrong, so a high score was
no permission to accept a clue. On crops from the two repository photographs
in five variations it read 216 of 220 printed clues, with one false digit. The
app never used it: neither phone performance nor an improvement over the
Tesseract readers above was established. The prototype was removed on
2026-09-25; its code, training script and full measurements remain in git
history under `experiments/tiny-digit-cnn/` (last present at commit e7eced2).
