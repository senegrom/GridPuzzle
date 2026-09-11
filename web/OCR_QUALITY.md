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

## Follow-up: shaded-cell occupancy and automatic type

The candidate-selection tests above had a blind spot: an explicitly selected
Sudoku discards structural black metadata, so its final puzzle alone could hide
a shaded cell that black-cell detection had classified as black. On the faded
newspaper crop a dark printed digit pulled a gray-shaded cell's mean below the
darkness cutoff, which would have changed an automatic-type proposal.

Black-cell detection now requires most interior pixels, as well as the cell
mean, to fall below the same adaptive darkness threshold. A dark digit cannot
make otherwise lighter shaded paper pass solely by lowering the mean. Three unit
cases reproduce the failure before the correction and keep a real numbered black
cell at original, 65 % and 35 % contrast.

The permanent quality suite now observes the unmodified geometry-worker result
before classification and checks that black mask even for explicit Sudoku. It
also reads the original and faded newspaper crops in automatic mode, for 60
scans across the two browser engines. No reference answers are supplied to
recognition, and no confidence or confirmation rules are relaxed.
