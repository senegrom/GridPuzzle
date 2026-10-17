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
cell, from a crop binarized at the Otsu threshold of its clue box, in the
atlas. Every cage
stays under structural review ("check cage"), and an operator impossible for
the cage's size still drops it with a note.

The corpus gained a thick-bordered KenKen set for this (`janko-kenken-thick`).
Measured with `scoreVersion: 3` on the four cage sets (Chromium, 2026-09-28),
cages right before → after: dashed KenKen 0 → 1,108 of 2,508, thick KenKen 4 →
1,451 of 2,508 (its 13 boards that failed to read now read), janko Sumdoku
0 → 1,244 of 2,139, generated Killer 0 → 1,961 of 3,234; unflagged errors stay
0 and every cell of a cage board is highlighted, as before. Partitions alone are
exact on 359 of 360 dashed boards and 103 of 107 thick ones; the clue reading
is what is left, with the dashed set's ÷ mostly read as "+". Nothing is claimed
for real photographs, which the corpus does not have for these families.
Reading a board costs between 80 ms less and 40 ms more than before (median per
board, four sets), since one clue region per cage replaces one per cell.

The clue crop was at first thresholded with its white margin counted, which
turned a clue on grey paper to solid ink, paper and all. Thresholding the clue
box alone (2026-09-29) raised cages right on the perspective photo renders of
the four sets from 461 to 1,767 of 3,463 (13% → 51%) and on the print renders
from 2,461 to 2,594, left the clean renders level (2,842 → 2,840), and kept
unflagged errors at 0.

The OCR then still read a clean ÷ as "+" in 94 of 116 division clues and
dropped the hyphen in 61 of 148 clean subtraction clues, and a clue without an
operator counts as a sum. A KenKen clue's operator now comes from the shape of
its last glyph (`cage-operator.js`): two crossing strokes, two diagonals, one
short bar, a dot, a bar and a dot, or one long diagonal, read only close behind
a digit, with a blurred ÷ recognised where the ink's darker half parts its dots;
anything unclear leaves the OCR's operator. Operators right on the two KenKen
sets rose from 3,865 to 4,547 of 5,008 clues (683 fixed, 1 broken), cages right
from 3,118 to 3,539 of 5,016, while Sumdoku, all sums, lost one cage of 2,139
(two clues misread on photo renders) and Killer Sudoku, whose clues are never
shape-read, is unchanged. It costs a KenKen board about 2-5 ms.

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

## Note-sized digits that were read

Candidate notes just above that cut are read, confidently, as clues: on app
screenshots they were the largest class of unflagged errors left under
`scoreVersion: 4`. After the OCR, the reader now highlights a value digit
shorter than 0.54 of the grid's clue height and keeps the digit, and a review
note says such digits may be pencil or app notes. The clue height here is the
75th percentile of the digits read (the value regions whose cell holds a digit
after the range check, at least six of them). Taken over every value region
before the OCR, regions that read nothing and note-heavy grids skew it: the same
cut flags 49 correct clues instead of 39 and catches 260 errors instead of 266.
A digit highlighted only for its size still counts as read clearly when
`Scanner.orient` weighs a quarter or a half turn.

Measured on the whole corpus with `scoreVersion: 4` (Chromium, 2026-10-02),
against master 7f6269a: the baseline above with #118's re-reads of
val-mmabi8yfe8yc1, val-yv5yemlk4ncc1 and image1000.original. 3,965 of the 3,978
images read exactly as before. On them, the flags change exactly as predicted
from the per-cell records, except for val-yv5yemlk4ncc1, which failed to read
when the records were taken. The other 13 images are of two kinds:

- Eleven EXIF-rotated photographs have baseline rows from before the benchmark
  decoded photographs as the photo flow does. They read the same with and
  without the flag.
- Two are Hidato 266 renders, whose known transient OCR failure moved from one
  variant to another. Re-read three times on each build, every variant reads all
  27 clues.

Unflagged errors fall from 1,169 to 901. Like for like, it is 1,167 to 901: two
of the 1,169 are in the eleven stale rows.

The flag catches 266 unflagged errors: 257 note-sized inventions, 8 wrong
digits and 1 digit read from a neighbouring clue. 263 of them are in
lexski-mixed, that is, app screenshots and photographs of app screens. It flags
40 correct clues:

| Image class | Unflagged errors caught | Correct clues flagged | Share of correct unflagged clues |
| --- | ---: | ---: | ---: |
| Light screenshots | 208 | 16 | 0.05% |
| Dark screenshots | 15 | 0 | 0% |
| Photographs, lexski-mixed | 40 | 1 | 0.03% |
| Photographs, other sets | 3 | 20 | 0.18% |
| Renders | 0 | 3 | 0.01% |

