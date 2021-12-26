import argparse
import importlib
import time

import examples2
from gridsolver.abstract_grids import solver
from gridsolver.abstract_grids.grid_loading import create_from_str

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Solve grid puzzle")
    parser.add_argument("-f", "--file", help="module file to load puzzle from", type=str, nargs="?")
    parser.add_argument("-s", "--str", help="string to load puzzle from", type=str)
    parser.add_argument("-c", "--class_", help="puzzle class", choices=("sudoku", "killersudoku", "futoshiki"),
                        type=str)
    parser.add_argument("-e", "--example", choices=("a", "b", "c", "d", "f", "m", "s", "t"),
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

    if args.file and args.example:
        raise ValueError("Cannot choose from file and example.")
    if args.file and args.str:
        raise ValueError("Cannot choose from file and string.")
    if args.example and args.str:
        raise ValueError("Cannot choose from string and example.")

    if args.file:
        print(f"Importing grid puzzle from {args.file}")
        x = importlib.import_module(args.file)
        solver.solve(x.g, detail)
    elif args.example:
        g = examples2.get_example(args)
        solver.solve(g, detail)
    elif args.str:
        g = create_from_str(args.str, args.class_)
        solver.solve(g, detail)
    else:
        raise RuntimeError("Must define input puzzle either via module file or example choice. Run -h to see details.")

    elapsed_time = time.process_time() - start_time
    print(f"Took {elapsed_time:.4f}s to execute.")
