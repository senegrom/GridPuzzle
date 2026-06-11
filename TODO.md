# TODO

Deferred solver ideas (June 2026 review). Ordered by expected payoff.

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
