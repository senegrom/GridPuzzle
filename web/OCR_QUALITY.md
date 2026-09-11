# OCR quality follow-up — 2026-09-11

Baseline: `7df6afc30b7da1c8a5cae6b35c4b34f109558e41`.
Candidate measurements: GitHub Actions runs `34602544217` and `34603245459`,
Chromium 153.0.8010.12 and WebKit 26.6 with the repository's pinned runtimes.

## Changes and trust boundary

Wide numeric crops are independently re-read as a single text line (PSM 7),
not excluded from re-reading. Narrow crops retain character mode (PSM 10).
Binary, grayscale and atlas readings vote on the complete number; disagreement
still requires review. The 64-pixel sample height and white border are retained.
Word mode helped but still shortened some `11` readings; line mode performed
better. A 48-pixel sample height regressed recognition and was rejected.

Faded images with usable contrast receive black-level normalization before
ink and structural black-cell detection. The 0.1st percentile estimates the
black reference; the 99.5th percentile checks that at least 48 intensity levels
remain. Images with a black reference below 64 and nearly uniform images are
left untouched. The white endpoint stays fixed at 255 to avoid aggressively
stretching shaded Sudoku paper. Gain is bounded by these guards. The original
photo is not modified, and adjusted scans require confirmation even with an
explicit type. No solver-derived guesses or fixture-specific substitutions
are used. The native solver, model and package versions are unchanged.

The extra readings cost time on multi-digit boards; this is not a claimed
speedup. Grayscale rereads are still limited to scans with at most 150 numeric
crops, and the existing cancellable workers and deadlines are retained.

## Before/after measurements

Counts below are numeric *clues*, not individual characters or independent
photographs. The common 34 scans combine two browsers, the two retained newspaper
crops at original/half resolution, blur and 35% contrast, and generated numbers
in three font families at original contrast, blur and 35% contrast.

| Measurement | Baseline | Line mode + contrast normalization |
| --- | ---: | ---: |
| Correct numeric clues, common cases | 866/892 | 885/892 |
| Correct generated numeric clues | 532/540 | 540/540 |
| Generated-clue review flags | 410 | 15 |
| Unflagged discrepant cells, common cases | 44 | 0 |
| Original newspaper clues, each engine | 44/44 | 44/44 |
| 35%-contrast Str8ts, Chromium | 14/20 | 20/20 |
| 35%-contrast Str8ts, WebKit | 14/20 | 19/20 |
| Black-cell positions at 35% contrast, each engine | 0/22 | 22/22 |

At 65% contrast the fixed candidate also retained all 22 Str8ts black cells
and read all 20 clues in each engine. Half-resolution Str8ts still missed three
numbered black clues in each engine; all were flagged. The remaining faded
WebKit error was flagged too. Normally exposed newspaper results did not regress.
Timing samples are in the raw reports, but the runs used different hosted
machines and are not a controlled performance comparison.

These are bounded regression measurements, not an estimate of accuracy on
arbitrary photos, handwriting or publisher layouts. Stronger fading and clipped
or very small glyphs can remain unreadable. Physical-iPhone focus, motion,
exposure and memory pressure were not tested.

## Permanent acceptance tests

`newspaper_regressions.cjs` also runs `ocr_quality_regressions.cjs` against the
production Scanner, Tesseract and browser canvas path. This adds 35%/65% contrast,
half-resolution and blur cases and generated one-, two- and three-digit clues.
Two extra font/size/position cases are held out from candidate selection.

The suite requires exact black-cell geometry, zero unflagged discrepancies,
minimum correct transcription counts, bounded numeric review flags and a
confirmation warning when contrast is adjusted. Exceptions throw and fail CI;
raw measurements are retained in `browser-artifacts/ocr-quality.json`.
Unit tests cover sample routing, the reread budget, full-number voting, bounded
normalization, gray shading, confirmation and OCR worker mode changes.

Tesseract's segmentation and preprocessing guidance:
https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html

## Publication review: shaded-cell occupancy and automatic type

The recovery review found a blind spot in the candidate-selection tests above:
an explicitly selected Sudoku discards structural black metadata, so its final
puzzle alone could hide a shaded cell incorrectly detected as black. This
occurred on the faded newspaper crop and could change an automatic proposal.

Black-cell detection now requires most interior pixels, as well as the cell
mean, to fall below the same adaptive darkness threshold. A dark printed digit
cannot make otherwise lighter shaded paper pass solely by lowering its mean.
Three unit cases reproduce this failure before correction and preserve a real
numbered black cell at original, 65% and 35% contrast.

The permanent quality suite now observes the unmodified geometry-worker result
prior to classification and checks that black mask even for explicit Sudoku.
It also checks the original and faded newspaper crops in automatic mode, for
60 scans across the two browser engines. The table above records the earlier
candidate-selection runs, not a universal accuracy estimate; final integrated
measurements are retained in each run's `browser-artifacts/ocr-quality.json`.

Publication is based on current master `13975b0`, preserving its immutable
runtime, photo-read transaction, editor and Play repairs. No reference answers
are supplied to recognition, and no confidence or confirmation rules are relaxed.

The expanded automatic-mode measurements also found a reviewed `2`/`9`
misreading in WebKit at 65% contrast (19/20 correct). The new degraded-auto
cases therefore allow one flagged numeric error, as the existing strong-fade
cases already do. This does not relax the normal-photo accuracy floor, exact
black-cell geometry, correct automatic family, or zero-unflagged-discrepancy
requirements. Actual per-case counts and errors remain in the raw report.

## Fragmented printed marks

The follow-up recognizer keeps substantial vertically aligned ink fragments
inside one numeric crop when a narrow print/glare gap splits a glyph below the
normal component-height threshold. This also preserves a fragmented trailing
digit beside a connected leading digit. It does not draw replacement strokes,
substitute numbers or use solver answers as OCR evidence. Every recovered crop
stays review-flagged, even when the numeric readers agree. Small isolated dots
and broadly separated fragments are still excluded, and grouping is bounded.

The permanent quality gate adds single-digit, trailing-digit and white-on-black
fragment fixtures in both engines (66 scans in total). It records actual numeric
results and requires the damaged clue to remain marked and uncertain. A missed
reading must remain red in the live preview instead of becoming a blue answer
slot. All previous newspaper/font accuracy and zero-unflagged-error checks stay
in force; these extra artificial fixtures are not a phone-camera accuracy claim.
