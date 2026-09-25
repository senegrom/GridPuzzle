# GridPuzzle

[![CI](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml/badge.svg)](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml)

Constraint-propagation solver for Sudoku, Futoshiki, Killer Sudoku, KenKen, Latin Squares, Hidato, Numbrix, Kakuro, Slitherlink, and Str8ts.

**Runtime requirement: Python 3.14 or newer.** Older Python versions are intentionally unsupported; newer releases are not artificially capped.

Input puzzles are read as modules that define the variable `g`, from `.pzl` or retained CSP-Rules `.clp` files, or from strings.

Execute `python run.py -m gridsolver.examples.sudoku` to solve the Sudoku stored as `g` in `gridsolver/examples/sudoku.py`.
Additional options print intermediate steps or run one of the built-in examples.
Try `python run.py -v -m gridsolver.examples.sudoku` for all intermediate steps.
An installed package provides the same command as `gridpuzzle` (`gridpuzzle -m gridsolver.examples.sudoku`).

Try `python run.py -s ..29.6......1.83...96.7....9...5....2....9.31.1..8.5....8...........57.....7...2. -c sudoku` to solve a Sudoku from an arbitrary string.

## Phone app

The same solver runs in the browser as an installable, camera-first web app at https://senegrom.github.io/GridPuzzle/. It photographs a printed puzzle, straightens it, reads the clues with on-device OCR, lets you review them, and solves with the complete Python engine through Pyodide; nothing leaves the phone. A play mode lets you enter your own answers, check them against the solution and take hints. The sources live in `web/`, the build in `scripts/build_web.py`, and the data boundary in `gridsolver/web_api.py`; `web/README.md` and `web/TESTING.md` describe the design, the recognition trust model and the acceptance tests. Every push to `master` that changes the app, the solver or their acceptance suites rebuilds the site, runs the Chromium and WebKit acceptance suites against the real solver and OCR, and deploys; a pull request that changes them runs the same suites first.

## Puzzle types

Default implementations for arbitrary sizes exist for _Sudoku_ (including 16x16 and 25x25),
_Killer Sudoku_ (additional sum constraints on areas),
_Futoshiki_ (inequality constraints),
_KenKen_ (arithmetic cage constraints),
and _Latin Square_ / _Diagonal Latin Square_ / _Pandiagonal Latin Square_.
They can be extended using the built-in rules.

The retained CSP-Rules corpora for _Hidato_, _Numbrix_, _Kakuro_, and _Slitherlink_ are first-class inputs. The normal file route auto-detects a CSP-Rules `solve` or `solve-tatham` form from the first meaningful input line while preserving the historical class-prefixed `.clp` format:

```bash
gridpuzzle --file Examples/Hidato/Mebane/Mebane-III.1-S.clp --max-solutions 1
gridpuzzle --file Examples/Slitherlink/Tatham/H7x7-L10-W5.clp --max-solutions 1
```

These families use compact keyed variables so blocked cells and graph edges are not represented as fake rectangular-grid values. Returned compact solutions can be decoded with `grid.values_by_key(solution)`; each family also supplies a geometry-aware `format_solution()` renderer.

- **Hidato** places every value exactly once on the active cells. Consecutive values may touch orthogonally or diagonally, and blocked cells are supported. One value-presence guarantee per path value is available immediately when the grid is constructed.
- **Numbrix** uses the same consecutive-value path model but permits orthogonal movement only and has no blocked cells. It uses the same pre-seeded presence guarantees.
- **Kakuro** models every maximal horizontal and vertical run with the existing sum-plus-all-different rule. Every white cell must belong to exactly one run of each orientation.
- **Slitherlink** models horizontal and vertical edges as binary variables. Face clues constrain selected-edge counts, every vertex has degree zero or two, and selected edges must form one non-empty connected cycle.

_Str8ts_ (`gridsolver/grid_classes/str8ts.py`) is the twelfth family: white cells form horizontal and vertical streets that each hold a consecutive set in any order, and every number, including a clue printed on a black cell, is unique in its row and column. It is reached through the phone app and the browser data contract (`gridsolver/web_api.py`) on square boards up to 9×9; there is no `--class` value or example corpus for it, and it runs the `RULES_ONLY` profile.

An example is the _Miracle Sudoku_ in `gridsolver/examples/miracle_sudoku.py`.
In addition to normal Sudoku rules, adjacent and knight-move-distant fields must not be equal, and horizontally or vertically adjacent fields must not differ by exactly 1.

