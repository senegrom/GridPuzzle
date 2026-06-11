# TODO

Deferred solver ideas (June 2026 review). Ordered by expected payoff.

## Speeding up house-rich grids (pandiagonals) — general mechanisms only

Why it's slow: a pandiagonal n×n has ~4n houses, so per-value pattern spaces
(fish covers, finned covers) are ~C(4n, f) — and the solver re-enumerates them
every power round even when nothing relevant changed. All fixes below are
general; none special-case diagonals.

1. **Per-value dirty fingerprints.** Fish/finned/x-chain/skyscraper are
   per-value independent: results for value v depend only on v's guarantees,
   v's candidate positions and the house structure. Cache a fingerprint per
   (technique, f, value); skip v when unchanged since the last completed pass —
   re-running would only re-apply idempotent eliminations. Exact, sound, and
   the dominant waste on slow grids (most rounds touch one or two values).
   This is the concrete form of "incremental fish".
2. **Hit-rate instrumentation, then data-driven tiering.** Count eliminations
   per technique (time_ctxt already exists; add hit counters) and summarise per
   puzzle. If fish(4)/finned(3) almost never fire across the whole corpus,
   demote them below forcing_chain or lower _MAX_FISH — a global constant
   change justified by measurement, not a per-puzzle-type hack.
3. **Pruned recursion inside the existing fish enumeration.** Same cover-first
   semantics, but recurse over house indices with a running union and
   precomputed suffix unions; cut any subtree where fewer than f guarantees fit
   in (running ∪ suffix) union. Exact-equivalent; multiplies with idea 1.
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
