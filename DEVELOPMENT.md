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

Top-level process-pool branches are independent copied/pickled grids. Within a process, Nishio, forcing chains, forcing nets, and backtracking reuse one mutable grid through transactional trail scopes. Backtracking drives an explicit stack of suspended branch generators; child results resume their parent without consuming Python call frames, and closing the stack unwinds every trial in LIFO order.

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

Do not infer technique applicability from the compact one-row storage layout. Add or change a profile only after independent solution equivalence and family-specific benchmarks.

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

**The advanced power actions share one candidate topology snapshot.**
At a stalled `FULL` state, full houses, peer bitmasks, and per-value candidate locations are built once at the top of the power-action pass and consumed by locked candidate, skyscraper, empty rectangle, ALS-XZ, ALS-XY-Wing (via the derived ALS analysis), and AIC. Any action hit ends that pass, so a changed state always rebuilds the snapshot and no consumer ever observes stale bitsets.

Per-value candidate locations come from a lazy dirty-cell index. The index is absent until a real topology consumer first requests it. Once active, candidate mutations mark only their cell; the next topology request updates masks for the changed cells and coalesces repeated mutations. A speculative branch copies the derived index only on its first synchronization, while trail rollback restores the exact parent references and dirty state. Explicit grid clones start with the index inactive because it is derived data.

**Rules are immutable and shared across explicit clones.**
`Grid.deepcopy()` shallow-copies rule and guarantee sets but shares `Rule` objects. Rule cells are immutable tuples, and hashing or registration freezes all existing instance fields; attempts to alter cells, targets, or dimensions then fail. Registration also rejects rules for another shape or value domain. Deterministic `@cached_property` values may still be populated after freezing. Rule and guarantee batches are fully validated before the first live-set mutation.

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

Extension output validation uses an explicit depth-first stack and a shared
4096-item budget. Cycles are detected along the current ancestor path only;
a shared child is validated again with each sibling's inherited guarantees.
Valid chains within the budget must not depend on Python's recursion limit.
Detached state is checked after lazy output iteration and guarantee metadata
normalization, and parent state is rechecked after the complete child traversal.
An empty iterator or a child metadata hook must not invalidate a state after
its last compatibility check.

**Given/candidate consistency:** a nonempty candidate set that excludes an
existing given is a contradiction. Basic propagation also narrows expanded
candidate sets back to their givens before selecting a branch.

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
- Every optimization must preserve exact deterministic solution sets and be measured with the complete selected technique profile.
- A microbenchmark win is insufficient if the ordinary solver regresses. Rejected experiments and their measurements belong under `benchmarks/`.

The first eager-global per-value candidate-mask design was rejected: it made topology construction faster but added approximately 2% geometric-mean cost to measured full solves and roughly doubled mutation/rollback cost. The accepted lazy dirty-cell design is recorded in `benchmarks/lazy_candidate_index_2026-08-10.md`. It reduced unchanged topology builds by 51.28% and dirty-cell topology/rollback rounds by 64.61%. Cold pre-activation mutations changed by +0.38%; the full-solver geometric mean changed by +0.36%, with a worst measured case of +1.62%. Every comparison used the complete technique hierarchy and exact deterministic solution fingerprints.

## Validation policy

The default workflow:

- installs from `pyproject.toml` and runs `pip check`;
- builds a wheel, installs it into a fresh virtual environment outside the
  checkout, and checks imports, the console command, a small solve, and a
  bundled example with PYTHONPATH/PYTHONHOME removed;
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

Unexpected timeouts, parser/solver errors, `unsatisfiable`, and `multiple` fail
the corpus matrix. The retained supported corpus consists of unique-solution
puzzles, so either wrong solution count is a soundness regression. Every shard
must also complete at least one uniquely solved case: an all-timeout or
all-unsupported run cannot pass. Missing or empty corpus directories and zero
`max_cases` fail rather than reporting a green no-op. Non-standard Mebane
Slitherlink files with additional constraints remain explicitly classified,
not silently solved as ordinary Slitherlink.

There are **no timeout exemptions by default**. Extended CI explicitly supplies
`--timeout-baseline benchmarks/corpus_timeout_baseline.json`. This reviewed
baseline names exact existing corpus paths, gives each a reason, records the
supporting run, and expires within 31 days of review. Its timeout must match the
requested case timeout. Expired, future-dated, malformed, duplicate, missing-file,
or out-of-repository entries fail before cases run. Never renew the dates
without reviewing fresh reports and removing recovered cases.

Reports retain the raw `timeout` status and separately list `accepted_timeouts`,
`unexpected_timeouts`, and `resolved_timeouts`. The latter identifies previously
slow cases that completed uniquely, for baseline cleanup. The initial seven
Slitherlink allowances were verified against the September 2 run's four shard
artifacts, not newly measured on September 10. All expire on October 10, 2026.
Case reports are written before the runner returns a regression failure; invalid
configuration fails before launching cases. Missing report artifacts fail the
upload step. Changes anywhere in `gridsolver/`, the corpus runner, its policy
baseline, or the related regression tests trigger extended CI on `master`.

Run a local shard with the same reviewed exceptions as CI:

```bash
python scripts/run_new_family_corpus.py \
  --family hidato \
  --shard-index 0 \
  --shard-count 4 \
  --case-timeout 60 \
  --timeout-baseline benchmarks/corpus_timeout_baseline.json \
  --output hidato-0.json
```

Omit `--timeout-baseline` for a strict run in which every timeout fails.