Most false flags fall where the detected corners are off. In the per-cell
records, boards within 0.1 cell of the target outline have 2 false flags in
55,985 correct clues, boards 0.1-0.2 cell off have 11 in 3,066, and boards
further off have 17 in 431. The exception is 9 false flags on boards without
target corners: 8 are on wichtounet-solved, handwritten answers or faint print
on aligned grids, and 1 is on rozet-handwritten. val-yv5yemlk4ncc1, 0.6 cell
off, adds the 40th. 26 of the 40 were viewed by eye: 18 sit on misaligned grids
and 8 on broken glyphs. No perfect Sudoku or Latin square reading without a
flag gains one, so no automatic solve is lost.

0.54 is the cut chosen on held-out halves of the corpus: over 1,000 random
splits in each direction, a 0.01 grid picks 0.53 or 0.54 in 1,761 of 2,000. A
cut of 0.55 catches 3 more for 10 more false flags. A cut of 0.6 catches 15 more
for 59 more, mostly on photographs.

The rule misses two kinds of error:

- **23 unflagged inventions drawn at clue size.**
  - 7 are whole-cell regions on Kakuro and Hidato renders.
  - 4 sit on two rozet-handwritten photographs whose targets are swapped.
  - The other 12 are mostly player entries. No colour, weight or size rule
    separated them cheaply.
- **554 unflagged missed clues**, which have no region to judge.

The rule is covered by `web/tests/candidate-notes.test.js`, and its effect on
the turn by `web/tests/photo-orientation.test.js`.

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

## Benchmark readings as the photo flow takes them

The corpus benchmark used to read each image at full size and, when detection
was below 0.5, through the whole frame. The app does neither. The photo flow
decodes a photograph to a preview of at most 1600 px on its long side, detects
the grid there, pre-places the detector's corners whatever its confidence, and
at 0.8 or less asks for the corners to be set; read through them unchanged, it
highlights every cell. It reads a larger original from its grid region at up to
1800 px (`photoDetail`). `corpus/benchmark.cjs` now reads the same way, through
the production `retainPhotoSource` and `photoDetail` (`scoreVersion: 4` in
`corpus/SOURCES.md`), so its unflagged errors are ones a user can meet, and a
detection miss shows its real cost: a reading with every cell to check.

