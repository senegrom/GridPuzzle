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
            "--colour",
            "No",
        ]
    )

    assert args.puzzle_string == "...."
    assert args.puzzle_class == "latinsquare"
    assert args.processes == 3
    assert args.max_solutions == 2
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


# CSP-Rules texts whose solve form follows uncommented header lines, like the
# Mebane Slitherlink files' "Mellon rating = N" line. Without a :: outside
# comments a text cannot be class-prefixed, so its first solve form (outside
# comments and quoted strings) is read, as the corpus runner reads it.
_HEADED_CSP_RULES_TEXTS = {
    "rating line": "Mellon rating = 1\n\n\n(solve\n1 1\n4\n)\n",
    "header lines with a colon": "Source: Mebane\nrated 2\n(solve 1 1 4)\n",
    ":: only in comments": "; Sudoku::...\nMellon rating = 1 ; a::b\n(solve 1 1 4)\n",
    "a quoted fake form above": '"archived (solve 1 2 . .)"\n(solve 1 1 4)\n',
}


@pytest.mark.parametrize("route", ("file", "str"))
@pytest.mark.parametrize(
    "text", list(_HEADED_CSP_RULES_TEXTS.values()), ids=list(_HEADED_CSP_RULES_TEXTS)
)
def test_csp_rules_form_below_uncommented_header_lines_is_read(text, route, tmp_path):
    from gridsolver.abstract_grids.csp_rules_loading import is_csp_rules_text
    from gridsolver.grid_classes.slitherlink import Slitherlink

    if route == "file":
        puzzle = tmp_path / "headed.txt"
        puzzle.write_text(text, encoding="utf-8")
        grid = create_from_file(puzzle)
    else:
        grid = create_from_str(text)

    assert is_csp_rules_text(text)
    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


@pytest.mark.parametrize(
    ("text", "error"),
    (
        # A :: outside comments may be a class separator, so the class path
        # reads the text with its own messages, also when a solver transcript
        # holds a later, uncommented solve form.
        ("LatinSquare::1...\n(solve 1 1 4)", "Cannot parse puzzle input with class LatinSquare: "),
        ("Source: a::b\n(solve 1 1 4)", "Puzzle class 'source: a' is not supported; "),
        # No solve form outside comments and quoted strings: a bare value string.
        ("Mellon rating = 1", "Puzzle string contains no :: class separator"),
        ("11..\n; (solve 1 1 4)", "Puzzle string contains no :: class separator"),
        ("11..\n# (solve 1 1 4)", "Puzzle string contains no :: class separator"),
        ('11.. "(solve 1 1 4)"', "Puzzle string contains no :: class separator"),
    ),
)
def test_text_with_a_class_separator_or_no_solve_form_keeps_the_class_path(text, error, tmp_path):
    from gridsolver.abstract_grids.csp_rules_loading import is_csp_rules_text

    puzzle = tmp_path / "puzzle.clp"
    puzzle.write_text(text, encoding="utf-8")

    assert not is_csp_rules_text(text)
    with pytest.raises(ValueError, match=f"^{re.escape(error)}"):
        create_from_str(text)
    with pytest.raises(ValueError, match=f"^{re.escape(error)}"):
        create_from_file(puzzle)


def test_a_leading_solve_form_is_read_despite_a_later_class_separator():
    from gridsolver.grid_classes.slitherlink import Slitherlink

    grid = create_from_str("(solve 1 1 4)\nLatinSquare::1...")

    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


# The corpora whose values are space-separated tokens, as
# tests/test_examples_sudoku*.py load them (--space-separated on the CLI).
_SPACE_SEPARATED_CORPORA = frozenset((
    "Examples/Sudoku/16x16",
    "Examples/Sudoku/25x25+",
    "Examples/Sudoku/CLIPS-puzzles-big",
))


