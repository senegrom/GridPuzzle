import argparse
import importlib

from colorama import init

import classes
import examples

init()

parser = argparse.ArgumentParser(description="Solve grid puzzle")
group = parser.add_mutually_exclusive_group()
group.add_argument("-c", "--choice", choices=("a", "b", "c", "d", "f", "m", "s", "t"), help="choose default puzzle",
                   type=str)
group.add_argument("-f", "--file", type=str, help="load puzzle from module file")
parser.add_argument("-d", "--detail", type=int, help="detail of log output", default=-1)
args = parser.parse_args()

if args.file:
    x = importlib.import_module(args.file)
    print(list(x.g.rules))
    classes.Solver(x.g, args.detail).solve_full(False, False)
    exit(0)

if not args.choice:
    args.choice = "d"

g = examples.get_example(args)

print(list(g.rules))
classes.Solver(g, args.detail).solve_full(False, False)
