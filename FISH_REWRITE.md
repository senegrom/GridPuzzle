# Fish rewrite

## Status: attempted and reverted (2026-06-11)

A base-first rewrite (enumerate disjoint guarantee combinations first, then
solve the small set-cover instance for their union) was implemented as
planned, validated as byte-identical to the reference on all harness states
(including synthetic edge cases for free-house covers, cannibals and finned
intersections) — and benchmarked **5.5× slower** than the cover-first original
(554 s vs 100 s over the same captured states; in-solver finned fish on the
11×11 pandiagonal went from ~11 s to ~70 s per call). It was reverted the same
day.

**Why the plan's assumption failed:** on house-rich grids, guarantees are
small cell-sets scattered over a large grid, so almost every f-combination of
guarantees is pairwise disjoint *and* coverable — the disjointness and
cover-bound prunes never bind. Worse, since `relevant` houses each contain at
least one full guarantee, nearly *every* f-subset of houses admits f disjoint
bases: the pattern space really is ~C(houses, f), and any exactly-equivalent
algorithm must visit it. The enumeration order was never the bottleneck — the
guarantee-generalised fish *semantics* is. (A pandiagonal n×n Latin square has
~4n houses; for n = 11 and f = 4 that is C(44, 4) ≈ 135,000 cover sets per
value, ≈ 1.1M for finned fish, every power round.)

**Real options (owner decision required; only option 1 changes behaviour —
option 2 is exact, it just needs per-pattern bookkeeping):**
1. Restrict bases to textbook fish (per base house, the candidate positions of
   the value, requiring ≤ f positions per base house) — collapses the pattern
   space to the classical one; loses some exotic-but-sound eliminations that
   backtracking currently compensates for anyway.
2. Incremental fish: only re-examine patterns whose guarantees/houses changed
   since the last pass (requires per-pattern bookkeeping across rounds; exact
   but complex).

An enumeration cap was considered and rejected the same day: the owner
prefers completeness.

## Current semantics (must be preserved exactly)

For value v, fish size f (`fish`):
- Bases: f pairwise-disjoint guarantees G₁..G_f for v, each `Gᵢ ⊆ U₁∪…∪U_f`.
  Note: a single guarantee may span multiple cover houses — the constraint is
  containment in the *union*, not in a single house. A per-guarantee
  single-house assumption would silently lose patterns.
- Covers: f houses (full-size `ElementsAtMostOnce` groups, `unique_rule_cells`).
- Eliminations:
  1. v removed from every cover-house cell outside `all_gts = ∪Gᵢ`.
  2. "Cannibal": v removed from cells *inside* `all_gts` that lie in ≥ 2 cover houses.

`finned_fish` differs only in: f+1 cover houses, at least one nonempty pairwise
house intersection required, eliminations restricted to cells in pairwise cover
intersections (outside `all_gts`), and the cannibal threshold is ≥ 3 houses.

Both are *order-independent within one call*: pattern detection reads only
guarantees/houses (never candidates), candidates are only written. So the final
candidate state after a full enumeration is a pure set-difference — this is what
makes exact equivalence testing possible. The guarantee-based fish is more
general than textbook fish (bases are guarantees, not candidate row/col
positions); equivalence must be judged against *this* code, not against the
literature.

## Harness

`tests/fish_rewrite_harness.py` (not collected by pytest; run as a script)
vendors the reference `fish`/`finned_fish` verbatim, captures realistic
mid-solve grid states by patching `atomic_solver.fish` (the *imported binding*
in atomic_solver, not `solve_fish.fish` — a from-import binds at import time,
so patching the source module is a silent no-op) while solving a mix of
examples, asserts exact `_candidates` equality between reference and current
implementation on every captured state for fish and finned fish at f = 2, 3, 4,
and times both. Any future attempt runs it before (all-equal, trivially) and
after, then the full pytest suite; the lsq/pandiagonal tests are the wall-clock
check. The harness is never deleted.