## Solving techniques

The solver uses constraint propagation with a hierarchy of increasingly powerful techniques, resorting to backtracking only when all applicable deductive methods are exhausted.

Each grid declares a technique profile:

- **FULL** runs the complete Sudoku/Latin-house hierarchy.
- **GENERIC** retains rule helpers, tuple reasoning, forcing chains, Nishio, forcing nets, and backtracking, but excludes geometry-specific Sudoku patterns.
- **RULES_ONLY** relies on the puzzle rules and ordinary branching, avoiding generic techniques whose measured cost exceeds their benefit for that model.

The measured defaults are FULL for the original dense-grid families, GENERIC for Kakuro, and RULES_ONLY for Hidato, Numbrix, and Slitherlink.

#### Basic
- **Naked Singles / Hidden Singles** — cells with one candidate, or digits with one possible cell in a house
- **Locked Candidate** (Pointing/Claiming) — candidates confined to a box-line intersection
- **Skyscraper** — two conjugate pairs sharing a base house
- **Empty Rectangle** — a house whose candidates for a digit are confined to one row-column cross, eliminating against intersecting conjugate pairs
- **Rule of 45 / Innies** (cage puzzles) — disjoint cages inside a house, row band, or column stack force the sum of leftover cells

#### Intermediate
- **Naked / Hidden Subsets** — pairs, triples, and quads of candidates locked to cells
- **XY-Wing / XYZ-Wing / W-Wing** — three-cell patterns eliminating shared candidates
- **X-Chain / XY-Chain** — alternating strong/weak-link chains for a single or multiple digits
- **ALS-XZ / ALS-XY-Wing** (Almost Locked Sets) — N cells with N+1 candidates, restricted common digits; the wing variant chains two ALSs through a hinge ALS
- **Sue de Coq** (Two-Sector Disjoint Subsets) — box-line intersection with ALS analysis

#### Advanced
- **Fish / Finned Fish** — X-Wing, Swordfish, and Jellyfish patterns, including finned variants
- **Alternating Inference Chains (AIC)** — generalized chains with grouped strong links from box-line intersections
- **Nishio** — place a candidate, propagate, and check for contradiction via the guarantee system
- **Forcing Chain** — test each value of a small cell using the full constraint engine; contradictory values are eliminated and deductions common to every surviving branch are applied
- **Forcing Net** — test all value combinations of two cells simultaneously for common deductions

#### Graph-specific propagation
- **Layered consecutive-path support** — removes Hidato/Numbrix candidates that cannot lie on any adjacency-supported path between fixed or endpoint value layers
- **Graph-distance and parity bounds** — fixed path clues restrict reachable values; orthogonal Numbrix additionally uses bipartite parity
- **All-different matching** (Régin) — a Hidato/Numbrix value stays at a cell only if some perfect matching of values to cells uses that pair, which catches regions of free cells the remaining values cannot fill exactly
- **Possible-cycle analysis** — Slitherlink removes graph bridges and edges outside every viable cyclic block, rejects disconnected selected components, and prevents premature subloops

#### Last resort
- **Backtracking** with MRV (Minimum Remaining Values), breaking ties by the candidate pressure from neighbouring constraints

### Technique effectiveness

Measured live by `tests/technique_stats_harness.py` over a representative corpus. June 2026 measurements found AIC to be the strongest expensive technique, while `naked_tuples(5)`, `locked_candidate`, and `empty_rectangle` were the cheap workhorses. Deep fish and hidden-tuple tiers had zero hits in forcing-chain branches, so they are skipped there; this produced a 6.6x corpus speedup with identical solutions.

The hardest built-in test puzzle (`gridpuzzle -e t`) is solved entirely without backtracking.

## Arguments

The installed `gridpuzzle` command and `python run.py` expose the same options.
Use `--processes N` for top-level process-pool search and `--max-solutions N`
to cap the deterministic returned subset. Capped process-pool solves do not
exhaust later branches merely to compute a global content-key minimum.
`--column-wise` and `--space-separated` apply to class-prefixed `--str` and
`--file` input only; CSP-Rules forms, `--module` and `--example` fix their
own layout, so those combinations are rejected rather than ignored.

The command exits with status 0 when the puzzle has a solution (or
`--max-solutions 0` asked for none), 1 when it has no solution, and 2 for
usage and input errors, including a `--module` that fails to import. Status 3
means the solver itself failed; the command prints the traceback.

