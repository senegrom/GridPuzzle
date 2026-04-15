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
`Grid.deepcopy()` shallow-copies the rules/guarantees sets but shares Rule objects. This is safe because Rule objects never mutate after construction (`@cached_property` values are deterministic). `Grid.deep_deepcopy()` exists for full isolation but isn't needed in practice.

**Forcing chain uses the full AtomicSolver for trial branches.**
The `_in_forcing_chain` module-level flag prevents recursion. The inner solver runs ALL techniques except FC/nishio/forcing_net. This gives maximum deductive power — example_t solves with zero backtracking.

**Both-INVALID in forcing chain raises InvalidGrid.**
If all candidates of a cell lead to contradictions via the full constraint propagation engine, the grid is truly invalid. This is sound because propagation only removes candidates (never adds), so an empty candidate set is an irreversible contradiction.

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

### Rich Logging on Windows / Jupyter

- **Windows terminal**: `colorama.init()` wraps stdout with cp1252 encoding, breaking Rich's Unicode box-drawing characters. Fix: `deinit()` colorama, wrap `sys.stdout.buffer` with `io.TextIOWrapper(encoding='utf-8')`, use `Console(force_terminal=True)`.
- **Jupyter**: stdout is an `OutStream` without `.buffer`. Fix: use `Console(force_jupyter=True)` without deinit. Check `hasattr(sys.stdout, 'buffer')` to detect environment.

### Performance Notes

- **Fish dominates profiling** (60%+ on 9x9). Value-first iteration and inlined f=2 fast path help. For 16x16+, the combinatorial explosion of group combinations is the bottleneck.
- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy` — `array('I', self._known)` and `tuple(s.copy() for s in self._candidates)` are much faster.
- **`list(self.grid.rules)` snapshot** instead of `set.copy()` for iteration during rule application.
- **`all_but_rule_equal()`** for change detection in the solve loop — cheaper than full `__eq__` which compares rules/guarantees.
- **Monkey-patching pitfall**: `from X import func` binds at import time. Patching `module.func` doesn't affect already-imported references. Use module-level flags or patch at the call site.