## Extension transaction boundary

Structural metadata is extension code too. Branch peer selection, visibility and
house construction, arithmetic helpers, and transitive inequality bounds read
extension facts through `Grid._read_rule_metadata`. Readers materialize their
scalars/tuples/frozensets inside an individual rollback scope before consulting
candidates or another rule. Metadata preparation and application are distinct
operations; validation also restores captured sources between emitted-rule nodes.
The source registry stays active inside nested scopes, which enter local grid
sandboxes directly rather than recursively dispatching public scopes.

Clones retain the source owners of shared extension rules in `_extension_sources`.
Checked registration records a new owner by identity (never Grid equality), and
native-only clones keep the tuple empty. This is source ownership, not rebinding:
a rule that reads original givens must not be redirected to the changing working
grid. Ordinary pickle serializes owners before shared rule sets, preventing a
nested source set from hashing a partially restored rule; default subclass dict
and slot state remain intact. As before, extension classes and semantic fields
must themselves support standard pickle when used with process workers.

The parallel root serializer transfers that owner graph but omits derived caches,
solver memos and active trail frames from every Grid in the payload. Ordinary
(non-worker) pickle retains the full historical grid state. Every worker task
establishes a fresh protection context before cloning, then uses nested per-hook
scopes throughout search. Owners and the worker seed must be unchanged on success,
exceptions, or interruptions, so siblings and later tasks observe pristine source
state. Context variables alone are not a process-transport mechanism.


Custom `UneqRule` subclasses are never deactivated by native inequality-union
simplification: a native union preserves only inequality, not subclass semantics.
Only exact native rules participate in the replacement optimization.

Dirty-rule selection prepares its complete tuple before consuming pending work.
For extension rules, membership/hash/equality and watcher metadata run inside a
rollback scope over the original active set and pending queue. Selection failures
are included in the propagation retry guard. Checked registration maintains an
extension marker so native selection does not pay for a sandbox.

Public solve and validation capture their validation plan before search and before
any extension metadata can change the original puzzle. A context-local registry
protects caller grids even when hooks capture them rather than using their detached
arguments. Copy hooks, propagation/selection hooks, and fallback validation each
roll back incidental caller changes; lazy outputs and metadata are included.
Success, errors and interruptions unwind both source and working-grid scopes.
Native grids with canonical built-in constraints retain the non-sandbox path.
These scopes protect Grid-managed transactional state, not arbitrary Python object
state, external effects, or raw writes bypassing Grid's mutation APIs.


Third-party rule and guarantee hooks execute inside a reversible sandbox.
Rule applications receive detached known values and candidate sets, which are
validated before publication. Their iterators, metadata, hashes, equality
methods, replacement outputs, and guarantee-normalization hooks are untrusted:
unrelated candidate, known-value, rule, guarantee, dirty-queue, index, or cache
changes are rolled back before canonical outputs are committed. Sandboxes
restore constraint sets by reference, so cleanup never reruns a failing rule
hash or equality method. Ordinary speculative trails retain their existing
retryable rollback semantics.

The three derived cache dictionaries start empty inside each extension sandbox.
Cache factories rebuild sandbox-owned structures on demand; a shallow dictionary
copy would leak nested list/set mutations to the parent, while a generic deep
copy could execute arbitrary extension copy hooks. Rollback restores the exact
parent dictionaries and cached object identities. This does not change the
built-in rule fast path or ordinary speculative cache policy.

Rule additions and source removal are prepared as one structural transition,
including every extension hash and collision check. Canonical guarantees and
validated candidate changes publish only after that preparation succeeds.
Failures and interruptions leave the source scheduled for retry. Built-in
rule batches retain the in-place set fast path.

Kakuro distinguishes malformed structure from an impossible puzzle. Run geometry, coverage, and clue syntax are validated while loading; a numerically infeasible target is accepted as a structurally valid but unsatisfiable puzzle and must solve to zero solutions.


## Exact cage generation and graph simplification (September 2026)

Sum-plus-all-different cages use a staircase bijection rather than enumerating
repeated-value partitions and discarding them. For k strictly increasing
values x[i] in 1..M, y[i] = x[i] - i is nondecreasing in 1..M-k+1, with target
sum reduced by k*(k-1)/2. The inverse x[i] = y[i] + i is unique. Consequently
every admissible partition is preserved, in the same order. The existing exact
matching, guarantee restriction, and derived-cage pipeline is UNCHANGED and
still runs before branching. There is no approximate shortcut or deferred
fallback. The historical partition2() API continues to include repetitions.

Grid dimensions and domains are write-once even for mutable Grid instances;
solution identity and cached hashes cannot change through public assignments
or deletions. Clone and pickle layouts remain compatible.

KenKen product feasibility uses a greedy positive witness followed, when
needed, by complete iterative bounded-factor search. A failed greedy witness
never establishes impossibility. Factor 1 is represented as unused capacity,
not recursive work. Unsupported prime factors and product bounds are exact
rejections. This parser search is separate from puzzle-solver branching.

SingleLoopRule now uses only cyclic vertex-biconnected blocks for possible-edge
pruning. Every simple cycle lies in one such block. A viable block must contain
all selected edges; edges outside the union of viable blocks cannot be used.
This also rejects selected bridges and incompatible components without separate
bridge or connected-component passes. Selected-degree, premature-loop and final
completed-cycle checks remain in place. Linux and Windows share one CI matrix
with the existing check names and independent fail-fast-disabled execution.
