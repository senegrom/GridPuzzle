# Trail-based propagation — design (June 2026)

## Problem

Every trial pays a full `Grid.deepcopy`: backtracking nodes (`_solve_full`),
nishio (per candidate of per cell), forcing-chain branches, forcing-net
combinations. A deepcopy is O(cells + total candidates + rule/guarantee set
sizes); a typical trial changes a tiny fraction of that before being thrown
away. An undo trail makes trial/undo proportional to the *changes*, the
classic 5-20x for enumeration-heavy workloads.

## Key facts making this tractable

1. **Rule/guarantee mutations are already centralized** in exactly four Grid
   methods (`add_rule_checked`, `deactivate_rule`, `add_gtee_checked`,
   `deactivate_gtee`) — verified during the struct-cache work. Journaling them
   is four try-finally-free appends.
2. **Candidate sets are mutated raw everywhere** (~50 technique sites using
   `discard/remove/clear/intersection_update/&=/-=`). Rewriting the sites is
   out; instead a `TrailedSet(set)` subclass overrides the mutating methods to
   journal removed elements into a grid-owned trail. Techniques keep their
   code unchanged; propagation is removal-only (the monotonicity invariant),
   so undo = re-add journaled values.
3. **Knowns** go through `Grid.__setitem__` (one journal point; old value is
   always 0 by the set-once invariant).

## Design

- `grid.trail_mark() -> int` (len of trail), `grid.trail_undo(mark)` replays
  entries in reverse: re-add candidate values, reset knowns to 0, re-activate
  deactivated rules / remove added ones (and the guarantee twins), clear the
  struct cache once at the end.
- Trail entries: `("cand", set_ref, frozenset_removed)`, `("known", idx)`,
  `("rule+", rule)`, `("rule-", rule)`, `("gt+", gt)`, `("gt-", gt)`.
- Trials become `mark = g.trail_mark(); g[cell] = v; ...; g.trail_undo(mark)`
  instead of `clone = g.deepcopy()`.

## Correctness traps (must-handle)

- **Fish per-value memo**: it records "pass completed for fingerprint X".
  Under undo, the eliminations of the abandoned branch are rolled back while
  the memo still claims them — a stale skip would be UNSOUND. Journal memo
  writes (entry `("memo", key, old_value_or_absent)`) or clear the memo on
  every undo (cheap, loses little).
- **`hidden_pair_checked_gts`** lives on AtomicSolver instances (fresh per
  trial) — unaffected.
- **Exception safety**: undo must run in `finally`; InvalidGrid mid-trial is
  the NORMAL path for nishio/FC.
- **`has_been_filled`** and logging state: harmless.

## Risks / measurements gates

- `TrailedSet` adds Python-level dunder overhead to every candidate mutation
  (all solving, not just trials). Gate: corpus must stay within ~10% before
  proceeding past phase 1; otherwise consider journaling only inside trials
  (swap a module flag) or a C-level accelerator later.
- Equivalence: a fuzz comparing trail-trials vs deepcopy-trials solution sets
  on random puzzles, plus the full suite.

## Phased plan (each phase suite-validated, separately committed)

1. `TrailedSet` + candidate/known journaling; convert **nishio only**
   (smallest blast radius, ~n*cands trials per call). Measure corpus.
2. Convert forcing-chain and forcing-net branches (memo handling lands here).
3. Convert backtracking trials in `_solve_full` (rule/guarantee journaling
   required from here on; solutions are ImmutableGrid snapshots, unaffected).
4. Remove `Grid.deepcopy` from the hot paths entirely; keep it for API use.

Expected: phase 1 alone speeds nishio-heavy solves; phases 2-3 are where the
5-20x on blank-grid enumeration lives (test_sudo1, test_ex_blank_sudoku).
