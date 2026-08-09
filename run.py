import argparse
import importlib
import time
from collections.abc import Sequence

import examples2
from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str_and_class
from gridsolver.solver import solver
from gridsolver.solver.logger import Colouring, MAX_LVL, get_log, set_colouring


_LOG = get_log(__name__, 0)
_PUZZLE_CLASSES = (
    "sudoku",
    "killersudoku",
    "futoshiki",
    "kenken",
    "latinsquare",
    "diagonallatinsquare",
    "pandiagonallatinsquare",
)


def _non_negative_int(raw_value: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if value < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return value


def _solution_limit(raw_value: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if value < -1:
        raise argparse.ArgumentTypeError("must be -1 or non-negative")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Solve a grid puzzle")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "-m",
        "--module",
        help="Python module containing puzzle object g",
    )
    source.add_argument(
        "-s",
        "--str",
        dest="puzzle_string",
        help="Puzzle string",
    )
    source.add_argument("-f", "--file", help="Puzzle file")
    source.add_argument(
        "-e",
        "--example",
        choices=("a", "b", "c", "d", "f", "m", "s", "t"),
        help="Built-in example puzzle",
    )

    parser.add_argument(
        "-c",
        "--class",
        "--class_",
        dest="puzzle_class",
        choices=_PUZZLE_CLASSES,
        help="Puzzle class; required with --str",
    )
    parser.add_argument(
        "-o",
        "--colour",
        choices=tuple(mode.name for mode in Colouring),
        default=Colouring.Colorama.name,
        help="Output colouring mode",
    )
    parser.add_argument(
        "-d",
        "--detail",
        type=int,
        default=0,
        help="Log detail level",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Print every solver step",
    )
    parser.add_argument(
        "-p",
        "--processes",
        type=_non_negative_int,
        default=0,
        help="Top-level process-pool workers (0 or 1 means sequential)",
    )
    parser.add_argument(
        "--max-solutions",
        type=_solution_limit,
        default=-1,
        help="Maximum returned solutions; -1 means unlimited",
    )
    parser.add_argument(
        "--depth-gate",
        type=_non_negative_int,
        default=None,
        help=(
            "Run only cheap deductions below this backtracking depth; "
            "disabled by default"
        ),
    )
    parser.add_argument(
        "--space-separated",
        action="store_true",
        help="Treat whitespace as value separators for string/file input",
    )
    parser.add_argument(
        "--column-wise",
        action="store_true",
        help="Interpret string/file values column-wise",
    )
    return parser


def _load_grid(args: argparse.Namespace, parser: argparse.ArgumentParser) -> Grid:
    row_wise = not args.column_wise

    if args.module:
        try:
            module = importlib.import_module(args.module)
        except ImportError as exc:
            parser.error(f"Cannot import module {args.module!r}: {exc}")
        if not hasattr(module, "g"):
            parser.error(f"Module {args.module!r} does not define puzzle object g")
        grid = module.g
        if not isinstance(grid, Grid):
            parser.error(f"{args.module}.g is not a Grid instance")
        return grid

    if args.file:
        try:
            return create_from_file(
                args.file,
                row_wise=row_wise,
                space_sep=args.space_separated,
            )
        except (OSError, TypeError, ValueError) as exc:
            parser.error(str(exc))

    if args.example:
        return examples2.get_example(args)

    if not args.puzzle_class:
        parser.error("--class is required with --str")
    try:
        return create_from_str_and_class(
            args.puzzle_string,
            args.puzzle_class,
            row_wise=row_wise,
            space_sep=args.space_separated,
        )
    except (TypeError, ValueError) as exc:
        parser.error(str(exc))


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    set_colouring(Colouring[args.colour])
    detail = MAX_LVL if args.verbose else args.detail
    solver.set_loglevel(detail)

    grid = _load_grid(args, parser)
    start = time.perf_counter()
    solver.solve(
        grid,
        max_sols=args.max_solutions,
        processes=args.processes,
        depth_gate=args.depth_gate,
    )
    _LOG.logs(0, f"Took {time.perf_counter() - start:.4f}s to execute.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
