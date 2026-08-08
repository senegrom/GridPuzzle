import logging

import pytest

from gridsolver.abstract_grids.grid_loading import (
    create_from_file,
    create_from_str,
    create_from_str_and_class,
)
from gridsolver.grid_classes.latins_square import LatinSquare
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver.logger import get_log
from run import build_parser


def test_grid_loading_uses_exact_integer_size_inference():
    sudoku = create_from_str("Sudoku::" + "." * 81)
    latin = create_from_str_and_class("....", "latinsquare")

    assert isinstance(sudoku, Sudoku)
    assert sudoku.rows == sudoku.cols == 9
    assert isinstance(latin, LatinSquare)
    assert latin.rows == latin.cols == 2

    with pytest.raises(ValueError, match="non-square"):
        create_from_str_and_class("." * 15, "sudoku")
    with pytest.raises(ValueError, match="equal square"):
        create_from_str_and_class("." * 36, "sudoku")


def test_grid_loading_rejects_ambiguous_types_and_missing_separators():
    with pytest.raises(ValueError, match="no ::"):
        create_from_str("....")
    with pytest.raises(ValueError, match="not supported"):
        create_from_str_and_class("....", "unknown")
    with pytest.raises(TypeError, match="Grid subclass"):
        create_from_str_and_class("....", object)


def test_file_loader_uses_utf8_and_ignores_comments(tmp_path):
    puzzle = tmp_path / "puzzle.pzl"
    puzzle.write_text("# comment\nLatinSquare::\n. .\n. .\n", encoding="utf-8")

    grid = create_from_file(puzzle, space_sep=True)

    assert isinstance(grid, LatinSquare)
    assert grid.rows == grid.cols == 2


def test_cli_parser_exposes_parallel_and_solution_limits():
    parser = build_parser()
    args = parser.parse_args(
        [
            "--str",
            "....",
            "--class",
            "latinsquare",
            "--processes",
            "3",
            "--max-solutions",
            "2",
            "--colour",
            "No",
        ]
    )

    assert args.puzzle_string == "...."
    assert args.puzzle_class == "latinsquare"
    assert args.processes == 3
    assert args.max_solutions == 2
    assert args.colour == "No"


def test_get_log_does_not_reconfigure_the_root_logger():
    root = logging.getLogger()
    before = tuple(root.handlers)

    wrapped = get_log("gridpuzzle.tests.null-handler", 0)

    assert tuple(root.handlers) == before
    assert any(isinstance(handler, logging.NullHandler) for handler in wrapped.lg.handlers)
