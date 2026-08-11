# TODO

Deferred solver ideas from the June–August 2026 reviews, ordered by expected payoff.
Completed and rejected experiments remain recorded with measurements so they are not repeated blindly. GridPuzzle requires Python 3.14 or newer.

## Rules-layer scan issues — DONE

1. **DONE: ProdRule and DivRule exact arithmetic** — integer multiplication and
   `divmod`; values beyond `2**53` are regression-pinned.
2. **DONE: factorial landmine** — `_filter_new_sum_candidates` uses Régin-style
   all-different filtering (bipartite matching plus residual SCCs) instead of
   `k!` permutations, with guarantee restrictions applied per value. Derived
   cages remain capped at eight cells. Measured Killer examples fell from
   7.0s to 0.4s and 2.6s to 0.3s.
3. **DONE: Latin-square naming** — `PandiagonalLatinSquare` names the wraparound
   variant; a true two-main-diagonal `DiagonalLatinSquare` is separate.
4. **DONE: identity and input hardening** — immutable-grid hashes are
   process-stable and include shape/value domain; mutable backing arrays are no
   longer exposed; public dimensions, coordinates, assignments, cage formats,
   and one-shot iterable inputs are validated.
5. **DONE: propagation unification** — ordinary atomic propagation, Nishio, and
   forcing-net trial propagation share the same rule/guarantee application and
   fixpoint machinery. Explicit `InvalidGrid` is authoritative.

## REJECTED: adaptive technique gating by inner hit rate

Implemented and fully measured, then reverted. Gate = skip AIC inside forcing
chains after 30 inner tries below a 50% hit rate. The representative corpus
looked promising (`t-hard` 218s -> 137s), but full enumeration exposed the
flaw: the pandiagonal test doubled from 1006s to 2072s. One 13x13 puzzle solved
in about 450s with inner AIC and 1871s once gated, despite an early root hit
rate below the supposedly unproductive threshold. Hit rate alone does not
order technique value across grid families.

A future signal must measure downstream value — for example, whether a hit
causes a forcing-chain branch to conclude rather than merely changing state.

## Guarantee-index lifecycle — DONE August 2026

The per-rule minimum-cell guarantee index previously lived in the general
structural cache. Every rule deactivation cleared that cache, so sum-heavy
puzzles repeatedly rebuilt an index whose inputs had not changed. Earlier
instrumentation on a 9x9 Killer measured 299 rebuilds for 2817 uses and a
sixfold reduction in visited guarantees when the index was available.

`Grid` now has a guarantee-only cache. Rule churn leaves it intact; adding or
deactivating a guarantee clears it. Guarantee-only structures such as
`semi_strong_links`, `guarantee_cells_by_value`, and the relevance index share
this lifecycle. Clones and process-pool payloads deliberately start with empty
caches.

## Silent library logging overhead — DONE August 2026

The import-time `NullHandler` is no longer treated as visible output. Handler
reachability is cached for each solve, display-only formatting and solution
sorting are guarded before work begins, and atomic step rendering is skipped
when no configured handler can emit it. Ordinary silent API use improved by
1.89% on complete blank-4x4 enumeration and 0.25% on the non-square 6x6 cap-20
case with identical solution hashes. See
`benchmarks/silent_logging_2026-08-09.md`.

## Speeding up house-rich grids — general mechanisms only

1. **DONE for fish/finned fish:** per-value dirty fingerprints
   (`solve_fish._value_memo`). The memo is now a trailed mapping: parent
   fingerprints survive speculative work while branch-only entries roll back
   with the candidate state. The same idea for X-chain/skyscraper remains low
   priority because both are cheap in current profiles.
2. **DONE:** hit-rate instrumentation plus forcing-chain inner exclusion of
   zero-hit tiers made the corpus 6.6x faster; the slow pandiagonal suite fell
   from 3h09m to about 22m28s with identical solutions.
3. **REJECTED:** pruned recursion in fish enumeration was equivalent but 12%
   slower with the existing memo.
4. **PARTIAL:** AIC, ALS-XZ, and ALS-XY-Wing now share one immutable per-value
   candidate-bitmask and peer-topology snapshot at each stalled state. Keeping
   those masks incrementally updated remains open; the event-driven candidate
   mutation hooks now make that possible, but benchmark evidence is still
   required before adding more per-mutation bookkeeping.

## Event-driven basic propagation — DONE August 2026

Candidate and known-value changes now queue only rules and guarantees watching
the changed cells. New constraints are queued directly, guarantee additions
wake only relevant guarantee-consuming rules, and dominance comparisons rerun
only when the live guarantee relation can change. Dirty queues are snapshotted
and restored with every trail frame and survive pickle round trips with their
candidate-cell identities intact.

## Parallel top-level trials — DONE, opt-in

`solve(grid, processes=N)` distributes deterministic first-level branches over
a process pool. Historical measurements: blank 4x4 38.5s -> 14.1s; non-square
6x6 enumeration 400.7s -> 129.6s on eight processes. Python 3.14 forkserver/
spawn-compatible execution is smoke-tested on Linux and Windows, and positive
`max_sols` returns a deterministic branch-priority subset.

Capped solves cancel pending futures and call Python 3.14's
`terminate_workers()` after enough branch-ordered solutions exist, rather than
waiting for already-running siblings whose results cannot affect the returned
subset. Four-process cap-1 measurements improved by 1.80% on blank 4x4 and
0.80% on the non-square 6x6 case, with identical solution hashes. See
`benchmarks/parallel_cap_termination_2026-08-09.md`.

