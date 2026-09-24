import logging
import os
from pathlib import Path
import re
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
from gridsolver.solver import solver
from gridsolver.solver.logger import get_log
from gridsolver.cli import build_parser, main

_ROOT = Path(__file__).resolve().parents[1]


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
        "import gridsolver.cli; "
        "print(sorted(name for name in sys.modules "
        "if name.startswith('gridsolver.grid_classes.')))"
    )
    output = subprocess.check_output(
        [sys.executable, "-c", command],
        text=True,
    )

    assert output.strip() == "[]"


def _gridpuzzle(*argv, colour="No"):
    """Run the CLI in its own interpreter: the exit status is a process contract."""
    environment = dict(os.environ, PYTHONPATH=str(_ROOT), PYTHONIOENCODING="utf-8")
    colour_option = ("--colour", colour) if colour else ()
    return subprocess.run(
        [sys.executable, "-m", "gridsolver.cli", *argv, *colour_option],
        cwd=_ROOT, env=environment, capture_output=True, encoding="utf-8",
        timeout=120,
    )


_TOOK = re.compile(r"Took \d+\.\d{4}s to execute\.")
# stdout of `python run.py ARGS` on master fa48f70, before the solver's log
# records moved from levels 1..1001 into INFO/DEBUG; only the timing differs
# between runs. The CLI configures its own handler, so none of it may change.
_GOLDEN_OUTPUT = {
    ("--str", "LatinSquare::1...", "--verbose"): (
        'Solving rule-based\n'
        'LatinSquare(2,2) - [8 rls, 0 ria, 0 gts, 0 gia]\n'
        '\u250f\u2501\u2501\u252f\u2501\u2501\u2513\n'
        '\u25031 \u250212\u2503\n'
        '\u2520\u2500\u2500\u253c\u2500\u2500\u2528\n'
        '\u250312\u250212\u2503\n'
        '\u2517\u2501\u2501\u2537\u2501\u2501\u251b\n'
        '\n'
        '\x1b[34mStep [0] - 0 (basic)\x1b[0m\n'
        'LatinSquare(2,2) - [4 rls, 4 ria, 1 gts, 7 gia]\n'
        '\u250f\u2501\u2501\u252f\u2501\u2501\u2513\n'
        '\u25031 \u2502\x1b[91m1\x1b[0m2\u2503\n'
        '\u2520\u2500\u2500\u253c\u2500\u2500\u2528\n'
        '\u2503\x1b[91m1\x1b[0m2\u25021\x1b[91m2\x1b[0m\u2503\n'
        '\u2517\u2501\u2501\u2537\u2501\u2501\u251b\n'
        '\n'
        '\x1b[34mStep [0] - 1 (basic)\x1b[0m\n'
        'LatinSquare(2,2) - [0 rls, 8 ria, 0 gts, 8 gia]\n'
        '\u250f\u2501\u2501\u252f\u2501\u2501\u2513\n'
        '\u25031 \u2502 2\u2503\n'
        '\u2520\u2500\u2500\u253c\u2500\u2500\u2528\n'
        '\u2503 2\u25021 \u2503\n'
        '\u2517\u2501\u2501\u2537\u2501\u2501\u251b\n'
        '\n'
        'Done after 2 steps: \tSolveStatus.SOLVED\n'
        'LatinSquare(2,2) - [0 rls, 8 ria, 0 gts, 8 gia]\n'
        '\u250f\u2501\u2501\u252f\u2501\u2501\u2513\n'
        '\u25031 \u2502 2\u2503\n'
        '\u2520\u2500\u2500\u253c\u2500\u2500\u2528\n'
        '\u2503 2\u25021 \u2503\n'
        '\u2517\u2501\u2501\u2537\u2501\u2501\u251b\n'
        '\n'
        '\x1b[34mSolution 0\x1b[0m\n'
        'LatinSquare(2,2)\n'
        '\u250f\u2501\u2501\u2513\n'
        '\u250312\u2503\n'
        '\u250321\u2503\n'
        '\u2517\u2501\u2501\u251b\n'
        '\n'
        'Took <T>s to execute.\n'
    ),
    ("--str", ".........", "--class", "latinsquare", "--max-solutions", "2",
     "--colour", "No"): (
        'Step [0, 0, 2] - Reached max_sols == 2\n'
        'Step [0, 1] - Reached max_sols == 2\n'
        'Step [1] - Reached max_sols == 2\n'
        'Solution 0\n'
        'LatinSquare(3,3)\n'
        '\u250f\u2501\u2501\u2501\u2513\n'
        '\u2503123\u2503\n'
        '\u2503231\u2503\n'
        '\u2503312\u2503\n'
        '\u2517\u2501\u2501\u2501\u251b\n'
        '\n'
        'Solution 1\n'
        'LatinSquare(3,3)\n'
        '\u250f\u2501\u2501\u2501\u2513\n'
        '\u2503132\u2503\n'
        '\u2503213\u2503\n'
        '\u2503321\u2503\n'
        '\u2517\u2501\u2501\u2501\u251b\n'
        '\n'
        'Took <T>s to execute.\n'
    ),
    ("--file", "Examples/Hidato/Mebane/Mebane-III.1-S.clp", "--max-solutions", "1"): (
        '\x1b[34mSolution 0\x1b[0m\n'
        ' 5  4  7  8  9\n'
        ' 3  6 ## 10 11\n'
        ' 2 ## ## ## 12\n'
        ' 1 19 ## 16 13\n'
        '20 18 17 15 14\n'
        'Took <T>s to execute.\n'
    ),
}


