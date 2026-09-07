# Real newspaper scanner examples

User-provided photographs from 2026-09-07 are kept here as real-world scanner regressions. They include newsprint texture, perspective, uneven illumination, shaded Sudoku boxes and Str8ts black cells.

- `2026-09-07-sudoku.jpg` with the adjacent expected JSON.
- `2026-09-07-str8ts.jpg` with the adjacent expected JSON.

The expected files are hand-transcribed from the photographs. Tests must compare OCR output to these values; they must never substitute the expected values into production recognition.
