# GridPuzzle
Solver for grid puzzles, e.g. Sudokus, Futoshiki, Killer Sudoku etc.
Input puzzles are read as modules that define the variable `g`.

Execute  `python run.py -f examples.exampleSudoku` to solve the Sudoku that is stored as `g` in the `examples/exampleSudoku.py` file.
Additional options exist to print intermediate steps or to run one of the built-in examples.
Try `python run.py -v -f examples.exampleSudoku` for all intermediate steps when solving the example Sudoku.

Try `python run.py -s ..29.6......1.83...96.7....9...5....2....9.31.1..8.5....8...........57.....7...2. -c sudoku` to solve a Sudoku from an arbitrary string.

## Puzzle types
Default implementations for arbitrary sizes exist for _Sudoku_,
_Killer Sudoku_ (has additional sum constraints on areas of the puzzle),
and _Futoshiki_ (has inequality constraints).
They can be extended using the built-in rules.

An example is the puzzle called _Miracle Sudoku_ given in `examples/miracleSudoku.py`.
Here in addition to normal Sudoku rules adjacent and knight-move distant fields must not be equal.
In addition, fields that are adjacent horizontally or vertically must not have difference exactly 1.


## Arguments

```
usage: run.py [-h] [-f [FILE]] [-s STR] [-c {sudoku,killersudoku,futoshiki}] [-e {a,b,c,d,f,m,s,t}] [-d DETAIL] [-v]

Solve grid puzzle

optional arguments:
  -h, --help            show this help message and exit
  -f [FILE], --file [FILE]
                        module file to load puzzle from
  -s STR, --str STR     string to load puzzle from
  -c {sudoku,killersudoku,futoshiki}, --class_ {sudoku,killersudoku,futoshiki}
                        puzzle class
  -e {a,b,c,d,f,m,s,t}, --example {a,b,c,d,f,m,s,t}
                        Choose one of the default example puzzles and do not load from module file
  -d DETAIL, --detail DETAIL
                        Detail of log output (higher means more intermediate steps are shown)
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

#### `IneqRule`
One cell must be stricly smaller or larger than the other one (used in Futoshiki).

#### `UneqRule`
One special cell must have a different value than all the other rule cells.

#### `DiffGe2Rule`
One special cell must have a difference of at least 2 to all the other rule cells.
