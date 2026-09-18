# TODO

Solver work that is open, and the experiments that were measured and rejected
so they are not repeated blindly. Accepted optimizations are indexed with their
measurements in `benchmarks/README.md`; the trail invariants are in
`TRAIL_DESIGN.md`; the technique profiles and their evidence in `DEVELOPMENT.md`.
GridPuzzle requires Python 3.14 or newer.

## OPEN: merge the two ALS enumerators (small, benchmark-gated)

`solve_als._build_als_list` and `solve_sue_de_coq._find_als` both hand-roll
"N cells with N+1 candidates, N in {1,2,3}" via itertools.combinations,
differing only in input scope and an overlap filter (~30 duplicated lines,
3 call sites). A shared generator would serve both — but this is measured
hot-path territory, so per project policy it needs a before/after benchmark
with solution-set equivalence before landing. Do NOT similarly merge
solve_chain's `_find_link_ends`/`_find_link_ends_with_num`: superficially
twins, but they walk different state spaces (cell vs value-cell) and
unification would tax the single-digit hot path.

## Fish — parked; see `FISH_REWRITE.md`

A base-first rewrite was implemented, equivalence-tested, measured 5.5x slower,
and reverted. Remaining options need an explicit choice: textbook-base
restriction (changes solver behaviour) or incremental dirty tracking (exact,
but needs per-pattern bookkeeping). `tests/fish_rewrite_harness.py` remains the
frozen equivalence reference for any future attempt.

## Rejected, with the measurements

- **Adaptive technique gating by inner hit rate** (skip AIC inside forcing
  chains after 30 inner tries below a 50% hit rate). The representative corpus
  looked promising (`t-hard` 218 s to 137 s), but full enumeration exposed the
  flaw: the pandiagonal test doubled from 1006 s to 2072 s, and one 13x13
  puzzle went from about 450 s to 1871 s despite an early root hit rate below
  the supposedly unproductive threshold. Hit rate alone does not order
  technique value across grid families; a future signal must measure
  downstream value, such as whether a hit concludes a forcing-chain branch.
  `tests/technique_stats_harness.py` collects the per-technique statistics.
- **Depth-gated technique tiers** (`solve(..., depth_gate=K)` limited
  descendants of search depth K to the cheap tier; 86x on blank-4x4
  enumeration at gate 0). An opt-in with no adoption path, removed from every
  runtime, CLI and test surface on 2026-08-14. Any depth-based gating needs
  broad corpus evidence first, since the partial-corpus win above inverted at
  scale.
- **Pruned recursion in fish enumeration**: equivalent, but 12% slower than
  the per-value dirty-fingerprint memo the fish rules use.
- **Mutating the worker root inside a guarded trail scope** instead of one
  clone per parallel task: passed every rollback, contradiction, exception,
  differential and extension-fallback check, but regressed the clone baseline
  by 3.11% at 1,000 branches, 1.98% on full blank-4x4 enumeration and 0.76% on
  non-square 6x6 cap-20. Keep clone-per-task unless a materially cheaper
  rollback is demonstrated (`benchmarks/worker_trail_reuse_rejected_2026-08-09.md`).
- **Free-threaded thread-pool top-level search** on CPython 3.14.7t: a
  synthetic 1,000-trivial-branch case improved 59.62%, but blank-4x4 cap-1
  regressed 4.22%, full blank-4x4 enumeration 4.83% and non-square 6x6 cap-20
  4.32%. Keep the process pool; a new thread executor must beat these numbers
  on the same cases (`benchmarks/free_threaded_threads_rejected_2026-08-09.md`).
- **Full AIC peer-edge rebuild**, **lazy chain logging**, **whole-object size
  guard**: see the rejected rows of `benchmarks/README.md`.

## Standing rules

- Do not change the trail representation without full solution-set
  equivalence and fresh corpus measurements; the journaling overhead was
  repaid by the hot-path series and the design is performance-neutral on
  enumeration (`benchmarks/trail_baseline_2026-08-08.md`).
- Parallel search (`solve(grid, processes=N)`) returns, for a positive
  `max_sols`, a deterministic subset per mode: sequential search keeps the
  first solutions in branch-priority order, while the pool consumes top-level
  branches in that order, stops after the first consumed branch prefix reaches
  the cap and trims the prefix by content key. It does not exhaust later
  branches for a global minimum, so different `processes` settings may return
  different subsets of the same solution space. Capped solves cancel pending
  futures and call `terminate_workers()`; outstanding futures are bounded to
  the worker count; each worker gets one serialized root and clones it per
  task.
