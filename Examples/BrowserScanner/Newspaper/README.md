# Real newspaper scanner fixtures

These are user-provided newspaper puzzle photographs from 2026-09-07, cropped to the puzzle grid and downsampled only to keep the repository/regression suite small. They are real newsprint images, not generated OCR fixtures.

- `2026-09-07-sudoku.jpg`: shaded 9×9 Sudoku with paper texture and uneven illumination.
- `2026-09-07-str8ts.jpg`: 9×9 Str8ts with solid black separators, including numbered black cells.
- `ground-truth.json`: hand-checked printed clues and Str8ts black-cell geometry.

`scripts/newspaper_regressions.cjs` runs the same production scanner/Tesseract.js pipeline against these images in Chromium and WebKit. Wrong, missing, or invented clues are acceptable only when the corresponding cell is explicitly flagged for review; the suite also enforces minimum correct transcription counts and exact Str8ts black-cell geometry.

The images live outside `web/`, so they are not shipped in the GitHub Pages application or included in the offline PWA bundle.
