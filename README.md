# GridPuzzle

[![CI](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml/badge.svg)](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml)

Constraint-propagation solver for Sudoku, Futoshiki, Killer Sudoku, KenKen, Latin Squares, Hidato, Numbrix, Kakuro, and Slitherlink.

**Runtime requirement: Python 3.14 or newer.** Older Python versions are intentionally unsupported; newer releases are not artificially capped.

Input puzzles are read as modules that define the variable `g`, from `.pzl` or retained CSP-Rules `.clp` files, or from strings.

Execute `python run.py -m Examples.exampleSudoku` to solve the Sudoku stored as `g` in `Examples/exampleSudoku.py`.
Additional options print intermediate steps or run one of the built-in examples.
Try `python run.py -v -m Examples.exampleSudoku` for all intermediate steps.

Try `python run.py -s ..29.6......1.83...96.7....9...5....2....9.31.1..8.5....8...........57.....7...2. -c sudoku` to solve a Sudoku from an arbitrary string.

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

- **Hidato** places every value exactly once on the active cells. Consecutive values may touch orthogonally or diagonally, and blocked cells are supported.
- **Numbrix** uses the same consecutive-value path model but permits orthogonal movement only and has no blocked cells.
- **Kakuro** models every maximal horizontal and vertical run with the existing sum-plus-all-different rule. Every white cell must belong to exactly one run of each orientation.
- **Slitherlink** models horizontal and vertical edges as binary variables. Face clues constrain selected-edge counts, every vertex has degree zero or two, and selected edges must form one non-empty connected cycle.

An example is the _Miracle Sudoku_ in `Examples/miracleSudoku.py`.
In addition to normal Sudoku rules, adjacent and knight-move-distant fields must not be equal, and horizontally or vertically adjacent fields must not differ by exactly 1.

## Solving techniques

The solver uses constraint propagation with a hierarchy of increasingly powerful techniques, resorting to backtracking only when all applicable deductive methods are exhausted.

Each grid declares a technique profile:

- **FULL** runs the complete Sudoku/Latin-house hierarchy.
- **GENERIC** retains rule helpers, tuple reasoning, forcing chains, Nishio, forcing nets, and backtracking, but excludes geometry-specific Sudoku patterns.
- **RULES_ONLY** relies on the puzzle rules and ordinary branching, avoiding generic techniques whose measured cost exceeds their benefit for that model.

The measured defaults are FULL for the original dense-grid families, GENERIC for Hidato and Kakuro, and RULES_ONLY for Numbrix and Slitherlink. The depth-gate experiment remains available only when explicitly requested; it is disabled by default and is not used to establish correctness or benchmark results.

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
- **Possible-cycle analysis** — Slitherlink removes graph bridges and edges outside every viable cyclic block, rejects disconnected selected components, and prevents premature subloops

#### Last resort
- **Backtracking** with MRV (Minimum Remaining Values), breaking ties by the candidate pressure from neighbouring constraints

### Technique effectiveness

Measured live by `tests/technique_stats_harness.py` over a representative corpus. June 2026 measurements found AIC to be the strongest expensive technique, while `naked_tuples(5)`, `locked_candidate`, and `empty_rectangle` were the cheap workhorses. Deep fish and hidden-tuple tiers had zero hits in forcing-chain branches, so they are skipped there; this produced a 6.6x corpus speedup with identical solutions.

The hardest built-in test puzzle (`example_t`) is solved entirely without backtracking.

## Arguments

The installed `gridpuzzle` command and `python run.py` expose the same options. Use `--processes N` for top-level process-pool search and `--max-solutions N` to cap the deterministic returned subset.

The equivalent library call is:

```python
solutions = solver.solve(
    grid,
    processes=0,
    max_sols=-1,
)
```

Run `gridpuzzle --help` for the complete parser-generated option list.

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

## Development

Install the package and development dependencies from the repository metadata:

```bash
python -m pip install -e ".[dev]"
```

Run a quick bounded selection with:

```bash
python -X dev -m pytest -q tests/test_regressions.py tests/test_basic.py tests/test_scale.py -m "not slow"
```

(The actual CI core job runs the full non-slow suite across all test files;
see `.github/workflows/ci.yml` for the authoritative list.)

The `slow` marker contains long corpus and large-scale checks and is intentionally excluded from the default push workflow:

```bash
python -X dev -m pytest -m slow
```

Run an isolated retained-corpus shard locally with:

```bash
python scripts/run_new_family_corpus.py \
  --family slitherlink \
  --shard-index 0 \
  --shard-count 4 \
  --case-timeout 60 \
  --output slitherlink-0.json
```

Each case runs in a fresh interpreter. Reports distinguish unique, multiple, unsatisfiable, timed-out, deliberately unsupported variant, and unexpected-error outcomes. Extended CI runs a 16-job family/shard matrix weekly or manually and uploads each JSON report as an artifact.

GitHub Actions tests the minimum supported runtime, Python 3.14. Package metadata accepts Python 3.14 and newer; Linux runs the bounded suite plus representative end-to-end examples, Windows runs a portable regression smoke suite, and forward-compatibility CI covers later interpreter builds.

## Acknowledgements

Many puzzle examples originated in Denis Berthier's CSP-Rules corpus.

## License

The software is distributed under the GNU AGPL v3.0 license.
