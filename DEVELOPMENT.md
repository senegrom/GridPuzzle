# Development Notes

## Runtime baseline

GridPuzzle targets **Python 3.14 only**. Compatibility branches, CI jobs, dependency pins, and syntax constraints for older Python releases should not be added unless the support policy changes explicitly.

The Hidato, Kakuro, Numbrix, and Slitherlink corpora are retained under `Examples/` as source material for future implementations. They are not currently parsed by the runtime and should not be treated as dead data.

## Architecture

### Solver pipeline

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

### Key design decisions

**Rules are immutable and shared across deepcopy clones.**
`Grid.deepcopy()` shallow-copies the rule and guarantee sets but shares Rule objects. This is safe because Rule objects never mutate after construction (`@cached_property` values are deterministic). The clone also preserves `has_been_filled`; structural caches are deliberately rebuilt per clone.

**Forcing chain uses the full AtomicSolver for trial branches.**
A `ContextVar`-backed recursion flag prevents forcing-chain recursion without leaking state between concurrent solves. The inner solver runs all techniques except forcing chain, Nishio, and forcing net. This gives maximum deductive power; `example_t` solves with zero backtracking.

**All-invalid in forcing chain raises InvalidGrid.**
If all candidates of a cell lead to contradictions via the full constraint engine, the grid is truly invalid. Propagation only removes candidates, so an empty candidate set is irreversible. `AtomicSolver` also treats an explicit `InvalidGrid` exception as authoritative even when a custom rule does not mutate candidates before raising.

**Techniques using `unique_rule_cells` must filter to full-size groups.**
KenKen and Killer Sudoku cages create small `ElementsAtMostOnce` groups. Techniques such as locked candidate and skyscraper assume groups have `max_elem` cells. Filter with `len(group) == grid.max_elem`.

### Rule bugs found and fixed

**SumRule.apply() maximum formula was off by one:**
- Old: `remaining_sum - remaining_unknowns`
- Correct: `remaining_sum - remaining_unknowns + 1`, because every other unknown is at least 1
- The bound is now applied only to unknown cells

**ProdRule.apply() processed known cells:**
- Old: candidate pruning iterated every cage cell
- Fixed: pruning is restricted to cells whose known value is zero

Both defects could create false contradictions inside trial techniques on KenKen puzzles.

**Trial propagation stopped before a full fixpoint:**
- Old: Nishio and forcing-net trials repeated only when known values changed
- Fixed: snapshots also track total candidates and active/inactive rule and guarantee counts, so candidate-only and rule-only progress receives another pass

**KenKen division used floating-point comparisons:**
- Old: quotient comparisons could round large integer ratios beyond `2**53`
- Fixed: `DivRule` uses multiplication and `divmod`, preserving exact arbitrary-size integer semantics

### Rich logging on Windows and Jupyter

Importing the solver does not initialize Colorama or mutate stdout. Terminal configuration is explicit through `set_colouring`.

- **Windows terminal / Colorama mode:** `just_fix_windows_console()` enables ANSI handling without repeatedly wrapping stdout.
- **Rich on a terminal with `stdout.buffer`:** Colorama is deinitialized, stdout is wrapped as UTF-8, and Rich uses `Console(force_terminal=True)`.
- **Jupyter:** stdout is an `OutStream` without `.buffer`; Rich uses `Console(force_jupyter=True)`.

### Performance notes

- **Per-technique tries/hits/time:** `atomic_solver.POWER_TRIES`, `POWER_HITS`, and `lg.time_stats` are reported by `tests/technique_stats_harness.py`. June 2026 corpus measurements found fish(4), finned-fish(3), fish(3), and hidden-tuples(7) had zero hits in roughly 900–1400 tries while consuming most forcing-chain branch time. Excluding them from inner branches made the corpus 6.6x faster with identical solutions and hit profiles.
- **Fish dominates profiling** on 9x9 grids. Value-first iteration and the inlined size-2 fast path help; on 16x16 and larger grids, group-combination growth is the bottleneck.
- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy`; `array('I', self._known)` and `tuple(candidates.copy() for candidates in self._candidates)` are substantially faster.
- **Rule iteration snapshots** use `list(self.grid.rules)` instead of copying a set.
- **Snapshot change detection** tracks `(bytes(_known), total candidate count, active rule+guarantee count, inactive rule+guarantee count)`. The state is monotone, so this captures candidate, value, and structural progress without deep-copy comparison.
- **`Grid.cached_struct`** memoizes structures derived from rules and guarantees. It is cleared on structural mutation and is not shared with clones. Cached objects must not be mutated by consumers.
- **Monkey-patching pitfall:** `from module import function` binds at import time. Prefer dependency injection or patch at the actual call site.

## Validation policy

The default workflow installs the package from `pyproject.toml`, runs under Python development mode (`-X dev`), compiles all Python sources, executes the bounded regression/core/scale suite on Linux, runs representative end-to-end examples, and runs a Windows regression smoke job. Long corpus tests remain marked `slow` and are opt-in.
