# Complete fragmented clues and narrow numbers

This change is based on scanner review commit
`3f10083b842a761f952bab1a5fb54fe46b4fce6b`, retaining the detector and corpus
repairs on `fix/corpus-tooling-20260914`. It does not change the native solver,
puzzle classification, runtime versions or confirmation requirements.

## Recognition changes

The previous grouping pass only joined pairs whose components were both shorter
than one quarter of the crop height. A short cap or foot next to a taller body
was discarded, and a three-part glyph could be reduced to a partial crop.
The recognizer now joins nearby, substantially aligned vertical fragments,
starting with the smallest gaps and retaining the complete bounding box.
Every joined crop remains `recoveredMark` and requires review even when OCR
readings agree. Nothing fills missing pixels or supplies a guessed digit.

Grouping still requires substantial ink, horizontal overlap and a short member
of each pair, and limits the total height and gap. At most 24 candidate
components are considered; each successful iteration removes one candidate.
Speckles, remote marks and two intact neighbouring digits remain separate.

The extraction result also records when multiple substantial glyphs occupy the
same numeric line. Such crops use line mode (PSM 7) even when narrow: two slim
ones can otherwise pass the aspect-ratio test for a single character. A single
narrow glyph retains PSM 10. The existing sample size, grayscale budget,
retry budget, worker reuse and disagreement policy are unchanged. This does
not add recognition passes or use puzzle solutions to correct OCR.

## Regressions and measurement

`web/tests/recognition-fragments.test.js` contains 13 new regressions for both
ink polarities, unequal and three-piece glyphs, trailing digits, intact narrow
numbers, speckle/remote-mark rejection, review flags and sample routing.
The seven complete-crop/review regressions were run against the unchanged
baseline and all seven failed. The candidate passes those regressions and all
573 tests in the full Node suite on Node 22.16.0.

`scripts/recognition_fragments_regressions.cjs` runs eight fixtures through the
production Scanner and real Tesseract in Chromium and mobile WebKit. It asserts
complete crops, intact control clues, black-cell layout and zero unflagged
errors, and records actual transcriptions rather than supplying expected values
to recognition. Damaged clues are not required to become perfectly readable;
they are required to remain complete, marked and reviewable.

The `Recognition quality` PR workflow runs this suite alongside the existing
66-scan newspaper/font/degraded-image quality gate with the repository's pinned
browser and OCR dependencies. Raw results are retained as
`recognition-quality-report`. Local real-browser execution was blocked by the
browser environment, so browser accuracy must be established from that workflow,
not inferred from the unit-test count. These fixtures are regression controls,
not an accuracy estimate for arbitrary phone photographs or handwriting.
