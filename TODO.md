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
4. **OPEN, long term:** maintain per-value candidate bitmasks incrementally.
   Subset tests become integer operations and the mask doubles as a dirty
   fingerprint. This is invasive because every candidate mutation needs to go
   through an API.

## Parallel top-level trials — DONE, opt-in

`solve(grid, processes=N)` distributes deterministic first-level branches over
a process pool. Historical measurements: blank 4x4 38.5s -> 14.1s; non-square
6x6 enumeration 400.7s -> 129.6s on eight processes. Python 3.14 forkserver/
spawn-compatible execution is smoke-tested on Linux and Windows, and positive
`max_sols` now returns a deterministic branch-priority subset.

**OPEN:** evaluate a free-threaded Python 3.14 thread-pool implementation. It
could avoid pickle/startup costs, but must be benchmarked against the existing
process pool and requires eliminating or context-localising the remaining
process-wide statistics and logging state.

## Depth-gated technique tiers — DONE as an explicit per-solve option

`solve(..., depth_gate=K)` runs only the cheap tier below the chosen search
depth (the former atomic_solver.DEPTH_GATE_K module flag was migrated to this
explicit per-solve option, default off). Historical measurements at K=1:
blank 4x4 37.0s -> 2.6s; non-square 6x6 400.9s -> 7.7s with identical
solutions; benchmarks/README.md records the CI-runner numbers (86.3x at K=0
on blank enumeration).

**OPEN:** decide whether to adopt a default after scheduled extended CI measures
K=1..2 across single-solution hard puzzles and the slow Latin-square corpus.

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
overhead and the depth-gate wins ride on the trail foundation. The rule
stands: do not change trail representation again without full solution-set
equivalence and fresh corpus measurements.

## Independent/differential validation — BASELINE DONE; technique work OPEN

`tests/test_differential.py` independently enumerates all 288 4x4 Sudoku
solutions, generates deterministic bounded puzzle cases, compares complete
solver solution sets, includes contradictory fixtures, and verifies that a
full `AtomicSolver` pass never removes a value used by any surviving oracle
completion.

**OPEN:** extend this from whole-solver checking to individual advanced
techniques, using candidate states derived from known completion sets. Add
parser fuzzing and round-trip fixtures for every supported input format.

## Scheduled extended CI — DONE August 2026

The normal workflow remains bounded. A weekly/manual extended workflow shards
the supported example corpus, 49x49–100x100 generated Sudoku scale tests, and
the slow pandiagonal Latin-square corpus into independent jobs with explicit
timeouts and duration reporting.

## Future puzzle families

The Hidato, Kakuro, Numbrix, and Slitherlink corpora remain under `Examples/` as
source material for future runtime implementations. They are intentionally not
part of the supported-corpus test job until loaders and independent validators
exist for those formats.

## Fish — parked; see `FISH_REWRITE.md`

A base-first rewrite was implemented, equivalence-tested, measured 5.5x slower,
and reverted. Remaining options alter solver behaviour and need an explicit
choice: textbook-base restriction or deeper incremental dirty tracking.
