# Default-solver hot-path benchmark — 8 August 2026

These measurements compare the same Python 3.14.6 GitHub-hosted
Ubuntu runner before and after four semantics-preserving changes:

- allocation-free AIC endpoint visibility checks;
- one merged `UneqRule` per origin instead of transient per-house rules;
- C-level tuple hashing for `Guarantee`;
- cached per-cell-set relevant-guarantee tuples.

Every run used the complete technique hierarchy, sequential solving, disabled log
rendering, `PYTHONHASHSEED=0`, and exact deterministic solution-set
fingerprints. The fingerprints were identical before and after.

| Case | Baseline median | Optimized median | Improvement |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 56.519 s | 50.082 s | 11.4% |
| Non-square 6x6 Sudoku, first 20 solutions | 27.567 s | 23.574 s | 14.5% |

Earlier isolated measurements also showed each group independently
improving both cases, so the combined result is not a single-run
scheduling artefact. These optimizations do not alter the technique
hierarchy, branching policy, or solution cap.


## Second-stage runtime cleanup

Two further isolated candidates were measured against the optimized
baseline above, still with the complete hierarchy and identical solution
fingerprints:

| Change | Blank 4x4 | Non-square 6x6 |
|---|---:|---:|
| Make timing/counters opt-in; skip singleton no-op journaling | 50.087 → 49.388 s (1.4%) | 23.362 → 23.212 s (0.6%) |
| Cache guarantee grouping/sorting during filtering | 47.004 → 46.434 s (1.2%) | 22.650 → 22.371 s (1.2%) |

The measurements were run independently to attribute each gain. Both
changes preserve the full technique hierarchy and default branching
behavior.
