# Extension lifecycle fixes — 2026-09-10

Baseline: `b9788d164aacfa26fa71f331b624085595da3fe3`.
The reviewed 12 regression cases all fail on that baseline and pass after the fixes.
Source validation, dirty-rule selection, and native inequality merging were tested
in the supported CPython 3.14 Actions environment before publishing the tested commit.

Native-path timing comparison: median of five full-profile sequential solves per
case, `max_sols=1`, with unchanged solution fingerprints. These small samples
are a smoke comparison, not a broad performance or speedup claim.

| Case | Before (s) | After (s) | Change |
|---|---:|---:|---:|
| blank4-cap1 | 2.977671 | 2.993075 | +0.52% |
| completed4 | 0.000997 | 0.001020 | +2.24% |
| exampleSudoku | 0.035666 | 0.035342 | -0.91% |

## Validation evidence

- baseline: {'tests': 12, 'failures': 12, 'errors': 0, 'skipped': 0}
- focused: {'tests': 115, 'failures': 0, 'errors': 0, 'skipped': 0}
- bounded: {'tests': 757, 'failures': 0, 'errors': 0, 'skipped': 0}

Actions run: https://github.com/senegrom/GridPuzzle/actions/runs/34523792278

The staging workflow and patch-application harness are not part of master.
Normal Linux/Windows and extended CI execute again when master advances.
