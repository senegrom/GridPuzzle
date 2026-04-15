# GridPuzzle
Solver for grid puzzles, e.g. Sudokus, Futoshiki, Killer Sudoku, KenKen, Latin Squares etc.
Input puzzles are read as modules that define the variable `g`, from `.pzl` files, or from strings.

Execute  `python run.py -f examples.exampleSudoku` to solve the Sudoku that is stored as `g` in the `Examples/exampleSudoku.py` file.
Additional options exist to print intermediate steps or to run one of the built-in examples.
Try `python run.py -v -f examples.exampleSudoku` for all intermediate steps when solving the example Sudoku.

Try `python run.py -s ..29.6......1.83...96.7....9...5....2....9.31.1..8.5....8...........57.....7...2. -c sudoku` to solve a Sudoku from an arbitrary string.

## Puzzle types
Default implementations for arbitrary sizes exist for _Sudoku_ (including 16x16, 25x25),
_Killer Sudoku_ (additional sum constraints on areas),
_Futoshiki_ (inequality constraints),
_KenKen_ (arithmetic cage constraints),
and _Latin Square_ / _Diagonal Latin Square_.
They can be extended using the built-in rules.

An example is the puzzle called _Miracle Sudoku_ given in `Examples/miracleSudoku.py`.
Here in addition to normal Sudoku rules adjacent and knight-move distant fields must not be equal.
In addition, fields that are adjacent horizontally or vertically must not have difference exactly 1.

## Solving Techniques

The solver uses constraint propagation with a hierarchy of increasingly powerful techniques,
resorting to backtracking only when all deductive methods are exhausted.

#### Basic
- **Naked Singles / Hidden Singles** — cells with one candidate, or digits with one possible cell in a house
- **Locked Candidate** (Pointing/Claiming) — candidates confined to a box-line intersection
- **Skyscraper** — two conjugate pairs sharing a base house

#### Intermediate
- **Naked / Hidden Subsets** — pairs, triples, quads of candidates locked to cells
- **XY-Wing / XYZ-Wing / W-Wing** — three-cell patterns eliminating shared candidates
- **X-Chain / XY-Chain** — alternating strong/weak link chains for a single or multiple digits
- **ALS-XZ** (Almost Locked Sets) — N cells with N+1 candidates, restricted common digit
- **Sue de Coq** (Two-Sector Disjoint Subsets) — box-line intersection with ALS analysis

#### Advanced
- **Fish / Finned Fish** — X-Wing, Swordfish, Jellyfish patterns (and finned variants)
- **Alternating Inference Chains (AIC)** — generalized chains with grouped strong links from box-line intersections
- **Nishio** — single-digit forcing: place a candidate, propagate, check for contradiction via the guarantee system
- **Forcing Chain** — test each value of a small cell (2-4 candidates) using the full constraint propagation engine; if one contradicts, force another; if all non-contradicted branches agree on a deduction, apply it; if all branches contradict, the grid is invalid
- **Forcing Net** — test all value combinations of two cells simultaneously for common deductions

#### Last Resort
- **Backtracking** with MRV (Minimum Remaining Values) heuristic

### Technique effectiveness
Based on profiling across 49 test puzzles:

| Technique | Hit Rate | Notes |
|-----------|----------|-------|
| Forcing Chain | 57% | Most impactful; uses full solver for trials |
| Skyscraper | 13% | Cheap, fires often |
| ALS-XZ | 10% | |
| Locked Candidate | 7% | |
| Nishio | 30 hits on hard sudoku | Now works on all puzzle types |
| AIC | 2-4 hits | Grouped strong links help |
| Sue de Coq | 1.5% | |

The hardest built-in test puzzle (example_t) is solved **entirely without backtracking** using deductive techniques alone.


## Arguments

```
usage: run.py [-h] [-m MODULE] [-s STR] [-c {sudoku,killersudoku,futoshiki}]
              [-o {No,Colorama,Rich}] [-f FILE]
              [-e {a,b,c,d,f,m,s,t}] [-d DETAIL] [-v]

Solve grid puzzle

optional arguments:
  -h, --help            show this help message and exit
  -m MODULE, --module MODULE
                        module file to load puzzle from
  -s STR, --str STR     string to load puzzle from
  -c {sudoku,killersudoku,futoshiki}, --class_ {sudoku,killersudoku,futoshiki}
                        puzzle class
  -o {No,Colorama,Rich}, --colour {No,Colorama,Rich}
                        colour output mode (default: Colorama)
  -f FILE, --file FILE  puzzle string file to load puzzle from
  -e {a,b,c,d,f,m,s,t}, --example {a,b,c,d,f,m,s,t}
                        Choose one of the default example puzzles
  -d DETAIL, --detail DETAIL
                        Detail of log output (higher means more intermediate steps)
  -v, --verbose         Print very detailed log output (every step)
```

## Rule types
The following rules have been implemented so far and can be combined to create puzzles.

#### `ElementsAtMostOnce`
In the set of cells associated with the rule, all numbers may occur at most once.

#### `ElementsAtLeastOnce`
In the set of cells associated with the rule, all numbers in the puzzle range must occur at least once.

#### `SumAndElementsAtMostOnce`
In the set of cells associated with the rule, all numbers may occur at most once
and must sum to a given constant (used in Killer Sudoku).

#### `SumRule` / `ProdRule` / `DiffRule` / `DivRule`
Arithmetic constraints on cells: sum, product, difference, or division must equal a target (used in KenKen).

#### `IneqRule`
One cell must be strictly smaller or larger than the other one (used in Futoshiki).

#### `UneqRule`
One special cell must have a different value than all the other rule cells.

#### `DiffGe2Rule`
One special cell must have a difference of at least 2 to all the other rule cells.

## Notebook

Use `solve.ipynb` for interactive solving with Rich output (coloured grids, step-by-step display).

## Acknowledgements

I have merged in many examples from Denis Berthier / https://github.com/denis-berthier/CSP-Rules-V2.1/tree/master/Examples

## License
The software is distributed under the GNU AGPL v3.0 license.
