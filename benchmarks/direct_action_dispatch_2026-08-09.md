# Direct power-action dispatch — 2026-08-09

## Change

`AtomicSolver._solve_power_actions()` previously constructed a new lambda for
every attempted advanced technique at every stalled solver state. `_act()` now
accepts a callable plus positional arguments and invokes it directly. Technique
ordering, logging, timing statistics, forcing-chain exclusions, and the
explicit default-off depth gate are unchanged.

## Correctness gate

The candidate passed the focused solver, regression, differential, depth-gate,
and representative-example suites on Python 3.14 under both Linux and Windows.
Every benchmark run returned the same deterministic solution cardinality and
SHA-256 fingerprint as the baseline.

## Method

GitHub-hosted Ubuntu 24.04 runner, CPython 3.14.6, `PYTHONHASHSEED=0`, one
process, full technique hierarchy, and `depth_gate=None`. Baseline and candidate
runs were interleaved in the order baseline, candidate, candidate, baseline,
baseline, candidate. Reported values are medians of three runs.

| Case | Baseline | Candidate | Change |
|---|---:|---:|---:|
| Blank 4x4 Sudoku, all 288 solutions | 34.1845 s | 33.9906 s | **0.57% faster** |
| Non-square 6x6 Sudoku, first 20 solutions | 13.1421 s | 13.1395 s | **0.02% faster** |

The second result is effectively neutral within runner noise. The change was
accepted because neither measured workload regressed, the larger workload was
consistently slightly faster, and the implementation removes recurring closure
allocation while simplifying the dispatch path.
