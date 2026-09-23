"""The ``gridpuzzle`` command line (``python run.py`` in a checkout)."""

import argparse
import importlib
import time
from collections.abc import Sequence
from pathlib import Path

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import (
    create_from_file,
    create_from_str,
    create_from_str_and_class,
)
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
    parser = argparse.ArgumentParser(
        description="Solve a grid puzzle",
        epilog=(
            "Exit status: 0 when the puzzle has a solution, 1 when it has "
            "none, 2 for usage and input errors."
        ),
    )
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
        help=(
            "Puzzle class for bare --str value strings; class-prefixed and "
            "CSP-Rules strings are self-describing"
        ),
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
        help="Top-level workers (0 or 1 means sequential)",
    )
    parser.add_argument(
        "--parallel-backend",
        choices=("process", "thread"),
        default="process",
        help=(
            "Top-level executor; thread requires a free-threaded Python "
            "runtime and is opt-in"
        ),
    )
    parser.add_argument(
        "--max-solutions",
        type=_solution_limit,
        default=-1,
        help="Maximum returned solutions; -1 means unlimited",
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


def _reject_ignored_options(
    args: argparse.Namespace,
    parser: argparse.ArgumentParser,
) -> None:
    """Fail on options that the runtime or the chosen input cannot honour."""
    if args.parallel_backend == "thread":
        if args.processes <= 1:
            parser.error("--parallel-backend thread requires --processes 2 or more")
        if not solver.free_threaded_runtime_available():
            parser.error(
                "--parallel-backend thread requires a free-threaded Python "
                "runtime with the GIL disabled"
            )

    # Like a forced --class, a silently ignored layout flag would be a trap:
    # built grids and CSP-Rules forms fix their own layout.
    layout_flags = [
        flag
        for flag, given in (
            ("--column-wise", args.column_wise),
            ("--space-separated", args.space_separated),
        )
        if given
    ]
    if not layout_flags:
        return
    if args.module or args.example:
        source = "--module" if args.module else "--example"
        parser.error(f"{layout_flags[0]} does not apply to {source} input")

    from gridsolver.abstract_grids.csp_rules_loading import is_csp_rules_text

    if args.file:
        try:
            text = Path(args.file).read_text(encoding="utf-8-sig")
        except (OSError, ValueError) as exc:
            parser.error(str(exc))
    else:
        # --class parses its string as bare values, never as CSP-Rules.
        text = None if args.puzzle_class else args.puzzle_string
    if is_csp_rules_text(text):
        parser.error(f"{layout_flags[0]} does not apply to CSP-Rules input")


def _load_grid(args: argparse.Namespace, parser: argparse.ArgumentParser) -> Grid:
    row_wise = not args.column_wise

    if args.puzzle_class and args.puzzle_string is None:
        # silently ignoring a forced class would be a trap
        parser.error("--class only applies to --str input")

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
        from gridsolver.examples.catalog import get_example

        return get_example(args.example)

    if not args.puzzle_class:
        # class-prefixed ("Sudoku::...") and CSP-Rules strings are
        # self-describing; only bare value strings need --class
        try:
            return create_from_str(
                args.puzzle_string,
                row_wise=row_wise,
                space_sep=args.space_separated,
            )
        except (TypeError, ValueError) as exc:
            parser.error(f"{exc} (pass --class to parse bare value strings)")
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
    _reject_ignored_options(args, parser)

    set_colouring(Colouring[args.colour])
    detail = MAX_LVL if args.verbose else args.detail
    solver.set_loglevel(detail)

    grid = _load_grid(args, parser)
    start = time.perf_counter()
    solutions = solver.solve(
        grid,
        max_sols=args.max_solutions,
        processes=args.processes,
        parallel_backend=args.parallel_backend,
    )
    _LOG.logs(0, f"Took {time.perf_counter() - start:.4f}s to execute.")
    # argparse already exits 2 on usage and input errors. --max-solutions 0
    # asks for no solutions, so finding none is not a failure there.
    return 0 if solutions or args.max_solutions == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
