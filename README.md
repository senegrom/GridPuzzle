# GridPuzzle

[![CI](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml/badge.svg)](https://github.com/senegrom/GridPuzzle/actions/workflows/ci.yml)

Constraint-propagation solver for Sudoku, Futoshiki, Killer Sudoku, KenKen, and Latin Squares.

**Runtime requirement: Python 3.14 or newer.** Older Python versions are intentionally unsupported; newer releases are not artificially capped.

Input puzzles are read as modules that define the variable `g`, from `.pzl` files, or from strings.

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

The Hidato, Kakuro, Numbrix, and Slitherlink corpora under `Examples/` are intentionally retained as source material for future puzzle-family implementations. The current runtime does not load those formats yet.

An example is the _Miracle Sudoku_ in `Examples/miracleSudoku.py`.
In addition to normal Sudoku rules, adjacent and knight-move-distant fields must not be equal, and horizontally or vertically adjacent fields must not differ by exactly 1.

## Solving techniques

The solver uses constraint propagation with a hierarchy of increasingly powerful techniques, resorting to backtracking only when all deductive methods are exhausted.

#### Basic
- **Naked Singles / Hidden Singles** — cells with one candidate, or digits with one possible cell in a house
- **Locked Candidate** (Pointing/Claiming) — candidates confined to a box-line intersection
- **Skyscraper** — two conjugate pairs sharing a base house
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

#### Last resort
- **Backtracking** with the MRV (Minimum Remaining Values) heuristic

### Technique effectiveness

Measured live by `tests/technique_stats_harness.py` over a representative corpus. June 2026 measurements found AIC to be the strongest expensive technique, while `naked_tuples(5)`, `locked_candidate`, and `empty_rectangle` were the cheap workhorses. Deep fish and hidden-tuple tiers had zero hits in forcing-chain branches, so they are skipped there; this produced a 6.6x corpus speedup with identical solutions.

The hardest built-in test puzzle (`example_t`) is solved entirely without backtracking.

## Arguments

```
usage: run.py [-h] [-m MODULE] [-s STR]
              [-c {sudoku,killersudoku,futoshiki,kenken,latinsquare,diagonallatinsquare,pandiagonallatinsquare}]
              [-o {No,Colorama,Rich}] [-f FILE]
              [-e {a,b,c,d,f,m,s,t}] [-d DETAIL] [-v]

Solve grid puzzle

options:
  -h, --help            show this help message and exit
  -m MODULE, --module MODULE
                        module file to load puzzle from
  -s STR, --str STR     string to load puzzle from
  -c {sudoku,killersudoku,futoshiki,kenken,latinsquare,diagonallatinsquare,pandiagonallatinsquare}, --class_ {...}
                        puzzle class
  -o {No,Colorama,Rich}, --colour {No,Colorama,Rich}
                        colour output mode (default: Colorama)
  -f FILE, --file FILE  puzzle string file to load puzzle from
  -e {a,b,c,d,f,m,s,t}, --example {a,b,c,d,f,m,s,t}
                        choose one of the default example puzzles
  -d DETAIL, --detail DETAIL
                        detail of log output (higher means more intermediate steps)
  -v, --verbose         print very detailed log output (every step)
```

## Rule types

The following rules can be combined to create puzzles.

#### `ElementsAtMostOnce`
All numbers in the associated cells may occur at most once.

#### `ElementsAtLeastOnce`
All numbers in the puzzle range must occur at least once in the associated cells.

#### `SumAndElementsAtMostOnce`
Numbers may occur at most once and must sum to a given constant, as used in Killer Sudoku.

#### `SumRule` / `ProdRule` / `DiffRule` / `DivRule`
Arithmetic constraints whose sum, product, absolute difference, or exact integer ratio must equal a target, as used in KenKen.

#### `IneqRule`
One cell must be strictly smaller or larger than another.

#### `UneqRule`
One special cell must differ from all other rule cells.

#### `DiffGe2Rule`
One special cell must differ by at least 2 from all other rule cells.

## Development

Install the package and development dependencies from the repository metadata:

```bash
python -m pip install -e ".[dev]"
```

Run the bounded CI suite with:

```bash
python -X dev -m pytest -q tests/test_regressions.py tests/test_basic.py tests/test_scale.py -m "not slow"
```

The `slow` marker contains long corpus and large-scale checks and is intentionally excluded from the default push workflow:

```bash
python -X dev -m pytest -m slow
```

GitHub Actions tests the minimum supported runtime, Python 3.14. Package metadata accepts Python 3.14 and newer; Linux runs the bounded suite plus representative end-to-end examples, and Windows runs a portable regression smoke suite.

## Acknowledgements

Many puzzle examples originated in Denis Berthier's CSP-Rules corpus.

## License

The software is distributed under the GNU AGPL v3.0 license.
