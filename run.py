import argparse
import importlib
import time

from colorama import init

import examples
from grid_classes import solver

if __name__ == "__main__":

    init()

    parser = argparse.ArgumentParser(description="Solve grid puzzle")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-c", "--choice", choices=("a", "b", "c", "d", "f", "m", "s", "t"), help="choose default puzzle",
                       type=str)
    group.add_argument("-f", "--file", type=str, help="load puzzle from module file")
    parser.add_argument("-d", "--detail", type=int, help="detail of log output", default=-1)
    args = parser.parse_args()

    start_time = time.process_time()

    if args.file:
        print(f"Importing grid puzzle from {args.file}")
        x = importlib.import_module(args.file)
        print(list(x.g.rules))
        solver.solve(x.g, args.detail, False)
    else:
        if not args.choice:
            args.choice = "b"

        g = examples.get_example(args)

        print(list(g.rules))
        solver.solve(g, args.detail, False)

    elapsed_time = time.process_time() - start_time
    print(f"Took {elapsed_time:.4f}s to execute.")