Since PR #121 the runner also decodes each photograph through the app's own
import (`importPhoto` in `web/photo-import.js`, with its EXIF sizing) instead of
its own loader. That changes 84 previews from the baseline below: the 19
EXIF-rotated JPEGs are read at 4/3 of their earlier preview size (11 of them no
longer from the original's detail), and 65 images shift by one pixel. The
scorer and `scoreVersion` are unchanged by it; a report's `harness` records the
loader as `load: "importPhoto"`. Their effect on the version 5 baseline is
measured further down.

The master baseline under this harness (Chromium, 2026-09-29, 1bf5e21, all 3,978
images; the 249 images larger than the preview all read through the original's
detail):

| set | images | clues right | unflagged | perfect | grid found | read through unconfirmed corners | failed to read |
|---|---:|---:|---:|---:|---:|---:|---:|
| futoshiki/janko-futoshiki | 120 | 1,988 / 1,989 | 0 | 119 | 120 | 0 |  |
| futoshiki/newspaper-photo | 1 | 4 / 15 | 0 | 0 | 0 | 1 |  |
| hidato/janko-hidato | 120 | 3,090 / 3,162 | 14 | 106 | 120 | 0 |  |
| kakuro/janko-kakuro | 111 | 3,381 / 5,315 | 123 | 19 | 106 | 0 | 5 |
| kenken/janko-kenken | 120 | 1,571 / 2,508 | 0 | 1 | 120 | 0 |  |
| kenken/janko-kenken-thick | 120 | 1,968 / 2,508 | 0 | 7 | 120 | 0 |  |
| kenken/janko-killersudoku | 120 | 1,572 / 2,139 | 0 | 21 | 120 | 0 |  |
| killersudoku/generated-render | 120 | 2,510 / 3,234 | 0 | 29 | 120 | 0 |  |
| latinsquare/generated-render | 120 | 1,815 / 1,818 | 0 | 117 | 120 | 0 |  |
| numbrix/generated-render | 120 | 1,429 / 1,449 | 9 | 117 | 120 | 0 |  |
| slitherlink/janko-slitherlink | 111 | 6,940 / 8,691 | 0 | 85 | 91 | 20 |  |
| str8ts/janko-str8ts | 120 | 1,578 / 1,587 | 0 | 111 | 120 | 0 |  |
| sudoku/generated-render | 120 | 2,704 / 2,706 | 0 | 118 | 120 | 0 |  |
| sudoku/janko-sudoku | 111 | 4,507 / 4,509 | 0 | 109 | 111 | 0 |  |
| sudoku/kuleuven-assistant | 83 | 2,061 / 3,851 | 120 | 9 | 39 | 44 |  |
| sudoku/lexski-mixed | 1398 | 49,225 / 59,731 | 565 | 398 | 1139 | 257 | 2 |
| sudoku/rozet-handwritten | 400 | 15,435 / 17,821 | 141 | 89 | 388 | 12 |  |
| sudoku/rozet-newspaper | 9 | 246 / 250 | 0 | 5 | 9 | 0 |  |
| sudoku/rozet-render | 100 | 2,285 / 2,498 | 12 | 57 | 100 | 0 |  |
| sudoku/wichtounet-newspaper | 203 | 4,577 / 5,902 | 64 | 44 | 194 | 9 |  |
| sudoku/wichtounet-originals | 46 | 1,260 / 1,302 | 7 | 32 | 45 | 0 | 1 |
| sudoku/wichtounet-solved | 200 | 9,122 / 16,200 | 108 | 0 | 155 | 45 |  |
| sudoku/wichtounet-solved-extra | 5 | 253 / 361 | 2 | 0 | 4 | 1 |  |
| all | 3,978 | 119,521 / 149,546 | 1,165 | 1,593 | 3,581 | 389 | 8 |

Eight readings failed there. Five Kakuro photo renders read no clues. Three
photographs larger than the preview (two lexski, one of wichtounet's originals)
stopped with "Keep the four crop corners clockwise without crossing": their
detected corner lies on the frame's edge, and `photoDetail` mapped it up to half
a pixel outside the scaled-down detail image, so the app failed on them the same
way. `detailPlan` now keeps the corners inside the detail, and the three read:
lexski val-mmabi8yfe8yc1 2 of 58 clues through unconfirmed corners (every cell
highlighted), lexski val-yv5yemlk4ncc1 14 of 42 with 4 unflagged errors (found
at 0.94 with its corners off by 5% of the grid's diagonal), and wichtounet's
image1000 all 26, perfectly. The other 246 larger photographs read exactly as
before, so the totals become 119,563 of 149,672 clues right, 1,169 unflagged
errors, 1,594 perfect readings and five failures.

On the 587 images the change can affect (a long side over 1600 px, or detection
at 0.8 or less), the old and new harness read the same build: clues right 13,544
→ 16,238 and perfect 96 → 92, while unflagged errors fell 5,259 → 75 and flags
on correct clues rose 4,372 → 9,278. That fall is the harness now counting the
photo flow's all-cell review (#104) of a read through unconfirmed corners, not a
better reader. The unflagged errors left are on lexski photographs above 1600 px
whose grid is found (68) and wichtounet's originals (7). Reading through the
original's detail instead of the preview changes the 249 larger images from
9,309 to 9,319 correct clues and 85 to 75 unflagged errors, three of them
failing as above. On 100 other images, chosen at random, the two harnesses agree
image for image except one Hidato render whose OCR returned 2 of its 27 clues in
the first run; it reads all 27, perfectly, in every further read under each
harness, so that was a transient OCR failure, not the harness.

## Readings at another size than the detector found

A confident detection proposes the size of the lattice it found, and the photo
flow adopts it. Sometimes the user corrects the size, or the puzzle type cannot
take the size found, and the grid is then read at another size through the same
corners. When the detector's frame is off, as with a 10 x 9 or 8 x 8 lattice
found on a 9 x 9 grid, the cell windows miss their digits and come back as
confident blanks. Under `scoreVersion: 4`, with the corrected rozet-handwritten
targets of #123, such boards held 403 of the 518 unflagged missed clues. The
photo flow now highlights every cell of a reading at another size through
corners nobody moved, as for unconfirmed corners. A note names both sizes and
says that moving any corner confirms the crop. A live capture reviewed on the
board counts as found at the size the live camera read it. `scoreVersion: 5`
models this (`corpus/SOURCES.md`).

Measured on the whole corpus with `scoreVersion: 5` (Chromium, 2026-10-04,
master 6bcdcc8 with this change). The comparison is with the same readings under
version 4: #122's full-corpus run, with the two rozet photographs re-scored.
- Every reading is the same, except one known transient OCR failure: Hidato 266
  read 2 of its clues on the version 4 side and all 27 here.
- Flags change only on the 64 boards where the detector's lattice has another
  size than the target's.
- Those boards held 617 of the 846 unflagged errors. 63 of them have per-cell
  records, and their 613 errors split into 403 missed clues, 93 wrong or
  invented digits and 117 Kakuro clue errors.
- Unflagged errors fall from 846 to 229.

The cost is 216 correct clues and 1,438 empty cells newly flagged:

| Image class | Boards | Unflagged errors caught | Correct clues newly flagged | Share of correct unflagged clues | Empty cells newly flagged |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light screenshots | 13 | 124 | 75 | 0.23% | 220 |
| Dark screenshots | 8 | 81 | 29 | 3.68% | 84 |
| Photographs, lexski-mixed | 6 | 29 | 68 | 2.00% | 69 |
| Photographs, other sets | 26 | 239 | 44 | 0.40% | 419 |
| Renders | 11 | 144 | 0 | 0% | 646 |

50 of the 64 boards held unflagged errors before. Of the other 14, 11 carry cost
and no gain: 115 correct clues and 589 empty cells newly flagged. On four of
them the frame is right and only the count is wrong:
- The clean, photo and print renders of janko-kakuro-0152: 14 x 23 found for
  14 x 24, with 515 empty cells newly flagged.
- lexski val-gcini43qtm8c1: 3 x 3 found on a 9 x 9, with 60 correct clues and 19
  empty cells newly flagged.

No perfect Sudoku or Latin square reading without a flag gains one, so no
automatic solve is lost.

The `scoreVersion: 5` master baseline is below (Chromium, all 3,978 images). It
includes the note-sized flag and the corrected rozet-handwritten targets of
sudoku_0270 and sudoku_0271 (#123). "Grid found" counts confident detections.
The 64 boards read at another size are also counted as read through unconfirmed
corners. The whole corpus was read on 2026-10-04 through the runner's own
loader. The 84 images whose previews PR #121's `importPhoto` changes were then
read again through the import, on master d0222a4 (2026-10-06), and the table has
their new rows. The same run read a control of 108 unchanged images, up to five
from each set, and every one read exactly as before. The twelve images whose
still-photo detection the settling check changes (`web/GRID_DETECTION.md`,
"Settling the corners") were read again with it on 2026-10-13, and the table has
their new rows too; see the end of this section. The two photographs stored
upside down, wichtounet image1083 and its original, were read again with the
half-turn check on 2026-10-16 (and again, identically, with its final rule on
2026-10-17), and the table has their new rows as well; see "Half turns".

| set | images | clues right | unflagged | perfect | grid found | read through unconfirmed corners | failed to read |
|---|---:|---:|---:|---:|---:|---:|---:|
| futoshiki/janko-futoshiki | 120 | 1,988 / 1,989 | 0 | 119 | 120 | 0 |  |
| futoshiki/newspaper-photo | 1 | 4 / 15 | 0 | 0 | 0 | 1 |  |
| hidato/janko-hidato | 120 | 3,115 / 3,162 | 0 | 107 | 120 | 1 |  |
| kakuro/janko-kakuro | 111 | 3,378 / 5,315 | 0 | 19 | 106 | 8 | 5 |
| kenken/janko-kenken | 120 | 1,571 / 2,508 | 0 | 1 | 120 | 0 |  |
| kenken/janko-kenken-thick | 120 | 1,968 / 2,508 | 0 | 7 | 120 | 0 |  |
| kenken/janko-killersudoku | 120 | 1,572 / 2,139 | 0 | 21 | 120 | 0 |  |
| killersudoku/generated-render | 120 | 2,510 / 3,234 | 0 | 29 | 120 | 1 |  |
| latinsquare/generated-render | 120 | 1,815 / 1,818 | 0 | 117 | 120 | 0 |  |
| numbrix/generated-render | 120 | 1,429 / 1,449 | 2 | 117 | 120 | 1 |  |
| slitherlink/janko-slitherlink | 111 | 6,938 / 8,691 | 0 | 85 | 91 | 20 |  |
| str8ts/janko-str8ts | 120 | 1,578 / 1,587 | 0 | 111 | 120 | 0 |  |
| sudoku/generated-render | 120 | 2,704 / 2,706 | 0 | 118 | 120 | 0 |  |
| sudoku/janko-sudoku | 111 | 4,507 / 4,509 | 0 | 109 | 111 | 0 |  |
| sudoku/kuleuven-assistant | 83 | 2,061 / 3,851 | 1 | 9 | 39 | 56 |  |
| sudoku/lexski-mixed | 1398 | 49,269 / 59,831 | 72 | 400 | 1140 | 285 |  |
| sudoku/rozet-handwritten | 400 | 15,543 / 17,821 | 20 | 89 | 388 | 22 |  |
| sudoku/rozet-newspaper | 9 | 247 / 250 | 0 | 6 | 9 | 0 |  |
| sudoku/rozet-render | 100 | 2,285 / 2,498 | 12 | 57 | 100 | 0 |  |
| sudoku/wichtounet-newspaper | 203 | 4,633 / 5,902 | 31 | 47 | 194 | 10 |  |
| sudoku/wichtounet-originals | 46 | 1,289 / 1,328 | 0 | 35 | 45 | 1 |  |
| sudoku/wichtounet-solved | 200 | 9,125 / 16,200 | 74 | 0 | 155 | 48 |  |
| sudoku/wichtounet-solved-extra | 5 | 253 / 361 | 2 | 0 | 4 | 1 |  |
| all | 3,978 | 119,782 / 149,672 | 214 | 1,603 | 3,582 | 455 | 5 |

The five failures are the Kakuro photo renders that read no clues.

Read through the import, the 84 changed images have 33 fewer clues right and 2
more unflagged errors than through the runner's loader (119,693 and 229 before):
- The 65 one-pixel shifts change 47 readings: 12 more clues right, no change in
  unflagged errors, and one more perfect board.
- The 11 rotated JPEGs no longer read through the original's detail lose 21
  clues right and gain 2 unflagged errors net. wichtounet-newspaper image1024
  shows its page sideways even after the EXIF turn. Read straight from its
  1,280 px preview, it yielded 39 value regions instead of 24, 18 of them thin
  slivers like gridline pieces, and the sideways reading stayed: 0 of 24 clues
  right, with 2 unflagged errors. The cause was the detector's quad, not the
  reading. A band of halftone grey printed beside the grid's left border put
  the quad's left side a fifth of a cell outside the grid, at 960 px as at
  1,280 (a 1% corner error in both rows; `web/GRID_DETECTION.md`, "Settling
  the corners"). Through that quad the border and the next three lines crossed
  the cell windows of the first four columns as the slivers, and at their full
  height they made the pencil guard (#105) drop two of the sideways clues.
  Turned a quarter, the page read 23 of its 24 clues right (its bottom row was
  cut short, and a 6 read as 0), yet only 7 counted as confident where the
  check needs 8: 15 were read through cell bounds refined around the shifted
  lines, which are always flagged, and one had a split vote. Through the old
  960 px detail 9 were confident (23 right, 14 of them flagged), just enough.
  Dropping the slivers before the check would not have helped: the upright
  reading's 2 confident digits set the bar at its floor of 8 either way. With
  the settling check the quad sits on the border, the page is turned, and all
  24 clues read right, one of them flagged.
- The 8 rotated wichtounet originals, now with a 1,600 px preview instead of a
  1,200 px one, lose 24 clues right. At the larger size the detector no longer
  finds the grid of image1036, so its 26 correct clues become a reading with
  every cell highlighted.

The settling check can change only the 45 images on which some settling's
second warp puts an outer line more than a tenth of a cell from the tightened
quad (the whole corpus, detection only); every other detection is unchanged by
construction. Those 45 and a control of 107 others (the control above, less
one of the 45) were read through the import on master 7e4420a, where all 152
rows match the table's rows exactly, and again with the check (Chromium,
2026-10-13, and on 2026-10-14 with its inward-only rule, which changes none of
them). The control reads the same. Twelve of the 45 change. No image reads
fewer clues right or gains an unflagged error, but counted cell by cell 87
clues become right and 18 that master read right no longer are:

| | clues right | unflagged | perfect | turned |
|---|---:|---:|---:|---:|
| the 45, master | 1,261 / 1,848 | 13 | 4 | 2 |
| the 45, with the check | 1,330 / 1,848 | 11 | 9 | 3 |

- image1024 reads all 24 clues, turned; its original reads 24 of 24 instead of
  23 and is turned as before; the same photograph stored upright (rozet
  empty_0020) reads 24 of 24 instead of 23. The one new turn is the right one,
  and no turn is lost.
- Three more pictures: image1004 reads 25 of 25 (23 before) and its original
  25 of 25 (24); image1087 reads 25 of 26 (22) with 2 invented digits instead
  of 20, and its original 24 of 26 with 3 instead of 19; rozet-handwritten
  sudoku_0123 reads 42 of 46 (18).
- Two lexski screenshots: val-gka96q36bvec1, a 3 x 3 detection read with every
  cell flagged, reads 38 of 51 (32), and val-n392q2ui6jxc1 39 of 39 (35). In
  the aligned cells of the second, 11 more of the app's candidate notes read
  as digits, all highlighted by the note-size flag (#122), and 26 fewer empty
  cells are highlighted.
- The wichtounet-solved pictures of image1024 and image1087, whose targets are
  whole handwritten solutions: image1024 reads 52 of 81 as before, with 6
  digits gained and 6 lost (3 more read wrong, 3 fewer missed), and image1087
  52 instead of 49, with 6 gained and 3 lost, all flagged.

The 18 clues lost lie on 5 of the 12 images, and each of the 5 gains at least
as many as it loses. All 18 are flagged with the check (11 now missed, 7 read
wrong), and 17 of them were flagged on master too:
- val-gka96q36bvec1: 6 of the app's printed clues (r1c6 4, r1c8 7, r2c6 1,
  r5c2 1, r7c7 4, r8c5 1), against 12 gained. Three of them are 1s: no glyph
  rule changed, but through the moved quad these thin glyphs go unread.
- image1087 and its original: the printed 3 at r4c8 on both and the 7 at r4c0
  on the original, now missed, against 4 and 2 gained.
- The two solved pictures: 9 handwritten digits, one of them a 1, against 12
  gained. The 5 at r4c4 of image1087 is the one lost clue master read
  confidently; it is now a flagged 1.

Against 87 clues gained, 2 fewer unflagged errors and 5 more perfect boards,
these 18 flagged losses were judged worth it.

The whole corpus was also detected in the other three quarter turns the Rotate
button gives, with the check before its inward-only rule (9b77125, which takes
the same placements there), and every image whose detection the check changes
was read. Turned a quarter either way, 22 readings change: 402 to 641 clues
right and 20 to 3 unflagged errors, with no false turn. Upside down, 14
readings change: 127 to 147 right, but 36 to 40 unflagged errors, every new
one a 6 read as 9 or a 9 as 6. Neither build checks for a half turn: the
orientation check runs only when glyphs are wider than tall, so both read
these pages upside down, and the better-placed quad reads their 6s and 9s with
more confidence. The half-turn check ("Half turns", below) now turns six of
the twelve of them that are upside down, and the 14 hold 13 unflagged errors
instead of 40. In WebKit, 249 previews detected in all four turns take 7
placements, none farther from the target corners, and wichtounet-originals
image1024 reads 24 of 24 instead of 3 turned the wrong way. No Kakuro, Killer,
Str8ts, Slitherlink, Futoshiki or other non-Sudoku image changes in any of
these runs.

The 45 and lexski test-k26kolm0b01d1, which takes a placement only when
decoded with Pillow, were also read in WebKit through the import, on master
and with the check (2026-10-14). 11 detections change: Chromium's 12 less
wichtounet-originals image1087.original, which takes no placement in WebKit,
as with Pillow; k26kolm0b01d1 takes none either. Clues right go from 1,304 to
1,378 of 1,895, unflagged errors from 20 to 11 and perfect boards from 5 to
10. Cell by cell 89 clues become right and 15 that master read right no
longer are, all flagged with the check (11 missed, 4 read wrong); master read
2 of them confidently, the handwritten 3 at r2c6 and 5 at r4c4 of
wichtounet-solved image1087. No cell gains an unflagged error. In WebKit
master already turns wichtounet-newspaper image1024 (23 of 24 right, 24 with
the check), and turns its original the wrong way (1 of 24 right, 8 unflagged
errors), which the check turns the right way (24 of 24).

## Half turns

A page photographed upside down keeps upright-shaped glyphs, so the
quarter-turn check, which runs only when glyphs read wider than tall, never ran
on it, and such a page was read upside down. Two corpus photographs are stored
that way, wichtounet-newspaper image1083 and its original. Every corpus image
was also read turned half a turn, as two presses of Rotate leave it (Chromium,
master 889181c, through the import as the benchmark reads it, 2026-10-16), and
3,956 of the 3,977 readings were upside down: 24,230 of 144,357 clues right and
14,432 unflagged errors, scored against the target turned with the page,
against 116,350 and 229 for the same images as stored (Kakuro, whose clues have
no turned form, left out).

What an upside-down page reads. In 4,629 upside-down readings of the families
whose clues are cell values (Sudoku, Latin square, Str8ts, Slitherlink, Hidato,
Numbrix; the half-turned copies' own readings and the upright images read again
half a turn round), printed digits read with confidence as follows:

| printed | read upside down, with confidence |
|---|---|
| 0, 1, 8 | as themselves (464, 1,074 and 5,970 times; an 8 also as a 3, 293 times) |
| 6, 9 | as each other (6,782 and 7,361 times) |
| 2 | as a 4 (3,324 times), hardly ever as a 2 (53) |
| 4 | as a 7 (620) or a 4 (434) |
| 3, 5, 7 | seldom at all (258, 232 and 20 times as themselves) |

The 4,253 poor readings of upright-shaped glyphs below, from upright and from
upside-down copies, were each read both ways. Their confident numbers with a 2,
3 or 5 came to 27,267 the right way up and 1,005 upside down, a 27th. Numbers
with a 4 or 7 came to 17,205 and 4,008, a quarter, since upside-down 2s and 4s
read as 4s and 7s; numbers of 0s, 1s, 6s, 8s and 9s alone to 33,648 and 21,063.

**The check** (`Scanner.halfTurn` in `web/scanner.js`). A poor reading (fewer
than half its value regions read as confident digits) of upright-shaped glyphs
(median height/width above 1, from at least six glyphs) that has at least one
confident digit and not one number with a 2, 3 or 5 is read once more through
the crop turned half a turn. That reading is kept only when both hold:
- at least 5 of its confident numbers have a 2, 3 or 5 (`HALF_TURN_BAR`); a
  number counts when any of its digits does;
- it reads clearly better: more confident digits than the first reading, and
  at least 12 of them (`HALF_TURN_FLOOR`), or half its value regions on a page
  with fewer.

The kept reading carries `turns: 2` and a first note saying the photograph was
upside down. The photo flow turns the crop corners with it and, as for any
reading the scanner turned itself, shows the note and waits for review instead
of solving automatically. 6s and 9s count on neither side, nor do 0s, 1s, 8s,
4s and 7s. A reading without a confident digit is not read again: it shows
nothing of the way up. Nor is one whose glyphs measure exactly as tall as wide
at the median, as whole-cell value boxes do (Kakuro entries, cell-filling
blobs): that says nothing of the glyphs, and master returns it unchanged too.
As for quarter turns, only still photographs of square grids are checked; the
live camera, targeted re-reads and non-square grids are not.

**What keeps upright pages upright.** Three things, and the bar alone is not
enough.
- The cue. An upright page read poorly usually still reads a 2, 3 or 5 with
  confidence, and is not read again. As stored, 84 of the 3,952 upright corpus
  photographs take the check in Chromium (lexski-mixed 46, rozet-handwritten
  30, wichtounet-newspaper 4, 4 others), and 63 of the 445 upright ones in the
  WebKit sample below. The pages the cue holds can read many such numbers half
  a turn round: lexski train-0tp6fatzfsoc1 reads 8 as stored and up to 9
  re-captured, train-hh3v4hvzxync1 5 or 6, wichtounet-solved image1080 and
  image210 scaled to 60% 5.
- The bar. Half a turn round, 74 and 56 of the upright pages that take the
  check read no confident number with a 2, 3 or 5 and the rest one, four
  short. Sideways readings that take it (20 at one or three presses of Rotate
  in Chromium, 14 in WebKit) read at most one too.
- Reading clearly better. Some fonts read an upright page's 8s, 3s or 5s as
  confident 3s and 5s upside down while its upright 2s, 3s and 5s read
  flagged, so neither the cue nor the bar holds. The bar alone turned six such
  pages upside down, in both engines, and Rotate could not undo them, since
  the turned page read again showed the same numbers: synthetic upright Sudoku
  pages printed in Bradley Hand ITC (only 1s, 4s, 6s, 7s, 8s and 9s, or nine
  8s among 27 givens), and rozet-render sudoku_0009 with its printed 3 pasted
  into the six empty cells whose solution is a 3. Their half-turned readings
  had 6 to 9 confident digits of 27 to 30 value regions; three of them are
  kept as recorded tests. The lexski pages above read 13 to 21 half a turn
  round against 24 to 36 upright. Of every upright or sideways reading
  measured whose half-turned reading clears the bar (54, with synthetic,
  edited and re-captured pages), none reads clearly better, the closest by 3
  confident digits (that Bradley Hand page in Chromium and one edited rozet
  page, 9 against 12).

Reading clearly better costs few rescues. At two presses in Chromium the bar
alone turns 1,541 upside-down copies and the check keeps 1,494; the other 47
read as on master (46 with 6 to 11 confident digits, and lexski
val-ptd1u655hbcc1, whose value boxes are whole cells). In WebKit it keeps 267
of 273. On the same Chromium data, for upside-down copies turned, clues right
and unflagged errors at two presses, and the margin to the closest upright or
sideways reading:

| rule | turned | clues right | unflagged | margin |
|---|---:|---:|---:|---:|
| bar 5 alone | 1,541 | 70,886 | 4,566 | six turned wrongly |
| bar 5, floor 10 | 1,516 | 70,260 | 4,594 | 1 |
| bar 5, floor 11 | 1,503 | 69,875 | 4,612 | 2 |
| **bar 5, floor 12** (the check) | 1,494 | 69,651 | 4,624 | 3 |
| bar 5, floor 13 | 1,474 | 69,067 | 4,656 | 4 |
| bar 5, floor 14 | 1,461 | 68,731 | 4,674 | 4 |
| bar 4, floor 12 | 1,596 | 71,721 | 4,321 | 3 |

Every row also requires more confident digits than the first reading. A bar
of 4 with the same floor would turn 102 more copies, and the upright and
sideways pages that take the check would still fall three short of it.
Counting 4s and 7s as well, as the draft this replaced did ({2, 3, 4, 5, 7},
read again when at most one shows), reads 191 upright photographs again, and
one of them, lexski train-jlyi8eny0iwc1, reads four confident 4s upside down.
Two upright lexski screenshots that take the check read five confident 4s half
a turn round (train-aa1tenu7iohc1 and train-e7u07n8vxc8c1, the second kept as a
test).

**Cost.** The check is one more full reading of the photograph, through the
same crop. On the 84 upright photographs that take it in Chromium, that reading
took 1.14 s at the median, 2.46 s at the 90th percentile and 4.97 s at most on
this loaded desktop, about as long as their first reading (1.12 s at the
median), and 119 s in all against the corpus's 6,988 s of reading (1.7%). In
WebKit the 63 took 1.62 s at the median and 3.01 s at most. Kakuro pages, whose
value boxes are whole cells, do not pay for it. Nothing else is read again.

**Measured** (master 889181c against a build of the check, b635433, through the
import as the benchmark reads them, 2026-10-17; the later commits change no
reading). "As stored" is scored as the v5 table above scores it; turned copies
are scored with each reading in its own frame, a reading left upside down
against the target turned with it (Kakuro only upright). Presses count presses
of Rotate:

| engine, presses | photographs | read again | turned upright | turned wrongly | clues right | unflagged | perfect |
|---|---:|---:|---:|---:|---|---|---|
| Chromium, as stored | 3,978 | 86 | 2 | 0 | 119,728 → 119,781 of 149,672 | 229 → 214 | 1,602 → 1,603 |
| Chromium, one | 617 | 30 | 13 | 0 | 296 → 593 of 17,668 | 94 → 34 | 0 → 8 |
| Chromium, two | 3,978 | 2,160 | 1,494 | 0 | 24,230 → 69,651 of 144,357 | 14,432 → 4,624 | 21 → 799 |
| Chromium, three | 656 | 7 | 0 | 0 | 775 of 17,875 either way | 27 | 9 |
| WebKit, as stored | 456 | 65 | 2 | 0 | 14,654 → 14,709 of 20,460 | 47 → 32 | 125 → 127 |
| WebKit, one | 60 | 25 | 12 | 0 | 119 → 395 of 1,857 | 63 → 13 | 0 → 8 |
| WebKit, two | 447 | 359 | 267 | 0 | 3,599 → 12,014 of 19,494 | 2,378 → 411 | 7 → 140 |
| WebKit, three | 29 | 5 | 0 | 0 | 57 of 846 either way | 0 | 0 |

Grid found, unconfirmed corners and failures are the same on both sides in
every row. No upright or sideways page is turned and no turn is lost in any of
them. Every reading of the check's build is exactly the one predicted from
master's own half-turned reading of the same image (2,484 readings, both
engines).
- As stored, only image1083 and its original change: turned, 28 and 27 of 28
  clues right instead of 1, unflagged errors 8 and 7 to none. Fresh master
  reads 119,728 clues right, one fewer than the table's two stale WebP rows;
  the table above keeps those rows and adds this change's two. The check's
  build read the 106 photographs the bar alone read again (its 86 among them)
  and 60 others; every reading but those two is master's. The rest cannot
  reach the extra reading: they read well, their glyphs are wider than tall,
  exactly as tall as wide or too few to measure, their grid is not square, or
  they show a 2, 3 or 5.
- One press: the 30 read again are 13 sideways readings and 17 upside-down
  ones, from the 19 photographs stored a quarter turn off (wichtounet-newspaper
  image1024, 1031, 1036, 1038, 1039, 1040, 1041 and 1043 and their originals,
  and wichtounet-solved-extra image2002, 2004 and 2005), which one press leaves
  upside down. 13 turn (image1024 reads 24 of 24 instead of 3); the image1036 pair and
  solved-extra 2004 and 2005 read three and two numbers with a 2, 3 or 5 and
  fall short. Cell by cell 298 clues become right and one is lost, flagged (the
  4 at r6c0 of image1038's original); no cell gains an unflagged error.
- Two presses: the check's build read 1,700 photographs, every one the bar
  alone turned among them; the check keeps a subset of those, so no other can
  change. Cell by cell 45,771 clues become right and 350 that master read
  upside down are lost, all of them flagged, 287 missed by the upright reading
  too. 31 cells gain an unflagged error: on 17 the upright reading makes the
  same error, on 9 it reads the same digit flagged, and 5 are errors of the
  turned reading's own. No image's unflagged errors rise (1,415 of the 1,494
  turned fall, 79 stay), and clues right fall on one image only,
  janko-slitherlink-1139-photo (4 to 3 of 73), read through unconfirmed
  corners so every cell is flagged, as its upright reading (3 of 73) is. On the
  measured images 1s read right go from 3,356 to 6,572 (6,778 upright), and in
  no family fewer.
- Three presses: 7 sideways readings are read again and none turns.
- WebKit: as stored, the bar alone's 80 and 30 others; two presses, its 273
  turns, 37 more it read again and 20 others; one and three presses,
  Chromium's 60 and 29. At two presses 8 cells gain an unflagged error (4 the
  same as Chromium's upright reading, 1 the same digit flagged there, 3 the
  turned reading's own) and 35 clues are lost, all flagged; no image's
  unflagged errors rise and no image reads fewer clues right.

**Not caught.** Of the 3,956 upside-down readings in Chromium, 1,494 are
turned. In the check's own order the rest are: 128 of non-square Kakuro and
Slitherlink grids, never checked; 121 read well enough upside down; 716 have
fewer than six measurable value glyphs (KenKen and Killer clues are cage
labels, Hidato and Numbrix numbers several glyphs, and sparse Futoshiki pages
have few clues); 64 read as glyphs wider than tall and take the quarter-turn
check instead; 103 have whole-cell value boxes; 260 have no confident digit;
404 read a 2, 3 or 5 with confidence upside down (287 of them one: upside-down
3s and 5s read as themselves, 8s as 3s); 620 are read again but short of the
bar (147 of them with four numbers with a 2, 3 or 5, 170 with three); and 46
clear the bar but do not read clearly better.

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