def test_every_shipped_example_loads_on_the_normal_file_route():
    # README: the retained corpora are first-class inputs of `gridpuzzle
    # --file`. Fifteen Mebane Slitherlink files open with a bare "Mellon
    # rating = N" line above their solve form; while detection read only the
    # first meaningful line, they failed here with "no :: class separator".
    # The puzzle files Examples/NOTICE.md lists: the .clp, .sdk and .pzl
    # files and one .txt Latin square (the other .txt files are notes and
    # the GPL text).
    puzzles = sorted(
        path for path in (_ROOT / "Examples").rglob("*")
        if path.suffix in {".clp", ".sdk", ".pzl"}
        or (path.suffix == ".txt" and path.name not in {"README.txt", "COPYING-GPL-3.0.txt"})
    )
    failures = {}
    for path in puzzles:
        folder = path.parent.relative_to(_ROOT).as_posix()
        try:
            create_from_file(path, space_sep=folder in _SPACE_SEPARATED_CORPORA)
        except (TypeError, ValueError) as exc:
            failures[path.relative_to(_ROOT).as_posix()] = str(exc)

    assert sum(path.parent.name == "Mebane" and "Slitherlink" in path.parts for path in puzzles) == 16
    assert failures == {}


def test_every_csp_rules_example_gives_the_corpus_runners_grid():
    # The corpus runner reads a file's first solve form wherever it is; the
    # normal file route must read that same form, below a header too.
    from gridsolver.abstract_grids.csp_rules_loading import create_from_csp_rules_file

    puzzles = sorted(
        path
        for family in ("Hidato", "Kakuro", "Numbrix", "Slitherlink")
        for path in (_ROOT / "Examples" / family).rglob("*.clp")
    )
    differences = {}
    for path in puzzles:
        name = path.relative_to(_ROOT).as_posix()
        try:
            if create_from_file(path) != create_from_csp_rules_file(path):
                differences[name] = "a different grid"
        except (TypeError, ValueError) as exc:
            differences[name] = str(exc)

    assert sum(path.parent.name == "Mebane" and "Slitherlink" in path.parts for path in puzzles) == 16
    assert differences == {}


def test_cli_solves_a_mebane_slitherlink_file_with_its_rating_header():
    puzzle = "Examples/Slitherlink/Mebane/#I.0-5x5-W1-L30.clp"
    header = (_ROOT / puzzle).read_text(encoding="utf-8").splitlines()[0]
    assert header.endswith("Mellon rating = 1")

    result = _gridpuzzle("--file", puzzle, "--max-solutions", "1")

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert "Solution 0" in result.stdout


def test_cli_solves_a_csp_rules_string_below_a_header_line():
    result = _gridpuzzle("--str", "Mellon rating = 1\n(solve 1 1 4)", "--max-solutions", "1")

    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert "Solution 0" in result.stdout


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


def _gridpuzzle(*argv, colour="No", path=()):
    """Run the CLI in its own interpreter: the exit status is a process contract."""
    environment = dict(os.environ, PYTHONPATH=os.pathsep.join((str(_ROOT), *map(str, path))),
                       PYTHONIOENCODING="utf-8")
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
    # the command's name, not the path of the script that started it
    assert usage_error.stderr.startswith("usage: gridpuzzle ")


@pytest.mark.parametrize(
    ("puzzle", "error"),
    (
        # A bare value string: only --class can say what it is.
        ("11..", "Puzzle string contains no :: class separator "
                 "(pass --class to parse bare value strings)"),
        # Self-describing strings: --class would parse the "Class::" prefix or
        # the CSP-Rules form as values, and offers no CSP-Rules family anyway.
        ("Sudoku::....", "Cannot parse puzzle input with class Sudoku: "
                         "Cannot infer equal square Sudoku boxes from grid side 2"),
        ("Futoshiki::....<<", "Cannot parse puzzle input with class Futoshiki: "
                              "Cannot infer Futoshiki size from length 6; expected 3n²-2n"),
        ("KillerSudoku::aaaa:a10", "Cannot parse puzzle input with class KillerSudoku: "
                                   "Cannot infer equal square Sudoku boxes from grid side 2"),
        ("Kenken::ab:a+1b+2", "Cannot parse puzzle input with class Kenken: "
                              "Cannot infer KenKen side length from non-square length 2"),
        ("Sodoku::1...", "Puzzle class 'sodoku' is not supported; choose one of diagonallatinsquare, "
                         "futoshiki, kenken, killersudoku, latinsquare, pandiagonallatinsquare, sudoku"),
        ("(solve 2 2 9 . . .)", "Slitherlink clue 9 at (0, 0) is outside 0..4"),
        ("(solve 1 1 4", "CSP-Rules solve form is not closed"),
        # Below a header line, with no :: outside comments, a solve form is
        # still CSP-Rules; one in a comment makes no CSP-Rules text.
        ("Mellon rating = 1\n(solve 2 2 9 . . .)", "Slitherlink clue 9 at (0, 0) is outside 0..4"),
        ("11.. ; (solve 1 1 4)", "Puzzle string contains no :: class separator "
                                 "(pass --class to parse bare value strings)"),
    ),
)
def test_cli_suggests_class_only_where_it_can_help(puzzle, error):
    result = _gridpuzzle("--str", puzzle)

    assert result.returncode == 2
    assert result.stderr.splitlines()[-1] == f"gridpuzzle: error: {error}"