@pytest.mark.parametrize("argv", list(_GOLDEN_OUTPUT), ids=("verbose", "capped", "compact"))
def test_cli_output_matches_the_golden_capture(argv):
    result = _gridpuzzle(*argv, colour=None)

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert _TOOK.sub("Took <T>s to execute.", result.stdout) == _GOLDEN_OUTPUT[argv]


def test_cli_exit_status_reports_whether_the_puzzle_has_a_solution():
    solved = _gridpuzzle("--str", "LatinSquare::1...")
    unsolvable = _gridpuzzle("--str", "LatinSquare::11..")
    nothing_asked = _gridpuzzle("--str", "LatinSquare::11..", "--max-solutions", "0")
    usage_error = _gridpuzzle("--str", "11..")

    assert solved.returncode == 0, solved.stderr
    assert "Solution 0" in solved.stdout
    assert unsolvable.returncode == 1, unsolvable.stderr
    assert "No solution found." in unsolvable.stdout
    assert nothing_asked.returncode == 0, nothing_asked.stderr
    assert usage_error.returncode == 2
    assert "pass --class" in usage_error.stderr


@pytest.mark.parametrize("processes", ("0", "1"))
def test_cli_thread_backend_without_workers_is_a_usage_error(processes, capsys):
    with pytest.raises(SystemExit) as exit_info:
        main(["--str", "LatinSquare::1...", "--processes", processes,
              "--parallel-backend", "thread"])
    assert exit_info.value.code == 2
    assert "requires --processes 2 or more" in capsys.readouterr().err


def test_cli_thread_backend_on_a_gil_build_is_a_usage_error(monkeypatch, capsys):
    # It used to reach solve() and die with a RuntimeError traceback.
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: False)
    with pytest.raises(SystemExit) as exit_info:
        main(["--str", "LatinSquare::1...", "--processes", "2",
              "--parallel-backend", "thread"])
    assert exit_info.value.code == 2
    assert "free-threaded Python runtime" in capsys.readouterr().err


@pytest.mark.parametrize("flag", ("--column-wise", "--space-separated"))
@pytest.mark.parametrize(
    "source, kind",
    (
        (("--example", "s"), "--example"),
        (("--module", "gridsolver.examples.sudoku"), "--module"),
        (("--str", "(solve 1 1 4)"), "CSP-Rules"),
        (("--file", "{csp_file}"), "CSP-Rules"),
    ),
)
def test_cli_rejects_layout_flags_its_input_ignores(source, kind, flag, tmp_path, capsys):
    csp_file = tmp_path / "loop.clp"
    csp_file.write_text("(solve 1 1 4)\n", encoding="utf-8")
    argv = [part.format(csp_file=csp_file) for part in source]

    with pytest.raises(SystemExit) as exit_info:
        main([*argv, flag])

    assert exit_info.value.code == 2
    assert f"{flag} does not apply to {kind} input" in capsys.readouterr().err


def test_cli_still_honours_layout_flags_for_class_prefixed_input():
    column_wise = _gridpuzzle("--str", "LatinSquare::12..", "--column-wise")
    spaced = _gridpuzzle("--str", "LatinSquare::1 . . 1", "--space-separated")

    assert column_wise.returncode == 0, column_wise.stderr
    assert spaced.returncode == 0, spaced.stderr
