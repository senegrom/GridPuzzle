# Development Notes

## Runtime baseline

GridPuzzle targets **Python 3.14 and newer**. Python 3.14 is the tested minimum; compatibility branches, CI jobs, dependency pins, and syntax constraints for older releases should not be added unless the support policy changes explicitly. Do not add an artificial upper bound for future Python releases.

The Hidato, Kakuro, Numbrix, and Slitherlink corpora under `Examples/` are active runtime inputs. They must remain in the repository and are exercised through isolated scheduled corpus jobs.

## Architecture

### Solver pipeline

```text
solve(grid)
  → clone once at the public API boundary     # caller-owned grid stays unchanged
  → _solve_full(working_grid)
    → AtomicSolver.solve_atomic()             # constraint propagation loop
      → _update_step()                        # rules + guarantees to a fixpoint
      → _solve_power_actions()                # profile-selected deductions
    → if NONE: MRV backtracking with deterministic peer-pressure tie-breaking
       using nested trail_mark()/trail_undo() scopes
```

Top-level process-pool branches are independent copied/pickled grids. Within a process, Nishio, forcing chains, forcing nets, and recursive backtracking reuse one mutable grid through transactional trail scopes.

### Technique profiles

Every grid class declares a `TechniqueProfile`:

- `FULL` runs the complete house/geometry hierarchy: locked candidates, skyscrapers, empty rectangles, wings, chains, ALS, Sue de Coq, fish, AIC, contradiction techniques, and backtracking.
- `GENERIC` retains deductions that depend only on declared rules and guarantees: rule helpers, tuple reasoning, forcing chains, Nishio, forcing nets, and backtracking. It excludes Sudoku-specific geometric patterns.
- `RULES_ONLY` performs rule/guarantee propagation and ordinary branching without the expensive generic power tier.

The measured defaults are:

| Family | Profile |
|---|---|
| Sudoku, Killer Sudoku, Futoshiki, KenKen, Latin-square variants | `FULL` |
| Kakuro | `GENERIC` |
| Hidato, Numbrix, Slitherlink | `RULES_ONLY` |

The path choices are evidence-based. On the retained Parade expert Numbrix, `GENERIC` produced the same deterministic solution but took roughly four times as long as `RULES_ONLY`. On the retained Hidato corpus, the complete path rule plus pre-seeded value-presence guarantees made the generic tuple and contradiction tier redundant; `RULES_ONLY` preserved exact solutions and removed the two former path timeouts. Kakuro remains `GENERIC` because its overlapping sum/all-different runs still benefit from generic deductions.

Do not infer technique applicability from the compact one-row storage layout. Add or change a profile only after independent solution equivalence and family-specific benchmarks with `depth_gate=None`.

### Compact keyed grids

`CompactGrid` stores only real puzzle variables and maps each solver cell to a stable domain key:

- Hidato/Numbrix keys are board coordinates.
- Kakuro keys are white-cell coordinates.
- Slitherlink keys are horizontal or vertical edge identifiers.

`values_by_key()` decodes a returned `ImmutableGrid`, and each family implements `format_solution()` for geometry-aware output. Subclasses must copy immutable geometry and detach mutable metadata through `_copy_extra_state_to()`.

### New family rule models

**Hidato and Numbrix** share `ConsecutiveAdjacencyRule`. A separate whole-grid `ElementsAtMostOnce` rule and one pre-seeded presence `Guarantee` per value form the permutation model, preserving independent propagation and final validation. The path rule performs:

- immediate predecessor/successor support checks;
- fixed-clue graph-distance filtering;
- bipartite parity filtering for orthogonal Numbrix;
- layered forward/backward support pruning between fixed clues and endpoint layers;
- complete-path validation after all cells are known.

Hidato supplies orthogonal plus diagonal adjacency and permits blocked cells. Numbrix supplies orthogonal adjacency and rejects blocked cells.

**Kakuro** uses the existing `SumAndElementsAtMostOnce` rule. The grid constructor validates that runs are straight, contiguous, maximal between black cells or board edges, arithmetically feasible with distinct digits, and that every white cell belongs to exactly one horizontal and one vertical run.

**Slitherlink** uses:

- `AllowedValueCountRule` for face clues and vertex degrees `{0, 2}`;
- `SingleLoopRule` for one non-empty connected cycle.

`SingleLoopRule` rejects premature closed components, disconnected selected components, selected bridges, and selected edges that cannot lie in one viable cyclic block. It removes graph bridges and edges outside every cyclic block that could contain all currently selected edges. Every graph deduction is checked against exhaustive small-board edge-subset oracles.

### File loading

`create_from_file()` supports both historical class-prefixed files and retained CSP-Rules solve forms.

