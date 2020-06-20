# GridPuzzle
Solver for grid puzzles, e.g. Sudokus, Futoshiki, Killer Sudoku etc.
Input puzzles are read as modules that define the variable `g`.

Execute  `run.py ex.exampleSudoku` to solve the Sudoku that is stored as `g` in the `ex/exampleSudoku.py` file.
Additional options exist to print intermediate steps or to run one of the built in examples.
Try `run.py -v ex.exampleSudoku` for all intermediate steps when solving the example Sudoku.

## Puzzle types
Default implementations for arbitrary sizes exist for Sudoku,
_Killer Sudoku_ (has additional sum constraints on areas of the puzzle), and _Futoshiki_.
They can be extended using the built in rules.
An example is the puzzle called _Miracle Sudoku_ given in `ex/miracleSudoku.py`.
Here in addition to normal Sudoku rules adjacent and knight-move distant fields must not be equal.
Also, fields that are adjacent horizontally or vertically must not have difference exactly 1.


## Arguments

```
usage: run.py [-h] [-c {a,b,c,d,f,m,s,t}] [-d DETAIL] [-v] [file]

positional arguments:
  file                  module file to load puzzle from

optional arguments:
  -h, --help            show this help message and exit
  -c {a,b,c,d,f,m,s,t}, --choice {a,b,c,d,f,m,s,t}
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