Outstanding futures are bounded to the worker count and replenished in branch
order. This avoids queuing repeated grid payloads that a small positive cap may
never need. Queue-focused cap-1 cases improved by 11.48% at 100 branches and
57.26% at 1,000 branches; blank-4x4 cap-1 improved by 0.85%, with identical
solutions. See `benchmarks/bounded_parallel_submission_2026-08-09.md`.

Each process now receives one serialized, cache-free root grid through its
initializer. Every task uses the optimized `Grid.deepcopy()` path locally, so
branch payloads contain only three scalars rather than the complete puzzle.
Measurements improved by 20.06% at 1,000 branches, 1.55% on blank-4x4 cap-1,
1.04% on full blank-4x4 enumeration, and 2.80% on non-square 6x6 cap-20, with
identical solution sets. See `benchmarks/worker_root_clone_2026-08-09.md`.

**REJECTED:** mutating that worker root directly inside a guarded trail scope.
The design passed Linux and Windows rollback, contradiction, exception,
differential, extension-fallback, and statistics checks, but regressed the
selected clone baseline by 3.11% at 1,000 branches, 1.98% on full blank-4x4
enumeration, and 0.76% on non-square 6x6 cap-20. Blank-4x4 cap-1 improved only
0.72%. Keep clone-per-task unless a materially cheaper rollback mechanism is
demonstrated. See `benchmarks/worker_trail_reuse_rejected_2026-08-09.md`.

**REJECTED:** free-threaded Python 3.14 thread-pool top-level search. On CPython
3.14.7t with two workers it passed solver-API, differential, and exact
solution-set checks. Threads improved a synthetic 1,000-trivial-branch case by
59.62%, but regressed blank-4x4 cap-1 by 4.22%, full blank-4x4 enumeration by
4.83%, and non-square 6x6 cap-20 by 4.32%. Keep the process pool for real solver
workloads. See `benchmarks/free_threaded_threads_rejected_2026-08-09.md`.

## Depth-gated technique tiers — retained, parked, default off

`solve(..., depth_gate=K)` remains available as an explicit experiment switch.
Search depth is zero-based: `K=0` runs the full hierarchy at the root and only
the cheap tier in descendants. `None` is the default and preserves the complete
technique hierarchy everywhere. No default adoption or routine CI use is
planned; revisit only with broad corpus evidence and an explicit policy change.

## Trail-based propagation instead of deepcopy-per-trial — DONE August 2026

Nishio, forcing chains, forcing nets, and recursive backtracking now use nested
`trail_mark()` / `trail_undo()` scopes instead of cloning the complete grid for
every speculative branch. Candidate sets snapshot once per trail frame;
knowns, rule and guarantee transitions, structural caches, and fish memo state
all roll back transactionally. Top-level API isolation and process-pool branch
payloads still use explicit copies intentionally.

Correctness is covered by nested rollback, exception, cache, pickle, branch
consensus, Nishio, forcing-net, recursive-search, independent-oracle, and
sequential/parallel equivalence tests. See `TRAIL_DESIGN.md` for the implemented
invariants.

**Measurement gate CLOSED (Aug 2026):** benchmarks/trail_baseline_2026-08-08.md
records pre-trail d38f9c9 vs trail bb8d7d4 — performance-neutral on
enumeration (blank 4x4 all-288: 41.0s -> 41.9s; nonsq 6x6 cap-20: 22.2s ->
21.2s), identical solution sets; the hot-path series repaid the journaling
overhead while retaining transactional branch isolation. The rule
stands: do not change trail representation again without full solution-set
equivalence and fresh corpus measurements.

## Independent/differential validation — baseline DONE

`tests/test_differential.py` independently enumerates all 288 4x4 Sudoku
solutions, generates deterministic bounded puzzle cases, compares complete
solver solution sets, includes contradictory fixtures, and verifies that a
full `AtomicSolver` pass never removes a value used by any surviving oracle
completion. It also executes every power action individually against candidate
states derived from independently valid completion pairs, checking after each
action and subsequent basic propagation that no oracle completion is lost and
that emitted structural constraints remain valid.

`tests/test_parser_fuzzing.py` deterministically exercises every supported
parser family across compact strings, arbitrary whitespace-separated strings,
prefixed and class-explicit factories, nested one-shot iterables, mapping-based
cage loaders, row-wise/column-wise modes, and UTF-8 file round trips. Malformed
Futoshiki mutations are checked for transactional rollback and retryability.
Broader per-technique completion-derived states remain in the slow differential
shard.

## Scheduled extended CI — DONE August 2026

The normal workflow remains bounded. A weekly/manual extended workflow shards
the supported example corpus, 49x49–100x100 generated Sudoku scale tests, and
the slow pandiagonal Latin-square corpus into independent jobs with explicit
timeouts and duration reporting.

## New puzzle families — DONE August 2026

Hidato, Kakuro, Numbrix, and Slitherlink are fully supported runtime families:
CSP-Rules loaders, dedicated rule types (consecutive-adjacency paths,
value-count windows, single-loop topology), exhaustive small-board oracles in
tests/test_new_puzzle_families.py, and a 16-job scheduled corpus matrix in
extended CI. See DEVELOPMENT.md for the per-family technique profiles.

## Fish — parked; see `FISH_REWRITE.md`

A base-first rewrite was implemented, equivalence-tested, measured 5.5x slower,
and reverted. Remaining options alter solver behaviour and need an explicit
choice: textbook-base restriction or deeper incremental dirty tracking.
