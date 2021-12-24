import argparse
import importlib
import time

import examples
from gridsolver.grid_classes import solver

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Solve grid puzzle")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("file", help="module file to load puzzle from", type=str, nargs="?")
    group.add_argument("-c", "--choice", choices=("a", "b", "c", "d", "f", "m", "s", "t"),
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

    if args.file:
        print(f"Importing grid puzzle from {args.file}")
        x = importlib.import_module(args.file)
        solver.solve(x.g, detail)
    elif args.choice:
        g = examples.get_example(args)
        solver.solve(g, detail)
    else:
        raise RuntimeError("Must define input puzzle either via module file or example choice. Run -h to see details.")

    elapsed_time = time.process_time() - start_time
    print(f"Took {elapsed_time:.4f}s to execute.")
