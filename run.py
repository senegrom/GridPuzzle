import argparse
import importlib
import time

import examples
from gridsolver.grid_classes import solver
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.futoshiki import Futoshiki

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Solve grid puzzle")
    group = parser.add_mutually_exclusive_group()
    group_str = group.add_argument_group()
    group.add_argument("-f", help="module file to load puzzle from", type=str, nargs="?")
    group_str.add_argument("-s", "--str", help="string to load puzzle from", type=str, nargs="?")
    group_str.add_argument("-c", "--class_", help="puzzle class", choices=("sudoku", "killersudoku", "futoshiki"),
                           type=str)
    group.add_argument("-e", "--example", choices=("a", "b", "c", "d", "f", "m", "s", "t"),
                       help="Choose one of the default example puzzles and do not load from module file",
                       type=str, required=False)
    parser.add_argument("-d", "--detail", type=int,
                        help="Detail of log output (higher means more intermediate steps are shown)", required=False)
    parser.add_argument("-v", "--verbose", action="store_true", help="Print very detailed log output (every step)")
    args = parser.parse_args()

    detail = 0
    if args.detail:
        detail = args.detail
    if args.verbose:
        detail = -1

    start_time = time.process_time()

    if args.f:
        print(f"Importing grid puzzle from {args.f}")
        x = importlib.import_module(args.f)
        solver.solve(x.g, detail)
    elif args.example:
        g = examples.get_example(args)
        solver.solve(g, detail)
    elif args.str:
        if args.class_.strip().lower() == "sudoku":
            g = Sudoku()
        elif args.class_.strip().lower() == "futoshiki":
            g = Futoshiki()
        elif args.class_.strip().lower() == "killersudoku":
            g = KillerSudoku()
        g.load(args.str)
        solver.solve(g, detail)
    else:
        raise RuntimeError("Must define input puzzle either via module file or example choice. Run -h to see details.")

    elapsed_time = time.process_time() - start_time
    print(f"Took {elapsed_time:.4f}s to execute.")
