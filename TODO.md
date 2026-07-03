# TODO

Deferred solver ideas (June 2026 review). Ordered by expected payoff.
July 2026: the known-issues list and most engine items below were implemented —
records kept with their measurements; the genuinely open items are marked OPEN.

## Rules-layer scan issues (June 2026) — ALL FIXED July 2026

1. **DONE: ProdRule float division** -> divmod integer arithmetic, plus a
   divisor prune; >2^53 case pinned by test_prodrule_integer_exact_beyond_float.
2. **DONE: factorial landmine** -> `_filter_new_sum_candidates` now uses
   Regin (1994) alldifferent filtering (bipartite matching + SCC of the
   residual digraph) instead of k! permutations, with in-cage guarantees as
   per-value position restrictions — equivalence fuzz-pinned
   (test_saeamo_regin_matches_bruteforce). Derived cages capped at 8 cells
   (_MAX_SAEAMO_CELLS). Corpus: killer-d 7.0s -> 0.4s, killer-c 2.6s -> 0.3s.
3. **DONE: DiagonalLatinSquare renamed** to PandiagonalLatinSquare; a true
   two-main-diagonals DiagonalLatinSquare added; loader + 9 example headers
   migrated.
4. **DONE (minors)**: ImmutableGrid eq/hash include dimensions AND are
   process-stable (crc32-based — hash(bytes) is salted per process, which
   broke cross-process solution merging); Guarantee type-strict eq; SumRule
   tmin prune; InvalidGrid raised at both silent-empty sites; guarantee scans
   pre-filtered per rule via a min-cell bucket index in the struct cache
   (atomic_solver._relevant_gts — the n=100 cost driver); run.py -c accepts
   all loader classes; _partition_dic bounded.

## REJECTED (July 2026): adaptive technique gating by inner hit rate

Implemented and fully measured, then reverted. Gate = skip AIC inside FC
after 30 inner tries below 50% hit rate, stats per solve lineage. Corpus
looked perfect (t-hard 218s -> 137s, pandiagonal-11x11 flat: rates 36% vs
65% separate cleanly) — but the full suite exposed the flaw: the pandiagonal
ENUMERATION test doubled (1006s -> 2072s). Per-file instrumentation:
13x13-DB#1-15-W4 solves in ~450s with inner AIC and 1871s once gated, and
its root hit rate over the first 30 tries is 27% — BELOW t-hard's 36% where
AIC is dead weight. Hit rate does not order techniques by value across grid
families, so no threshold works; scoping variants (per-subtree fresh stats,
root-only gating) were also measured and recovered almost nothing
(1869s/1819s). The unrealized prize stays: t-hard would be 37% faster with a
correct signal. That signal must measure VALUE, e.g. attribute each inner
hit to whether its FC branch then concludes (contradiction/solved) vs stalls
— plumbing through the FC branch loop, sketched but not built.

## Speeding up house-rich grids (pandiagonals) — general mechanisms only

1. **DONE for fish/finned (June 2026): per-value dirty fingerprints**
   (solve_fish._value_memo). Open remainder: same idea for x_chain/skyscraper
   — both cheap (~1.5s corpus); revisit only if profiles change.
2. **DONE (June 2026): hit-rate instrumentation + FC-inner exclusion** of
   zero-hit tiers -> corpus 6.6x faster; slow pandiagonal suite test
   3h09m -> 22m28s. Exclusion, not reordering, is the lever.
3. **REJECTED (June 2026): pruned recursion in fish enumeration** — exactly
   equivalent, measured 12% slower cold; the memo already covers the win case.
4. **OPEN, long term: per-value candidate bitmasks** maintained incrementally
   on the Grid; subset tests become int ops and the bitmask doubles as the
   fingerprint for idea 1. Invasive (all mutation sites need an API).

## Parallel top-level trials — DONE July 2026 (opt-in)

solve(grid, processes=N) distributes first-level branches over a process
pool (solve_parallel.py). Measured: blank 4x4 38.5s -> 14.1s; 6x6
non-square-box 1408-solution enumeration 400.7s -> 129.6s on 8 processes;
identical solution sets (slow-marked regression test). OPEN: free-threaded
3.14 thread pool variant would drop the pickle/spawn overhead.

## Depth-gated technique tiers — DONE July 2026 (flag, off by default)

atomic_solver.DEPTH_GATE_K: at backtracking depth > K only the cheap tier
runs (through naked_tuples5). Enumeration measurements at K=1: blank 4x4
37.0s -> 2.6s (14x), nonsq 6x6 400.9s -> 7.7s (52x), same solutions. OPEN:
decide default adoption — needs the slow lsq suite measured with K=1..2
(single-solution hard puzzles may trade the other way), or an adaptive
variant (gate only when node throughput is high).

## Trail-based propagation instead of deepcopy-per-trial — OPEN (designed)

Design doc: TRAIL_DESIGN.md (July 2026). TrailedSet journaling, phased
nishio -> FC/FN -> backtracking; fish-memo staleness is the soundness trap;
corpus-within-10% gate on phase 1. The biggest remaining engine win for
enumeration workloads; composes with (and partially overlaps) the parallel
trials and depth gate above.

## Fish (parked — see FISH_REWRITE.md)

Base-first rewrite was implemented, validated equivalent, measured 5.5x
slower, reverted. Remaining options change solver behaviour and need an
owner decision: textbook-base restriction or incremental (dirty-tracking)
fish.
