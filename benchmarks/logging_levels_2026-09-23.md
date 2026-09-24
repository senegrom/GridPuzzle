# Solver logging at standard levels — 2026-09-23

The solver's loggers moved into the `gridsolver` namespace and stopped
forcing their own level; detail 0 now logs at INFO and deeper detail at
DEBUG instead of levels 1001 down to 1, and `solver.QUIET` silences a
solve outright. The logging gate runs on hot paths (every technique's
`lg.on` guard, every branch's step check), so the performance policy asks
for a measurement. `GridLogger.is_enabled` now compares the detail level
first, which settles every guard of an ordinary solve with one ContextVar
read; before, it first called `_lvl()` and went through the
`detail_level` property.

Decision: **accept**. The ordinary solve path is unchanged within the
noise of this machine, and the gate itself is cheaper.

Two runs of `scripts/benchmark_exact_cages.py --samples 5`, each
alternating the master worktree at fa48f70 (baseline) and the logging
commit bea680f (candidate), at idle process priority on a host that
other jobs held at 100% load throughout (wall-clock medians):

| Case | Run 1 baseline | Run 1 candidate | Change | Run 2 baseline | Run 2 candidate | Change |
|---|---:|---:|---:|---:|---:|---:|
| sudoku4 | 50.378s | 52.304s | +3.82% | 52.459s | 51.346s | -2.12% |
| killer-hard | 0.214s | 0.148s | -30.67% | 0.124s | 0.128s | +2.61% |
| killer-deadly | 0.213s | 0.199s | -6.55% | 0.196s | 0.186s | -5.11% |
| slitherlink2 | 0.015s | 0.017s | +10.58% | 0.013s | 0.013s | -0.85% |
| slitherlink3 | 0.501s | 0.505s | +0.85% | 0.365s | 0.421s | +15.19% |
| Geometric mean | | | -5.59% | | | +1.71% |

Every sample in both runs produced the same solution and root
fingerprints, solution count and branch-node count as its baseline.
Single sudoku4 samples ranged from 46 s to 68 s within one tree, so the
two runs' opposite signs are noise.

Because wall time was this noisy, the same trees were also compared by
CPU time (`time.process_time`), five fresh-interpreter samples each in
alternating order:

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| `lg.on` guard (best of 5 x 2M calls) | 276 ns | 156 ns | -43.3% |
| sudoku4 | 35.09s | 35.48s | +1.1% |
| slitherlink3 | 0.281s | 0.250s | -11.1% |

sudoku4's CPU samples overlap completely (34.86-35.52 s baseline,
34.67-36.19 s candidate). killer-hard is omitted: at 0.09 s it is six
ticks of the Windows process clock, below its resolution.

An application that configures logging at WARNING no longer pays for
rendering at all: the review's probe (a Sudoku solved with
`log_level=-1` after `logging.basicConfig(level=WARNING)`) took 0.062 s
CPU and emitted 640 lines per solve on master, and takes 0.031 s with no
output now, the same as with no logging configured.

Raw samples: `logging_levels_2026-09-23.json` (run 1) and
`logging_levels_2026-09-23_rerun.json` (run 2); their `baseline` field
is the script's pinned historical constant, not the tree measured.
