import logging
import subprocess
import sys

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import (
    create_from_file,
    create_from_str,
    create_from_str_and_class,
)
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
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
            "--parallel-backend",
            "process",
            "--colour",
            "No",
        ]
    )

    assert args.puzzle_string == "...."
    assert args.puzzle_class == "latinsquare"
    assert args.processes == 3
    assert args.max_solutions == 2
    assert args.parallel_backend == "process"
    assert args.colour == "No"


def test_cli_parser_rejects_invalid_worker_and_solution_limits():
    parser = build_parser()
    common = ["--str", "....", "--class", "latinsquare"]

    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--processes", "-1"])
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--max-solutions", "-2"])
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--processes", "not-an-int"])
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--parallel-backend", "auto"])


def test_get_log_does_not_reconfigure_the_root_logger():
    root = logging.getLogger()
    before = tuple(root.handlers)

    wrapped = get_log("gridpuzzle.tests.null-handler", 0)

    assert tuple(root.handlers) == before
    assert any(isinstance(handler, logging.NullHandler) for handler in wrapped.lg.handlers)


@pytest.mark.parametrize("name", ("row_wise", "space_sep"))
def test_grid_load_rejects_non_boolean_options_and_remains_retryable(name):
    grid = Grid(1)

    with pytest.raises(TypeError, match=rf"{name} must be a boolean"):
        grid.load("0", **{name: 1})

    assert not grid.has_been_filled
    grid.load("1")
    assert grid.known == (1,)


@pytest.mark.parametrize("name", ("row_wise", "space_sep"))
def test_loader_factories_reject_non_boolean_options(name):
    with pytest.raises(TypeError, match=rf"{name} must be a boolean"):
        create_from_str("Sudoku::1", **{name: "yes"})


def test_file_loader_validates_options_before_reading(tmp_path):
    missing = tmp_path / "missing.txt"
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        create_from_file(missing, row_wise=1)


class _UnsupportedGrid(Grid):
    pass


def test_loader_rejects_unsupported_grid_subclasses_early():
    with pytest.raises(ValueError, match="is not supported"):
        create_from_str_and_class("0", _UnsupportedGrid)


def test_loader_rejects_unsupported_class_before_consuming_input():
    consumed: list[str] = []

    def values():
        consumed.append("consumed")
        yield "0"

    with pytest.raises(ValueError, match="is not supported"):
        create_from_str_and_class(values(), _UnsupportedGrid)

    assert consumed == []


def test_loader_rejects_ambiguous_top_level_bytes():
    with pytest.raises(TypeError, match="decoded to str"):
        create_from_str_and_class(b"1", Sudoku)


def test_cage_split_rejects_bytes_and_non_string_iterable_parts():
    from gridsolver.grid_classes.cage_loading import split_cage_input

    with pytest.raises(TypeError, match="decoded to str"):
        split_cage_input(b"a:a1")
    with pytest.raises(TypeError, match="only strings"):
        split_cage_input(iter(("a", 1, ":a1")))


@pytest.mark.parametrize(
    "grid, payload",
    (
        (KillerSudoku(None, 1, 1, 1, 1), "a:a\N{SUPERSCRIPT TWO}"),
        (Kenken(None, 1), "a:a+\N{SUPERSCRIPT TWO}"),
    ),
)
def test_cage_dictionary_numbers_are_ascii_digits(grid, payload):
    with pytest.raises(ValueError, match="string format invalid"):
        grid.load(payload)
    assert not grid.has_been_filled


def test_specialized_loaders_validate_flags_before_mutation():
    futoshiki = Futoshiki(1)
    killer = KillerSudoku(None, 1, 1, 1, 1)
    kenken = Kenken(None, 1)

    with pytest.raises(TypeError, match="space_sep must be a boolean"):
        futoshiki.load("0", space_sep=1)
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        killer.load("a:a1", row_wise=1)
    with pytest.raises(TypeError, match="row_wise must be a boolean"):
        kenken.load_with_dic("a", {"a": ("+", 1)}, row_wise="yes")

    for grid in (futoshiki, killer, kenken):
        assert not grid.has_been_filled
        assert not grid.rules_ia



def test_csp_detection_uses_first_meaningful_line_not_suffix_or_transcript(
    tmp_path,
):
    legacy = tmp_path / "legacy.clp"
    legacy.write_text(
        "# retained comment\n"
        "LatinSquare::\n"
        ". .\n"
        ". .\n"
        "# later solver transcript\n"
        "# (solve 1 1 4)\n",
        encoding="utf-8",
    )

    grid = create_from_file(legacy, space_sep=True)

    assert isinstance(grid, LatinSquare)
    assert grid.rows == grid.cols == 2


def test_csp_detection_accepts_leading_comments_without_clp_suffix(tmp_path):
    puzzle = tmp_path / "slitherlink.txt"
    puzzle.write_text(
        "; retained source comment\n"
        "# another comment\n"
        "\n"
        "(solve 1 1 4)\n",
        encoding="utf-8",
    )

    grid = create_from_file(puzzle)

    from gridsolver.grid_classes.slitherlink import Slitherlink

    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


def test_class_prefixed_string_is_not_misdetected_from_later_transcript():
    from gridsolver.abstract_grids.csp_rules_loading import is_csp_rules_text

    assert not is_csp_rules_text(
        "LatinSquare::\n. .\n. .\n# (solve 1 1 4)"
    )

def test_loader_and_cli_imports_do_not_eagerly_load_puzzle_families():
    command = (
        "import sys; "
        "import run; "
        "print(sorted(name for name in sys.modules "
        "if name.startswith('gridsolver.grid_classes.')))"
    )
    output = subprocess.check_output(
        [sys.executable, "-c", command],
        text=True,
    )

    assert output.strip() == "[]"
