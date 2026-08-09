# Development Notes

## Runtime baseline

GridPuzzle targets **Python 3.14 and newer**. Python 3.14 is the tested minimum; compatibility branches, CI jobs, dependency pins, and syntax constraints for older releases should not be added unless the support policy changes explicitly. Do not add an artificial upper bound for future Python releases.

The Hidato, Kakuro, Numbrix, and Slitherlink corpora are retained under `Examples/` as source material for future implementations. They are not currently parsed by the runtime and should not be treated as dead data.

## Architecture

### Solver pipeline

```
solve(grid)
  → clone once at the public API boundary     # caller-owned grid stays unchanged
  → _solve_full(working_grid)
    → AtomicSolver.solve_atomic()             # constraint propagation loop
      → _update_step()                        # rules + guarantees to a fixpoint
      → _solve_power_actions()                # increasingly expensive techniques
        → locked candidate, skyscraper        # cheap
        → rule helpers, naked tuples          # medium
        → wings, chains, ALS, Sue de Coq      # medium-expensive
        → forcing chain                       # expensive nested trials
        → hidden tuples, fish, finned fish    # combinatorial
        → AIC, Nishio                         # contradiction-based
        → forcing net                         # last deductive resort
    → if NONE: MRV backtracking with deterministic peer-pressure tie-breaking
       using nested trail_mark()/trail_undo() scopes
```

Top-level process-pool branches are independent copied/pickled grids. Within a
process, Nishio, forcing chains, forcing nets, and recursive backtracking reuse
one mutable grid through transactional trail scopes.

### Key design decisions

**The public solve API is non-mutating.**
`solve(grid)` creates one working clone before solving. The caller's givens,
candidates, rules, guarantees, fill state, and caches are not used as mutable
search state.

**Speculative work uses reversible trails.**
Candidate sets are `TrailedSet` objects that snapshot once per nested frame.
Known assignments, rule/guarantee transitions, parent cache dictionaries, and
fish dirty fingerprints are restored by `trail_undo()`. The event-driven
propagation queue is part of the same frame state, so sibling branches cannot
inherit consumed or branch-only work. Every speculative scope must undo in
`finally`. See `TRAIL_DESIGN.md` for the invariants and test coverage.

**Basic propagation is event-driven.**
Candidate and known-value changes mark their cells dirty. Cached watcher maps
then revisit only rules and guarantees touching those cells; newly registered
rules and guarantees are queued explicitly. Guarantee additions also wake only
guarantee-consuming rules that can contain them. The first pass after a clone
still schedules every live constraint, and structural changes invalidate the
watcher maps.

**AIC and ALS share one candidate topology snapshot.**
At a stalled atomic state, full houses, peer bitmasks, per-value candidate
bitmasks, ALS sets, and restricted-common links are built once for the adjacent
ALS-XZ and ALS-XY-Wing actions. AIC reuses the same immutable topology if no
intervening action changes the grid. Any action hit ends that power-action pass,
so a changed state always rebuilds the snapshot.

**Rules are immutable and shared across explicit clones.**
`Grid.deepcopy()` shallow-copies rule and guarantee sets but shares Rule
objects. Rule cells are immutable tuples, and hashing or registration freezes
all existing instance fields; attempts to alter cells, targets, or dimensions
then fail. Registration also rejects rules for another shape or value domain.
Deterministic `@cached_property` values may still be populated after freezing.
Rule and guarantee batches are fully validated before the first live-set
mutation. A malformed later replacement therefore cannot deactivate its
source rule or leave a partial batch behind; each successful batch also
invalidates structural caches only once.
Candidate sets and trail state are
new per clone, and structural caches deliberately start empty. Subclasses that
add instance state must override `Grid._copy_extra_state_to()` and detach that
state explicitly.

**Forcing chain uses the full AtomicSolver for trial branches.**
A `ContextVar`-backed recursion flag prevents forcing-chain recursion without
leaking state between concurrent solves. The inner solver runs all techniques
except forcing chain, Nishio, and forcing net. This gives maximum deductive
power; `example_t` solves with zero backtracking.

**All-invalid in forcing chain raises InvalidGrid.**
If all candidates of a cell lead to contradictions through the full constraint
engine, the grid is truly invalid. Propagation only removes candidates, so an
empty candidate set is irreversible. `AtomicSolver` also treats an explicit
`InvalidGrid` exception as authoritative even when a custom rule does not
mutate candidates before raising.

**Techniques using `unique_rule_cells` must filter to full-size groups.**
KenKen and Killer Sudoku cages create small `ElementsAtMostOnce` groups.
Techniques such as locked candidate and skyscraper assume groups have
`max_elem` cells. Filter with `len(group) == grid.max_elem`.

### Rule bugs found and fixed

**SumRule.apply() maximum formula was off by one:**

- Old: `remaining_sum - remaining_unknowns`
- Correct: `remaining_sum - remaining_unknowns + 1`, because every other
  unknown is at least 1.
