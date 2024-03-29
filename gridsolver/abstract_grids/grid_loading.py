import math
from pathlib import Path
from typing import Union, Iterable

from gridsolver.abstract_grids.grid import Grid, _load_preprocess_str_space_sep, _load_preprocess_str
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.latins_square import LatinSquare, DiagonalLatinSquare
from gridsolver.grid_classes.sudoku import Sudoku


def create_from_file(path: Union[Path, str], /, row_wise=True, space_sep=False) -> Grid:
    """Specify the puzzle file with the file as <Class>::<PuzzleString> where PuzzleString is a standard format string of the puzzle.
    Example: "Sudoku::12344321........"
    Whitespace and lines starting with # will be ignored; . converted to 0"""
    if not isinstance(path, Path):
        path = Path(path)
    read_lines = path.read_text().splitlines(keepends=False)
    lines = (line.strip() for line in read_lines)
    lines = [line for line in lines if line and not line.startswith("#")]

    return create_from_str("\n".join(lines), row_wise=row_wise, space_sep=space_sep)


def create_from_str(values: str, /, row_wise=True, space_sep=False) -> Grid:
    """Specify the puzzle as <Class>::<PuzzleString> where PuzzleString is a standard format string of the puzzle.
    Example: "Sudoku::12344321........"
    Whitespace will be ignored; . converted to 0
    If space_sep is True, whitespace will be treated as seperators"""

    values = str(values)
    if "::" not in values:
        raise ValueError("Puzzle string contains no :: class separator.")
    try:
        class_, values2 = values.split("::")
        return create_from_str_and_class(values2, class_, row_wise=row_wise, space_sep=space_sep)
    except Exception as e:
        raise ValueError(f"Cannot parse puzzle string \"{values}\". Error: {e}", )


def create_from_str_and_class(values: str, class_: Union[type, str], /,
                              row_wise=True, space_sep=False) -> Grid:
    """Specify the puzzle as standard format string and the class name seperately"""
    values = str(values)

    if space_sep:
        values = _load_preprocess_str_space_sep(values)
    else:
        values = _load_preprocess_str(values)
    if isinstance(class_, str):
        class_ = class_.strip().lower()
        if class_ == "sudoku":
            class_ = Sudoku
        elif class_ == "futoshiki":
            class_ = Futoshiki
        elif class_ == "killersudoku":
            class_ = KillerSudoku
        elif class_ == "latinsquare":
            class_ = LatinSquare
        elif class_ == "diagonallatinsquare":
            class_ = DiagonalLatinSquare
        else:
            raise ValueError(f"Puzzle class {class_} not supported.")
    assert isinstance(class_, type), "not isinstance(class_, type)"

    try:
        return _create_from_str_and_class(values, class_, row_wise=row_wise, space_sep=space_sep)
    except Exception as e:
        raise ValueError(f"Cannot parse puzzle string \"{values}\" with class {class_}. Error: {e}", )


def _create_from_str_and_class(values: Union[str, Iterable[int], Iterable[str]], class_: type, /,
                               row_wise, space_sep) -> Grid:
    g = None

    if class_ is Sudoku:
        size = len(values) ** 0.25
        if size != int(size):
            raise ValueError(f"Cannot infer size ({size}) from non biquadratic length {len(values)}.")
        size = int(size)
        g = Sudoku(size, size, size, size)
    elif class_ is KillerSudoku:
        length = 0
        while length < len(values) and values[length] != ":":
            length += 1
        size = length ** 0.25
        if size != int(size):
            raise ValueError(f"Cannot infer size ({size}) from non biquadratic length {len(values)}.")
        size = int(size)
        g = KillerSudoku(None, size, size, size, size)
    elif class_ is Futoshiki:
        size = (1 + math.sqrt(1 + 3 * len(values))) / 3
        if size != int(size):
            raise ValueError(f"Cannot infer size ({size}) from length {len(values)} not satisfying x=3n^2-2n.")
        size = int(size)
        g = Futoshiki(size)
    elif class_ in {LatinSquare, DiagonalLatinSquare}:
        size = len(values) ** 0.5
        if size != int(size):
            raise ValueError(f"Cannot infer size ({size}) from non quadratic length {len(values)}.")
        size = int(size)
        g = class_(size)

    if g is None:
        raise ValueError(f"Puzzle class {class_} not supported.")

    g.load(values, row_wise=row_wise, space_sep=space_sep)
    return g
