# Validated public candidate view — 2026-08-11

Solver modules no longer call the public candidate accessor. All
comparisons used `depth_gate=None` and exact solution fingerprints.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| Loaded 4×4 Sudoku, 18 complete solves | 1.839045s | 1.837960s | -0.06% |
| Non-square 6×6 Sudoku, first 10 solutions | 10.303476s | 10.327342s | +0.23% |

Solver geometric mean: **+0.09%**.

Decision: **promote**.
