"""Harden formatting and Sudoku constructor boundaries."""

from pathlib import Path
from textwrap import dedent


def lines(*parts: str) -> str:
    return "".join(part + "\n" for part in parts)


pretty_path = Path("gridsolver/abstract_grids/pretty_print.py")
text = pretty_path.read_text(encoding="utf-8")
start = text.index("class PrettyPrintArgs:\n")
end = text.index("def _positive_integer(", start)
replacement = dedent('''
    class PrettyPrintArgs:

        @staticmethod
        def _none_alternate(arg1, arg2, default):
            return (default if arg2 is None else arg2) if arg1 is None else arg1

        @staticmethod
        def _separator(name: str, value: object, maximum: int) -> int:
            if isinstance(value, bool) or not isinstance(value, Integral):
                raise TypeError(f"{name} must be an integer")
            value = int(value)
            if not 0 <= value <= maximum:
                raise ValueError(
                    f"{name} must be between 0 and {maximum}"
                )
            return value

        @staticmethod
        def _inner_dimension(name: str, value: object) -> int | str:
            if value == "sqrt":
                return value
            if isinstance(value, bool) or not isinstance(value, Integral):
                raise TypeError(
                    f"{name} must be a non-negative integer or 'sqrt'"
                )
            value = int(value)
            if value < 0:
                raise ValueError(
                    f"{name} must be non-negative or 'sqrt'"
                )
            return value

        def __init__(
            self,
            sep_up: int | None = None,
            print_candidates: bool | None = None,
            sep_lo: int | None = None,
            sep_ri: int | None = None,
            sep_le: int | None = None,
            inner_grid_row: int | str | None = None,
            inner_grid_col: int | str | None = None,
            sep_in_ve: int | None = None,
            sep_in_ho: int | None = None,
            args: 'PrettyPrintArgs | None' = None,
        ) -> None:
            if args is not None and not isinstance(args, PrettyPrintArgs):
                raise TypeError("args must be a PrettyPrintArgs instance")

            inherited = args
            self.sep_up = self._separator(
                "sep_up",
                self._none_alternate(
                    sep_up,
                    inherited.sep_up if inherited else None,
                    2,
                ),
                2,
            )
            self.sep_lo = self._separator(
                "sep_lo",
                self._none_alternate(
                    sep_lo,
                    inherited.sep_lo if inherited else None,
                    2,
                ),
                2,
            )
            self.sep_le = self._separator(
                "sep_le",
                self._none_alternate(
                    sep_le,
                    inherited.sep_le if inherited else None,
                    2,
                ),
                2,
            )
            self.sep_ri = self._separator(
                "sep_ri",
                self._none_alternate(
                    sep_ri,
                    inherited.sep_ri if inherited else None,
                    2,
                ),
                2,
            )
            self.sep_in_ve = self._separator(
                "sep_in_ve",
                self._none_alternate(
                    sep_in_ve,
                    inherited.sep_in_ve if inherited else None,
                    0,
                ),
                4,
            )
            self.sep_in_ho = self._separator(
                "sep_in_ho",
                self._none_alternate(
                    sep_in_ho,
                    inherited.sep_in_ho if inherited else None,
                    0,
                ),
                4,
            )

            raw_print_candidates = self._none_alternate(
                print_candidates,
                inherited.print_candidates if inherited else None,
                False,
            )
            if not isinstance(raw_print_candidates, bool):
                raise TypeError("print_candidates must be a boolean")
            self.print_candidates = raw_print_candidates

            self.inner_grid_row = self._inner_dimension(
                "inner_grid_row",
                self._none_alternate(
                    inner_grid_row,
                    inherited.inner_grid_row if inherited else None,
                    0,
                ),
            )
            self.inner_grid_col = self._inner_dimension(
                "inner_grid_col",
                self._none_alternate(
                    inner_grid_col,
                    inherited.inner_grid_col if inherited else None,
                    0,
                ),
            )

        def __copy__(self):
            return PrettyPrintArgs(args=self)

        def __deepcopy__(self, memodict=None):
            return PrettyPrintArgs(args=self)

        @staticmethod
        def blank() -> 'PrettyPrintArgs':
            return PrettyPrintArgs(
                sep_up=0,
                sep_lo=0,
                sep_le=0,
                sep_ri=0,
                sep_in_ve=0,
                sep_in_ho=0,
                print_candidates=False,
                inner_grid_col=0,
                inner_grid_row=0,
            )


''').lstrip()
pretty_path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