@pytest.mark.parametrize(
    ("argv", "option"),
    (
        (("--file", ""), "-f/--file"),
        (("--file=",), "-f/--file"),
        (("--module", ""), "-m/--module"),
        (("--module=",), "-m/--module"),
    ),
)
def test_cli_rejects_an_empty_file_or_module_name(argv, option, capsys):
    # An empty value read as not given and fell through to the --str branch,
    # whose error handler then failed on None: a traceback and status 3,
    # which says the solver itself failed.
    with pytest.raises(SystemExit) as exit_info:
        main([*argv, "--colour", "No"])

    assert exit_info.value.code == 2
    error = capsys.readouterr().err
    assert "Traceback" not in error
    assert error.splitlines()[-1] == f"gridpuzzle: error: argument {option}: must not be empty"


def test_cli_puzzle_module_that_fails_to_load_is_an_input_error(tmp_path):
    # It used to escape as a traceback with status 1, which says "no solution".
    (tmp_path / "broken_puzzle.py").write_text("g = 1 / 0\n", encoding="utf-8")
    result = _gridpuzzle("--module", "broken_puzzle", path=(tmp_path,))

    assert result.returncode == 2
    assert "Cannot import module 'broken_puzzle': ZeroDivisionError: division by zero" in result.stderr
    assert "Traceback" not in result.stderr


def test_cli_internal_error_exits_3_with_its_traceback(monkeypatch, capsys):
    def fail(*args, **kwargs):
        raise RuntimeError("solver fault")

    monkeypatch.setattr(solver, "solve", fail)
    assert main(["--str", "LatinSquare::1...", "--colour", "No"]) == 3
    error = capsys.readouterr().err
    assert "Traceback (most recent call last)" in error
    assert error.rstrip().endswith("RuntimeError: solver fault")


@pytest.mark.parametrize("flag", ("--column-wise", "--space-separated"))
@pytest.mark.parametrize(
    "source, kind",
    (
        (("--example", "s"), "--example"),
        (("--module", "gridsolver.examples.sudoku"), "--module"),
        (("--str", "(solve 1 1 4)"), "CSP-Rules"),
        (("--file", "{csp_file}"), "CSP-Rules"),
        (("--str", "Mellon rating = 1\n(solve 1 1 4)"), "CSP-Rules"),
        (("--file", "{headed_csp_file}"), "CSP-Rules"),
    ),
)
def test_cli_rejects_layout_flags_its_input_ignores(source, kind, flag, tmp_path, capsys):
    csp_file = tmp_path / "loop.clp"
    csp_file.write_text("(solve 1 1 4)\n", encoding="utf-8")
    headed_csp_file = tmp_path / "headed.clp"
    headed_csp_file.write_text("Mellon rating = 1\n(solve 1 1 4)\n", encoding="utf-8")
    argv = [part.format(csp_file=csp_file, headed_csp_file=headed_csp_file) for part in source]

    with pytest.raises(SystemExit) as exit_info:
        main([*argv, flag])

    assert exit_info.value.code == 2
    assert f"{flag} does not apply to {kind} input" in capsys.readouterr().err


def test_cli_still_honours_layout_flags_for_class_prefixed_input():
    column_wise = _gridpuzzle("--str", "LatinSquare::12..", "--column-wise")
    spaced = _gridpuzzle("--str", "LatinSquare::1 . . 1", "--space-separated")

    assert column_wise.returncode == 0, column_wise.stderr
    assert spaced.returncode == 0, spaced.stderr