Format detection is deliberately conservative:

1. Ignore blank lines and leading `;`/`#` comments.
2. Inspect the first meaningful line.
3. Route only a line beginning with `solve` or `solve-tatham` inside an opening parenthesis to the CSP-Rules parser.
4. Otherwise preserve the historical `<Class>::<payload>` path.

Never detect format from a `.clp` suffix or by searching the complete file. Historical files often contain appended solver transcripts with later `(solve ...)` text.

### Key design decisions

**The public solve API is non-mutating.**
`solve(grid)` creates one working clone before solving. The caller's givens, candidates, rules, guarantees, fill state, and caches are not used as mutable search state.

**Speculative work uses reversible trails.**
Candidate sets are `TrailedSet` objects that snapshot once per nested frame. Known assignments, rule/guarantee transitions, parent cache dictionaries, and fish dirty fingerprints are restored by `trail_undo()`. The event-driven propagation queue is part of the same frame state, so sibling branches cannot inherit consumed or branch-only work. Every speculative scope must undo in `finally`. See `TRAIL_DESIGN.md` for the invariants and test coverage.

**Basic propagation is event-driven.**
Candidate and known-value changes mark their cells dirty. Cached watcher maps then revisit only rules and guarantees touching those cells; newly registered rules and guarantees are queued explicitly. Guarantee additions also wake only guarantee-consuming rules that can contain them. The first pass after a clone still schedules every live constraint, and structural changes invalidate the watcher maps.

**AIC and ALS share one candidate topology snapshot.**
At a stalled `FULL` state, full houses, peer bitmasks, per-value candidate locations, ALS sets, and restricted-common links are built once for the adjacent ALS-XZ and ALS-XY-Wing actions. AIC reuses the same immutable topology if no intervening action changes the grid. Any action hit ends that power-action pass, so a changed state always rebuilds the snapshot.

Per-value candidate locations come from a lazy dirty-cell index. The index is absent until a real topology consumer first requests it. Once active, candidate mutations mark only their cell; the next topology request updates masks for the changed cells and coalesces repeated mutations. A speculative branch copies the derived index only on its first synchronization, while trail rollback restores the exact parent references and dirty state. Explicit grid clones start with the index inactive because it is derived data.

**Rules are immutable and shared across explicit clones.**
`Grid.deepcopy()` shallow-copies rule and guarantee sets but shares `Rule` objects. Rule cells are immutable tuples, and hashing or registration freezes all existing instance fields; attempts to alter cells, targets, or dimensions then fail. Registration also rejects rules for another shape or value domain. Deterministic `@cached_property` values may still be populated after freezing. Rule and guarantee batches are fully validated before the first live-set mutation.

**Depth gating is explicit, parked, and disabled by default.**
`solve(..., depth_gate=K)` retains the experimental cheap-tier cutoff without changing ordinary solves. The root has search depth zero: full techniques run through depth `K`, and deeper backtracking nodes stop after the cheap tier. `None` runs the selected profile normally everywhere. Do not enable a gate in normal call sites, CI examples, correctness checks, or performance comparisons.

**Forcing chain uses the full selected AtomicSolver profile for trial branches.**
A `ContextVar`-backed recursion flag prevents forcing-chain recursion without leaking state between concurrent solves. The inner solver excludes recursive contradiction techniques while preserving the deductions allowed by the grid profile.

**All-invalid in forcing chain raises `InvalidGrid`.**
If all candidates of a cell lead to contradictions through the constraint engine, the grid is truly invalid. Propagation only removes candidates, so an empty candidate set is irreversible. `AtomicSolver` also treats an explicit `InvalidGrid` exception as authoritative even when a custom rule does not mutate candidates before raising.

**Techniques using `unique_rule_cells` must filter to full-size groups.**
KenKen and Killer Sudoku cages create small `ElementsAtMostOnce` groups. Techniques such as locked candidate and skyscraper assume groups have `max_elem` cells. Filter with `len(group) == grid.max_elem`.

## Correctness history

**SumRule maximum bound:** the correct upper bound is `remaining_sum - remaining_unknowns + 1`, because every other unknown is at least 1. The bound applies only to unknown cells.

**ProdRule known cells:** candidate pruning must not process already known cage cells.

**Trial propagation fixpoint:** Nishio and forcing-net trials must repeat after candidate-only or structural progress, not only after a newly known value.

**Exact KenKen division:** `DivRule` uses multiplication and `divmod`; floating-point quotient comparisons are unsound beyond `2**53`.

**XY-chain cache integrity:** advanced techniques must not mutate cached structural sets. Build detached filtered views when temporary pruning is required.

