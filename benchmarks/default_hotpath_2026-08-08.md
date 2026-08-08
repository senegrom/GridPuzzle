# Default-solver hot-path benchmark — 8 August 2026

These measurements compare the same Python 3.14.6 GitHub-hosted
Ubuntu runner before and after four semantics-preserving changes:

- allocation-free AIC endpoint visibility checks;
- one merged `UneqRule` per origin instead of transient per-house rules;
- C-level tuple hashing for `Guarantee`;
- cached per-cell-set relevant-guarantee tuples.

Every run used `depth_gate=None`, sequential solving, disabled log
rendering, `PYTHONHASHSEED=0`, and exact deterministic solution-set
fingerprints. The fingerprints were identical before and after.

| Case | Baseline median | Optimized median | Improvement |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 56.519 s | 50.082 s | 11.4% |
| Non-square 6x6 Sudoku, first 20 solutions | 27.567 s | 23.574 s | 14.5% |

Earlier isolated measurements also showed each group independently
improving both cases, so the combined result is not a single-run
scheduling artefact. These optimizations do not alter the technique
hierarchy, branching policy, solution cap, or depth-gate defaults.
