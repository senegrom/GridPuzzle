# Development Notes

## Architecture

### Solver Pipeline
```
solve(grid)
  → _solve_full(grid.deepcopy())          # backtracking wrapper
    → AtomicSolver.solve_atomic()          # constraint propagation loop
      → _update_step()                     # rules + guarantees, repeat until fixpoint
      → _solve_power_actions()             # increasingly expensive techniques (generator)
        → locked_candidate, skyscraper     # cheap
        → rulehelpers, naked_tuples(5)     # medium
        → wings, chains, ALS, sue_de_coq   # medium-expensive
        → forcing_chain                    # expensive (runs inner AtomicSolver per trial)
        → hidden_tuples, fish, finned_fish # combinatorially expensive
        → AIC, nishio                      # per-cell trial propagation
        → fish(large), finned_fish(large)  # most expensive combinatorial
        → forcing_net                      # last resort (pairs of cells)
    → if NONE: backtracking via MRV heuristic
```

### Key Design Decisions

**Rules are immutable and shared across deepcopy clones.**
`Grid.deepcopy()` shallow-copies the rules/guarantees sets but shares Rule objects. This is safe because Rule objects never mutate after construction (`@cached_property` values are deterministic). The clone also preserves `has_been_filled`; structural caches are deliberately rebuilt per clone.

**Forcing chain uses the full AtomicSolver for trial branches.**
A `ContextVar`-backed recursion flag prevents forcing-chain recursion without leaking state between concurrent solves. The inner solver runs all techniques except FC/nishio/forcing_net. This gives maximum deductive power — example_t solves with zero backtracking.

**All-INVALID in forcing chain raises InvalidGrid.**
If all candidates of a cell lead to contradictions via the full constraint propagation engine, the grid is truly invalid. This is sound because propagation only removes candidates (never adds), so an empty candidate set is an irreversible contradiction. `AtomicSolver` also treats an explicit `InvalidGrid` exception as authoritative even when a custom rule does not mutate candidates before raising.

**Techniques that use `unique_rule_cells` must filter to full-size groups.**
KenKen/Killer cages create small `ElementsAtMostOnce` groups. Techniques like locked_candidate and skyscraper assume groups have `max_elem` cells (rows/cols/boxes). Filter with `len(grp) == grid.max_elem`.

### Rule Bugs Found and Fixed

**SumRule.apply() tmax formula (off by 1):**
- Old: `tmax = self.sum - current_sum + lk - len(self.cells)` = `remaining_sum - remaining_unknowns`
- Correct: `tmax = remaining_sum - remaining_unknowns + 1` (minimum value per unknown is 1)
- Also: was applied to known cells, now guarded by `if known[cell] == 0`

**ProdRule.apply() tmax applied to known cells:**
- Old: iterated ALL cells including known ones
- Fixed: `if known[cell] == 0` guard

Both bugs caused false contradictions in trial-based techniques (forcing chain, nishio) on KenKen puzzles, because the over-aggressive elimination emptied candidate sets that should have remained valid.

**Trial propagation stopped before a full fixpoint:**
- Old: Nishio/forcing-net trial propagation repeated only when known values changed.
- Fixed: the snapshot also tracks total candidates and active/inactive rule and guarantee counts, so candidate-only and rule-only progress receives another pass.

**KenKen division used floating-point comparisons:**
- Old: quotient comparisons could round large integer ratios beyond `2**53`.
- Fixed: KenKen division cages use multiplication and `divmod`, preserving exact integer semantics.

### Rich Logging on Windows / Jupyter

Importing the solver does not initialize Colorama or mutate stdout. Terminal configuration is explicit through `set_colouring`.

- **Windows terminal / Colorama mode**: `just_fix_windows_console()` enables ANSI handling without wrapping stdout repeatedly.
- **Rich on a terminal with `stdout.buffer`**: Colorama is deinitialized, stdout is wrapped as UTF-8, and Rich uses `Console(force_terminal=True)`.
- **Jupyter**: stdout is an `OutStream` without `.buffer`; Rich uses `Console(force_jupyter=True)`.

### Performance Notes

- **Per-technique tries/hits/time**: `atomic_solver.POWER_TRIES/POWER_HITS` +
  `lg.time_stats`, reported by `tests/technique_stats_harness.py`. June 2026
  corpus data: fish(4), finned-fish(3), fish(3) and hidden_tuples(7) had ZERO
  hits in ~900-1400 tries while costing ~80% of solve time — ~90% of their
  executions inside forcing-chain branches. They are now excluded from FC
  inner solvers (like nishio/forcing_net); corpus got 6.6x faster with
  identical solutions and hit profiles.
- **Fish dominates profiling** (60%+ on 9x9). Value-first iteration and inlined f=2 fast path help. For 16x16+, the combinatorial explosion of group combinations is the bottleneck.
- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy` — `array('I', self._known)` and `tuple(s.copy() for s in self._candidates)` are much faster.
- **`list(self.grid.rules)` snapshot** instead of `set.copy()` for iteration during rule application.
- **Snapshot change detection** in the solve loop: `(bytes(_known), total candidate count, active rule+guarantee count, inactive rule+guarantee count)` instead of deep-copying the grid and comparing. Cell state is monotone (knowns only get set, candidates only shrink) and the inactive sets only grow, so every mutation — including rule-only progress by the rulehelpers — is detected.
- **`Grid.cached_struct`** memoizes rule/guarantee-derived structures (`unique_rule_cells`, `weak_links`, `semi_strong_links`, `guarantee_cells_by_value`, fish's relevant-houses map). The cache clears on any rule/guarantee add/deactivate and is not shared with deepcopy clones. Cached objects must not be mutated by consumers — `xy_chain` copies `weak_links` before pruning it, and `semi_strong_links_all` shallow-copies the base lists.
- **Monkey-patching pitfall**: `from X import func` binds at import time. Patching `module.func` doesn't affect already-imported references. Prefer dependency injection or patch at the call site.
