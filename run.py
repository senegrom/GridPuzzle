import argparse
import importlib
from datetime import datetime

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

    startTime = datetime.now()

    if args.file:
        x = importlib.import_module(args.file)
        print(list(x.g.rules))
        solver.solve(x.g, args.detail, False)
        exit(0)

    if not args.choice:
        args.choice = "b"

    g = examples.get_example(args)

    print(list(g.rules))
    solver.solve(g, args.detail, False)

    print(f"Took {datetime.now() - startTime} to execute.")
