# Real newspaper scanner fixtures

These are user-provided newspaper puzzle photographs from 2026-09-07, cropped to the puzzle grid and downsampled to keep the repository and browser regression suite small. They are real newsprint images, not generated OCR fixtures.

- `2026-09-07-sudoku.webp`: shaded 9×9 Sudoku with paper texture and uneven illumination.
- `2026-09-07-str8ts.webp`: 9×9 Str8ts with solid black separators, including numbered black cells.
- `ground-truth.json`: hand-checked printed clues and Str8ts black-cell geometry.

`scripts/newspaper_regressions.cjs` runs the production scanner and self-hosted Tesseract.js pipeline against both images in Chromium and WebKit. Wrong, missing, or invented clues are acceptable only when the corresponding cell is explicitly flagged for review. The suite also enforces minimum correct-transcription counts and exact Str8ts black-cell geometry.

The images live outside `web/`, so they are not shipped in the GitHub Pages application or included in the offline PWA bundle.
