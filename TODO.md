# TODO

Deferred solver ideas (June 2026 review). Ordered by expected payoff.

## Known issues — rules-layer scan (June 2026; none reachable from the suite)

1. **ProdRule float division** (sumrules.py ~179-206): exact-divisibility via
   `/` and `k != int(k)` breaks silently once cage products exceed 2^53 (large
   Kenken cages). Fix with divmod integer arithmetic.
2. **Factorial landmine** (sumrules.py `_filter_new_sum_candidates` +
   rulehelpers complement cages): permutations of all unknown cage cells are
   enumerated per apply, and rulehelper_sum_atmostonce creates complement
   cages with NO size cap — a 12x12+ killer would effectively hang. Cap the
   complement size like _MAX_INNIE, or replace enumeration with a
   Hall-condition feasibility check.
3. **DiagonalLatinSquare is actually pandiagonal** (latins_square.py): builds
   all 2n broken diagonals; matches every current example (all are
   pandiagonal) but the name/loader keyword would over-constrain a genuine
   diagonal puzzle. Rename + add a true diagonal variant.
4. Minor: ImmutableGrid eq/hash ignores dimensions (cross-shape dedup risk in
   user code); Guarantee hash/eq contract mismatch vs raw tuples; SumRule
   lacks a tmin prune and ProdRule a divisor prune; two pruning sites don't
   raise InvalidGrid on emptied sets (one extra round to detect); guarantee
   scans in ElementsAtMostOnce/UneqRule are O(rules x guarantees) per round —
   the n=100 scale cost driver; run.py -c blocks latinsquare/kenken that -f
   supports; _partition_dic cache is unbounded process-wide.

## Adaptive technique gating (from the AIC-in-FC experiment)

Measured June 2026: excluding AIC from forcing-chain inner solvers makes
sudoku-t-hard 43% faster (264s -> 151s; its 475 inner-AIC hits were not
load-bearing) but the pandiagonal-11x11 4.5x SLOWER (16.5s -> 75s; there
inner AIC ran at a 65% hit rate and FC tries tripled without it). Any static
in/out rule picks a loser, and per-puzzle-type gating would be special-casing.
The general follow-up: adaptive gating — a technique that misses N consecutive
times on a grid (and its clones) gets skipped inside FC until something
changes (e.g. rule-generation bump), with the miss counters carried into
clones. Reverted the static exclusion.

## Speeding up house-rich grids (pandiagonals) — general mechanisms only

Why it's slow: a pandiagonal n×n has ~4n houses, so per-value pattern spaces
(fish covers, finned covers) are ~C(4n, f) — and the solver re-enumerates them
every power round even when nothing relevant changed. All fixes below are
general; none special-case diagonals.

1. **DONE for fish/finned (June 2026): per-value dirty fingerprints**
   (solve_fish._value_memo). Open remainder: the same idea for x_chain and
   skyscraper — deliberately skipped so far because both are cheap (~1.5s
   corpus total); revisit only if profiles change.
2. **DONE (June 2026): hit-rate instrumentation + data-driven exclusion.**
   tries/hits/time counters live in atomic_solver + logger; corpus harness in
   tests/technique_stats_harness.py. Data: fish(4)/finned(3)/fish(3)/
   hidden_tuples(7) had zero hits anywhere, ~90% of executions inside FC
   branches. Excluded from FC inner solvers -> corpus 6.6x faster (t-hard
   1872s->273s, pandiagonal-11x11 188s->33s), identical solutions. Note:
   demoting zero-hit tiers within the list saves nothing — they run in every
   fully-stalled round regardless of position; exclusion is the lever.
   Combined with the per-value memo (idea 1): the slow pandiagonal suite test
   went 3h09m -> 22m28s (8.4x), same solutions.
3. **REJECTED (June 2026): pruned recursion inside the fish enumeration.**
   Implemented (take/skip index recursion, suffix unions, subtree prune when
   fewer than f guarantees fit the potential union), validated exactly
   equivalent — and measured: corpus flat, cold fish calls 12% SLOWER. The
   prune's win case (sparse guarantees) is exactly what the per-value memo
   (idea 1) already skips, and plentiful-guarantee states gate the prune off
   while paying Python-recursion overhead against C-level
   itertools.combinations. Reverted; not worth the complexity.
4. Trail-based propagation and parallel trials (below) also apply: the
   pandiagonal tests backtrack, and fish is per-value parallelisable on a
   free-threaded build.
5. **Long term: per-value candidate bitmasks** maintained incrementally on the
   Grid; fish/chain subset tests become single int ops, and the bitmask doubles
   as the fingerprint for idea 1. Invasive (all mutation sites need an API).

## Trail-based propagation instead of deepcopy-per-trial
Every backtracking node and every nishio/forcing-chain/forcing-net branch pays a
full `Grid.deepcopy`. An undo trail (log of candidate removals + rule/guarantee
activations, popped on backtrack) makes trial/undo nearly free — the classic
5–20× win for enumeration-heavy workloads (blank grids, multi-solution counts).
Architectural refactor: rule add/deactivate must become undoable. Write a short
design doc before starting.

## Depth-gated technique tiers in backtracking
At trial depth > k, run only cheap propagation (singles, locked candidate,
skyscraper) instead of the full power-action list — deep contradictions usually
surface from cheap propagation anyway. Behavior-affecting trade (more nodes,
much cheaper nodes): implement behind a flag and measure on the enumeration
tests before adopting.

## Parallelize top-level backtracking trials
First-level branches in `_solve_full` are independent. Distribute them over a
`multiprocessing` pool (`ImmutableGrid` results pickle fine), or threads on a
free-threaded 3.14+ build. Near-linear speedup for enumeration workloads.

## Fish (parked — see FISH_REWRITE.md)
Base-first rewrite was implemented, validated equivalent, measured 5.5× slower,
reverted. Remaining options change solver behaviour and need an owner decision:
textbook-base restriction or incremental (dirty-tracking) fish.
