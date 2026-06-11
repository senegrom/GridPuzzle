# Fish Rewrite Plan

## Why

Live profiling (py-spy, June 2026) during the pandiagonal latin-square tests showed
10/12 stack samples inside `fish`/`finned_fish`. The cause is the enumeration order:

- For each value the implementation iterates `combinations(relevant_houses, f)`
  (cover sets) and only then looks for disjoint guarantees inside each union.
- A pandiagonal n×n latin square has ~4n houses (n rows, n cols, 2n broken
  diagonals). For n=11 and f=4 that is C(44,4) ≈ 135,000 cover sets *per value*,
  ≈ 1.1M for finned fish (f+1 houses) — each paying a frozenset union plus a
  subset-filter over all of that value's guarantees, repeated every power round.
- For 9×9 sudoku (27 houses) the same code is fine; the blow-up is specific to
  house-rich grids.

`Grid.cached_struct` (June 2026) already removed the repeated *setup* cost
(`relevant_urs_by_val` is now computed once per rule/guarantee generation instead
of 6× per round). The combinatorial core is untouched and is what this rewrite addresses.

## Current semantics (must be preserved exactly)

For value v, fish size f (`fish`):
- Bases: f pairwise-disjoint guarantees G₁..G_f for v, each `Gᵢ ⊆ U₁∪…∪U_f`.
  Note: a single guarantee may span multiple cover houses — the constraint is
  containment in the *union*, not in a single house.
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
makes exact equivalence testing possible.

## Proposed algorithm: base-first enumeration

Flip the loops — enumerate disjoint guarantee combinations first, then solve the
tiny set-cover instance for them:

```
for value v:
    gts = guarantees for v (sorted by len)
    cell_houses = precomputed cell -> houses-containing-it (cached_struct)
    recurse(prefix=[], union=∅):
        prune: if lower_bound_cover(union) > f: return            # see below
        if len(prefix) == f:
            for cover in covers(union, f): apply eliminations
            return
        for gt in gts after prefix's last index:
            if gt ∩ union: continue                               # disjointness
            recurse(prefix + [gt], union | gt)

covers(cells, f):  # exact set cover by ≤ f houses, branching on the
                   # least-covered uncovered cell; houses_per_cell ≤ 4
    ≈ 4^f worst-case branchings — trivial vs C(4n, f)
lower_bound_cover(cells): greedy/duplicate-aware bound, monotone in cells,
    so it prunes prefixes early.
```

- Complexity becomes O(#viable disjoint base combos × small cover search)
  instead of O(C(houses, f) × guarantee filter). Disjointness + the cover bound
  prune the base recursion hard (guarantees overlap heavily in practice).
- `finned_fish`: same recursion; cover search targets f+1 houses with the
  intersection requirement; eliminations per the finned rules above.
- Duplicate (bases, covers) pairs must be deduped (a base set may admit several
  cover sets — the old code applied each; preserve that by enumerating all
  minimal covers, then applying eliminations per cover set found).

## Equivalence & benchmark harness (ready to run)

`tests/fish_rewrite_harness.py` (not collected by pytest; run as a script):
- vendors today's `fish`/`finned_fish` verbatim as `legacy_fish`/`legacy_finned_fish`
  (frozen reference, immune to later edits of `solve_fish.py`),
- captures realistic mid-solve grid states by patching `atomic_solver.fish`
  (patch the *imported binding*, not `solve_fish.fish` — see the monkey-patching
  pitfall in DEVELOPMENT.md) while solving a mix of examples,
- asserts exact `_candidates` equality between legacy and current implementation
  on every captured state, for fish and finned fish at f = 2, 3, 4,
- times both implementations per state and reports totals.

Workflow for the rewrite:
1. `python tests/fish_rewrite_harness.py` → must report all-equal (trivially true
   before the rewrite; run once to validate the harness itself).
2. Implement the new enumeration in `solve_fish.py` behind the same signatures.
3. Re-run the harness: equality must hold on every captured state; timing section
   quantifies the win (expect the pandiagonal states to dominate).
4. Run the full pytest suite (the lsq/pandiagonal tests are the wall-clock check).
5. Delete nothing from the harness — it stays as the regression net for future
   fish work.

## Risks / notes

- The guarantee-based fish here is more general than textbook fish (bases are
  guarantees, not candidate row/col positions); equivalence must be judged against
  *this* code, not against literature — hence the vendored reference.
- The cover search must allow guarantees spanning multiple cover houses (union
  containment only). A per-guarantee single-house assumption would silently lose
  patterns.
- Keep the f=2 fast path only if the harness timing still justifies it; the
  base-first scheme may make it redundant.
- An explicit enumeration cap was considered and rejected (2026-06-11): owner
  prefers completeness; the rewrite should make caps unnecessary.