- The bound is now applied only to unknown cells.

**ProdRule.apply() processed known cells:**

- Old: candidate pruning iterated every cage cell.
- Fixed: pruning is restricted to cells whose known value is zero.

Both defects could create false contradictions inside trial techniques on
KenKen puzzles.

**Trial propagation stopped before a full fixpoint:**

- Old: Nishio and forcing-net trials repeated only when known values changed.
- Fixed: snapshots also track total candidates and active/inactive rule and
  guarantee counts, so candidate-only and rule-only progress receives another
  pass.

**KenKen division used floating-point comparisons:**

- Old: quotient comparisons could round large integer ratios beyond `2**53`.
- Fixed: `DivRule` uses multiplication and `divmod`, preserving exact
  arbitrary-size integer semantics.

### Rich logging on Windows and Jupyter

Importing the solver does not initialize Colorama or mutate stdout. Terminal
configuration is explicit through `set_colouring`.

Verbosity and changed-grid rendering buffers are context-local. A
`solve(..., log_level=N)` override lasts only for that call and is restored on
exit; concurrent solves therefore do not overwrite each other's log level or
comparison buffer. Colour and root-handler configuration remain application
level by design.

- **Windows terminal / Colorama mode:** `just_fix_windows_console()` enables
  ANSI handling without repeatedly wrapping stdout.
- **Rich on a terminal with `stdout.buffer`:** Colorama is deinitialized,
  stdout is wrapped as UTF-8, and Rich uses its default terminal detection.
- **Jupyter:** stdout is an `OutStream` without `.buffer`; Rich uses
  `Console(force_jupyter=True)`.

### Performance notes

- **Per-technique diagnostics are opt-in and context-local.** Normal solves do
  not update counters or collect timings. Use
  `with atomic_solver.collect_power_stats() as stats:` and render the result
  with `stats.table()`. Nested solvers share that explicit context, parallel
  workers return independent summaries which the parent merges, and concurrent
  solve contexts do not share mutable counters. The technique-statistics
  harness uses this API. June 2026 corpus
  measurements found fish(4), finned-fish(3), fish(3), and
  hidden-tuples(7) had zero hits in roughly 900–1400 tries while consuming
  most forcing-chain branch time. Excluding them from inner branches made
  the corpus 6.6x faster with identical solutions and hit profiles.
- **Guarantee propagation is incremental.** Each guarantee is evaluated in one
  pass over its cells, and unchanged guarantees are skipped until a watched
  candidate or known value changes. Subset-dominance grouping is recomputed
  only after the live guarantee set grows. Guarantee-only caches survive rule
  churn, and trail rollback restores their parent reference.
- **Fish dominates profiling** on 9x9 grids. Value-first iteration and the
  inlined size-2 fast path help; on 16x16 and larger grids,
  group-combination growth is the bottleneck.
- **Fish dirty fingerprints are transactional.** A `TrailedDict` preserves
  parent fingerprints between sibling trials while rolling back branch-only
  entries. Do not replace it with a plain dict unless every undo clears it;
  stale fingerprints can skip required eliminations.
- **Manual `Grid.deepcopy()`** replaces `copy.deepcopy`; it remains relevant
  for API isolation and process-pool payloads even though per-node search no
  longer clones. After root propagation, process workers receive a fresh
  cache-free clone so large structural and fish memo state is not serialized
  once per submitted branch.
- **Rule and guarantee watcher indexes** turn basic propagation from repeated
  full-set scans into dirty-cell worklists. The indexes are structural caches:
  consumers must not mutate them, and rule/guarantee registration invalidates
  them before the next selection pass.
- **Snapshot change detection** tracks known bytes, total candidate count, and
  active/inactive rule and guarantee counts. The state is monotone, so this
  captures candidate, value, and structural progress without deep comparison.
- **Structural caches use copy-on-invalidate inside trails.** A branch swaps in
  a fresh dictionary rather than clearing its parent's cache object; rollback
  restores the parent reference.
- **Monkey-patching pitfall:** `from module import function` binds at import
  time. Prefer dependency injection or patch at the actual call site.

## Validation policy

The default workflow installs the package from `pyproject.toml`, builds a
wheel, checks the installed console script, runs under Python development mode
(`-X dev`), compiles the sources, and executes the bounded regression, trail,
differential-oracle, core, and scale suites on Linux. It also runs
representative end-to-end examples and a Windows regression smoke job.

Pytest output is captured by default; live logging is not globally enabled.
This keeps enumeration tests from emitting hundreds of solved grids into CI
logs while retaining captured output on failures.

A weekly/manual extended workflow shards three expensive groups:

- every supported example corpus not already in the push workflow;
- generated 49x49 through 100x100 Sudoku propagation tests;
- the slow pandiagonal Latin-square corpus.

Unsupported future-family corpora are preserved but are not executed until
runtime loaders and independent validators exist for them.