**Extension validation:** subclasses of a built-in rule must satisfy both the nearest built-in closed form and their own `apply()` fallback. An `isinstance` closed-form shortcut alone can skip subclass semantics.

## Logging and concurrency

Importing the solver does not initialize Colorama, mutate stdout, or reconfigure the root logger. Terminal configuration is explicit through `set_colouring`.

Verbosity, rendered-grid buffers, output thresholds, forcing-chain recursion state, and optional technique statistics are context-local. Concurrent solves do not overwrite one another's diagnostic state.

- Windows terminal / Colorama mode uses `just_fix_windows_console()`.
- Rich terminal mode wraps byte-buffered stdout as UTF-8 when needed.
- Jupyter mode uses `Console(force_jupyter=True)`.

## Performance policy

- Per-technique diagnostics are opt-in through `collect_power_stats()`.
- Guarantee propagation and rule watching are incremental.
- Fish fingerprints and cache changes are transactional.
- `Grid.deepcopy()` is reserved for API isolation and worker seeds; recursive search uses trails.
- Structural caches use copy-on-invalidate inside trails.
- Every optimization must preserve exact deterministic solution sets and be measured with `depth_gate=None`.
- A microbenchmark win is insufficient if the ordinary solver regresses. Rejected experiments and their measurements belong under `benchmarks/`.

The first eager-global per-value candidate-mask design was rejected: it made topology construction faster but added approximately 2% geometric-mean cost to measured full solves and roughly doubled mutation/rollback cost. The accepted lazy dirty-cell design is recorded in `benchmarks/lazy_candidate_index_2026-08-10.md`. It reduced unchanged topology builds by 51.28% and dirty-cell topology/rollback rounds by 64.61%. Cold pre-activation mutations changed by +0.38%; the full-solver geometric mean changed by +0.36%, with a worst measured case of +1.62%. Every comparison used `depth_gate=None` and exact deterministic solution fingerprints.

## Validation policy

The default workflow:

- installs from `pyproject.toml` and runs `pip check`;
- builds a wheel and checks the installed console command;
- compiles production, test, corpus-tool, and example sources;
- runs under Python development mode (`-X dev`);
- discovers every non-`slow` test on Linux and Windows, so new regression files cannot be silently omitted from a hand-maintained manifest;
- runs representative end-to-end examples as part of that bounded discovery;
- runs the same guarantee metadata guard on both platforms through normal test collection.

Corpus modules that are intentionally excluded from every push carry the
`slow` marker at module scope and are selected explicitly by extended CI. A
weekly/manual forward-compatibility workflow additionally exercises
free-threaded Python 3.14 and the Python 3.15 prerelease with warnings treated
as errors.

The scheduled/manual extended workflow includes:

- existing supported example corpora;
- a 16-job matrix for Hidato, Numbrix, Kakuro, and Slitherlink: four deterministic shards per family, one fresh interpreter per file, a hard per-file timeout, and uploaded JSON reports;
- the slow pandiagonal Latin-square corpus;
- full parallel/sequential enumeration equivalence;

The generated 49x49 through 100x100 propagation tests and broader bounded
technique-soundness states now complete quickly enough to run on every push.

Corpus reports distinguish:

- `unique`;
- `multiple`;
- `unsatisfiable`;
- `timeout`;
- `unsupported_variant`;
- `error`.

Timeouts and explicitly classified historical variants do not fail the matrix. Unexpected parser or solver errors do — and so do `unsatisfiable` and `multiple`, because the retained corpus consists of unique-solution puzzles, making either count a solver soundness regression. A missing or empty corpus directory (wrong `--root`, empty shard) fails instead of reporting a green no-op. Non-standard Mebane Slitherlink files with additional constraints are reported explicitly rather than silently solved as ordinary Slitherlink.

Run a local shard with:

```bash
python scripts/run_new_family_corpus.py \
  --family hidato \
  --shard-index 0 \
  --shard-count 4 \
  --case-timeout 60 \
  --output hidato-0.json
```

## Extension transaction boundary

Third-party rule and guarantee hooks execute inside a reversible sandbox. They receive validated candidate views rather than the raw journal-aware candidate sets. Their iterators, metadata, hashes, equality methods, replacement outputs, and guarantee-normalization hooks must therefore be treated as untrusted: unrelated candidate, known-value, rule, guarantee, dirty-queue, index, or cache changes are rolled back before canonical outputs are committed. Replacement rules and guarantees are prepared completely before the source rule is deactivated, so failed extension code cannot partially install a batch or strand the source outside propagation.

Kakuro distinguishes malformed structure from an impossible puzzle. Run geometry, coverage, and clue syntax are validated while loading; a numerically infeasible target is accepted as a structurally valid but unsatisfiable puzzle and must solve to zero solutions.
