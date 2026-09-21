# Thread executor driver rewrite, default-path check — 2026-09-21

The opt-in thread executor no longer mirrors the sequential search with a
recursive function. It drives the same suspended `_solve_branch` frames as
`solver._solve_full` on an explicit stack, checking its cancellation event
once per frame push or pop, and wraps each task in the process executor's
source-protection and sandbox scopes. `solve()` now routes both backends
through the one validated path, choosing the top-level function with a
single identity check per solve.

The default search path is unchanged by construction: `git diff` against
master touches only `solve`, `_solve_validated` and `_solve_with_plan`, all
of which run once per solve outside the search, and removes the duplicate
`_solve_validated_thread`. `_solve_full`, `_solve_branch` and
`_atomic_pass_or_branches` are byte-identical. This record exists because
the performance policy asks for a measurement of every solver change.

Decision: **promote** (no default-path change to reject).
Geometric-mean change: **-9.20%**, dominated by the sub-second cases.

| Case | Baseline median | Candidate median | Change |
|---|---:|---:|---:|
| sudoku4 | 33.540s | 33.119s | -1.25% |
| killer-hard | 0.085s | 0.070s | -17.55% |
| killer-deadly | 0.126s | 0.138s | +9.73% |
| slitherlink2 | 0.011s | 0.007s | -30.56% |
| slitherlink3 | 0.293s | 0.292s | -0.53% |

Five samples per tree, alternating baseline (the master worktree at
55d4f18) and candidate, at idle process priority on a machine that other
jobs kept at roughly 88% load throughout. Every sample produced the same
solution and root fingerprints, solution count and branch-node count as
its baseline. The sub-second cases swing by up to a third between runs
under that load, in both directions; sudoku4, the only case that runs for
seconds, moved by -1.25%. An earlier three-sample run on the same
loaded machine had shown sudoku4 at 33.30 s before and 39.67 s after,
which is why it was repeated with five samples: the spread was noise.

Raw samples: `thread_driver_default_path_2026-09-21.json` (its `baseline`
field is the script's pinned historical constant, not the tree measured).
