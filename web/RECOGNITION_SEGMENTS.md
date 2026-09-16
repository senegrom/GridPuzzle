# Recover truncated multi-digit readings

This follow-up to PR #48 uses separately located, non-overlapping glyphs in a
numeric crop when whole-number recognition omits a digit. It does not split
connected ink, draw missing strokes, consult a solver or use fixture answers.
It preserves the existing grid detector, classification and solver.

## Evidence and safeguards

The preparation stage retains the absolute bounding boxes of two or three
separate glyphs, ordered left to right. Grayscale crops include real padding,
cut at the midpoint of the empty gap so an adjacent digit cannot leak into the
individual crop. Existing raw-line recognition first gets a chance to read the
whole number. Only if no isolated whole-crop reading has the expected length
are the glyphs read separately.

At the final voting boundary, a complete existing OCR alternative is preferred
to a truncated majority. This can recover a full atlas or raw-line reading that
would previously lose to two shortened readings. Geometry selects between
actual OCR strings; it supplies no numeric values. Such selections are marked
`lengthRecovered` and keep confidence zero. Complete existing readings always
take precedence over assembled per-glyph proposals.

Every individual glyph must return exactly one numeric character before a
combined proposal is accepted. Partial results are never assembled. A fallback
proposal remains confidence zero and is marked `segmentedRead`, so the ordinary
review gate still applies. Even unanimous whole-number readings remain
uncertain when shorter than the detected glyph count. Duplicate segmented
messages never acquire extra voting weight.

The existing 24-extra-read ceiling is shared between raw-line and per-glyph
retries. The original raw-line retries execute first, in their original order;
the new fallback only consumes the remaining budget and cannot starve an
existing recovery. Optional raster preparation is capped at 72 glyph crops per
scan and is disabled above the existing 150-clue grayscale limit. Exact-image
caching and cooperative cancellation apply to the additional reads too.
`ocrStats.segmentReads` counts attempted per-glyph reads, including cache hits,
rather than new engine calls.

## Tests and measurement

`web/tests/ocr-segments.test.js` adds 21 focused tests of geometry, actual crop
pixels in both polarities, malformed input, budgets, evidence precedence,
review, cache ownership and cancellation. The existing fragment, quality,
engine reuse and runtime-build suites remain intact.

`scripts/recognition_segments_regressions.cjs` compares the production scanner
against PR #48 commit `1ed4507570050c87543f2e1986fc092fb6acae14`, with the same
built dependencies and browser fonts. It uses 13 fixtures per browser (narrow
bar digits and four fonts at three horizontal scales), alternates execution
order and records raw before/after cells, gains, losses, flags and timings.
The gate rejects newly lost correct clues or any unflagged discrepancy and
requires exact reading of the narrow-number control. Its baseline is a scanner
comparison, not a second independently deployed app build.

The existing `Recognition quality` workflow runs this paired suite together
with the 66 existing quality scans and 16 fragment scans. Results are stored
in `recognition-quality-report/recognition-segments.json`. These targeted
synthetic controls and two existing newspaper photographs are not a general
accuracy estimate for unseen photos, handwriting or the external local corpus.