sudoku_path = Path("gridsolver/grid_classes/sudoku.py")
sudoku = sudoku_path.read_text(encoding="utf-8")
sudoku = sudoku.replace(
    "from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs\n",
    "from numbers import Integral\n\nfrom gridsolver.abstract_grids.pretty_print import PrettyPrintArgs\n",
    1,
)
class_marker = "\n\nclass Sudoku(UniqueSquareGrid):\n"
helper = dedent('''


def _box_dimension(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise TypeError(f"{name} must be an integer")
    value = int(value)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


class Sudoku(UniqueSquareGrid):
''')
if sudoku.count(class_marker) != 1:
    raise SystemExit("Sudoku class marker changed")
sudoku = sudoku.replace(class_marker, helper, 1)
old_dimensions = lines(
    "        dimensions = (rows_in_box, cols_in_box, box_rows, box_cols)",
    "        if any(value <= 0 for value in dimensions):",
    "            raise ValueError(\"Sudoku box dimensions must be positive\")",
    "",
    "        n: int = rows_in_box * box_rows",
)
new_dimensions = lines(
    "        rows_in_box = _box_dimension(\"rows_in_box\", rows_in_box)",
    "        cols_in_box = _box_dimension(\"cols_in_box\", cols_in_box)",
    "        box_rows = _box_dimension(\"box_rows\", box_rows)",
    "        box_cols = _box_dimension(\"box_cols\", box_cols)",
    "",
    "        n: int = rows_in_box * box_rows",
)
if sudoku.count(old_dimensions) != 1:
    raise SystemExit("Sudoku dimension marker changed")
sudoku_path.write_text(
    sudoku.replace(old_dimensions, new_dimensions, 1),
    encoding="utf-8",
)


tests = Path("tests/test_hardening.py")
test_text = tests.read_text(encoding="utf-8")
appendix = '''


@pytest.mark.parametrize(
    ("kwargs", "name"),
    (
        ({"rows_in_box": True, "cols_in_box": 1, "box_rows": 1, "box_cols": 1}, "rows_in_box"),
        ({"rows_in_box": 1, "cols_in_box": True, "box_rows": 1, "box_cols": 1}, "cols_in_box"),
        ({"rows_in_box": 1, "cols_in_box": 1, "box_rows": True, "box_cols": 1}, "box_rows"),
        ({"rows_in_box": 1, "cols_in_box": 1, "box_rows": 1, "box_cols": True}, "box_cols"),
        ({"rows_in_box": 1.0, "cols_in_box": 1, "box_rows": 1, "box_cols": 1}, "rows_in_box"),
    ),
)
def test_sudoku_box_dimensions_reject_coercive_values(kwargs, name):
    with pytest.raises(TypeError, match=rf"{name} must be an integer"):
        Sudoku(**kwargs)


def test_pretty_print_args_validate_separator_domains():
    with pytest.raises(TypeError, match="sep_up must be an integer"):
        PrettyPrintArgs(sep_up=True)
    with pytest.raises(ValueError, match="sep_up must be between 0 and 2"):
        PrettyPrintArgs(sep_up=3)
    with pytest.raises(ValueError, match="sep_in_ve must be between 0 and 4"):
        PrettyPrintArgs(sep_in_ve=-1)
    with pytest.raises(TypeError, match="print_candidates must be a boolean"):
        PrettyPrintArgs(print_candidates=1)


def test_pretty_print_args_validate_inner_grid_dimensions_and_parent():
    with pytest.raises(TypeError, match="inner_grid_row"):
        PrettyPrintArgs(inner_grid_row="square")
    with pytest.raises(ValueError, match="inner_grid_col"):
        PrettyPrintArgs(inner_grid_col=-1)
    with pytest.raises(TypeError, match="args must be a PrettyPrintArgs"):
        PrettyPrintArgs(args=object())

    parent = PrettyPrintArgs(inner_grid_row="sqrt", sep_in_ho=4)
    child = PrettyPrintArgs(args=parent, sep_in_ho=1)
    assert child.inner_grid_row == "sqrt"
    assert child.sep_in_ho == 1
'''
if "test_sudoku_box_dimensions_reject_coercive_values" in test_text:
    raise SystemExit("constructor boundary tests already exist")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