The equivalent library call is:

```python
solutions = solver.solve(
    grid,
    processes=0,
    max_sols=-1,
)
```

Run `gridpuzzle --help` for the complete parser-generated option list.

### Logging

The library reports through the standard `logging` module, under the `gridsolver` logger namespace (the solver uses `gridsolver.solver`), and never sets a logger level itself. A solve's `log_level` (or `solver.set_loglevel`) chooses how much it reports: 0, the default, reports solutions and timings, larger values add search detail, and -1 reports every detail. Detail 0 is logged at INFO and deeper detail at DEBUG, so an application whose logging is configured at WARNING or above sees nothing and pays nothing for rendering it. Pass `log_level=solver.QUIET` to silence a solve whatever handlers and levels are configured. The command line installs its own output handler (`--colour`), so its `--detail` and `--verbose` output always shows. In a Jupyter notebook, call `logger.set_colouring("Rich")` (from `gridsolver.solver`) before solving: it installs such a handler too and renders the grids, the highlighted changes and each step as coloured HTML, for example with `solver.solve(grid, -1)`.

## Rule types

The following rules can be combined to create puzzles.

#### `ElementsAtMostOnce`
All numbers in the associated cells may occur at most once.

#### `ElementsAtLeastOnce`
All numbers in the puzzle range must occur at least once in the associated cells.

#### `SumAndElementsAtMostOnce`
Numbers may occur at most once and must sum to a given constant, as used in Killer Sudoku and Kakuro.

#### `SumRule` / `ProdRule` / `DiffRule` / `DivRule`
Arithmetic constraints whose sum, product, absolute difference, or exact integer ratio must equal a target, as used in KenKen.

#### `IneqRule`
One cell must be strictly smaller or larger than another.

#### `UneqRule`
One special cell must differ from all other rule cells.

#### `DiffGe2Rule`
One special cell must differ by at least 2 from all other rule cells.

#### `ConsecutiveAdjacencyRule`
Every consecutive value pair must occupy adjacent cells in a supplied symmetric topology. Hidato and Numbrix share this rule and differ only in the topology supplied by their grid class.

#### `AllowedValueCountRule`
Restricts how many cells in a collection may contain a distinguished value. Slitherlink uses exact clue counts and allowed vertex degrees `{0, 2}`.

#### `SingleLoopRule`
Requires selected graph edges to form exactly one non-empty simple cycle and performs safe bridge, component, and cyclic-block pruning before the graph is fully decided.

#### `ConsecutiveSetRule`
The cells must hold distinct values that form one run of consecutive numbers, in any order, as every Str8ts street does. Candidates survive only if some feasible run can still be matched to the cells.

## Development

Install the package and development dependencies from the repository metadata, then run the bounded suite as CI does on Linux and Windows:

```bash
python -m pip install -e ".[dev]"
python -X dev -m pytest -q tests -m "not slow"
```

The `slow` marker holds the long example-corpus checks and the longest deterministic tests (blank-grid enumerations, the 100x100 Sudoku), which only extended CI runs (`python -X dev -m pytest -m slow`). [DEVELOPMENT.md](DEVELOPMENT.md) describes the CI workflows, the isolated corpus runner and its timeout policy.

## Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md): architecture, performance policy and the corpus runner.
- [TODO.md](TODO.md): open items, rejected ideas and standing rules.
- [TRAIL_DESIGN.md](TRAIL_DESIGN.md): the reversible trail the solver backtracks on.
- [benchmarks/README.md](benchmarks/README.md): the index of measured and rejected changes.
- [web/README.md](web/README.md): the phone scanner app and its own documents.

## Acknowledgements

This repository began as Denis Berthier's CSP-Rules-V2.1, and many puzzle examples come from its corpus.

## License

GridPuzzle is distributed under the GNU AGPL v3.0 license (`LICENSE`).

The example corpora keep their own terms: the CSP-Rules files are GPL-3.0, and the newspaper transcriptions and photographs remain their publishers' copyright. [Examples/NOTICE.md](Examples/NOTICE.md) lists them.

The phone scanner self-hosts Pyodide, the CPython standard library, Tesseract.js and its English model under their own licences, together with the C libraries compiled into their WebAssembly runtimes. The build ships each licence text with the site, the app's footer links the list, and [third_party/licenses/README.md](third_party/licenses/README.md) lists the texts the repository vendors and where each comes from.
