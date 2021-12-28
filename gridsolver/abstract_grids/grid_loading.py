from pathlib import Path
from typing import Union

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import Sudoku


def create_from_file(path: Union[Path, str], /, row_wise=True) -> Grid:
    """Specify the puzzle file with the file as <Class>::<PuzzleString> where PuzzleString is a standard format string of the puzzle.
    Example: "Sudoku::12344321........"
    Whitespace and lines starting with # will be ignored; . converted to 0"""
    if not isinstance(path, Path):
        path = Path(path)
    lines = []
    with path.open("rt") as f:
        while line := f.readline():
            line = line.strip()
            if line.startswith("#"):
                continue

            # noinspection PyProtectedMember
            line = Grid._load_preprocess_str(line)
            lines.append(line)

    return create_from_str("".join(lines), row_wise=row_wise)


def create_from_str(values: str, /, row_wise=True) -> Grid:
    """Specify the puzzle as <Class>::<PuzzleString> where PuzzleString is a standard format string of the puzzle.
    Example: "Sudoku::12344321........"
    Whitespace will be ignored; . converted to 0"""

    values = str(values)
    # noinspection PyProtectedMember
    values = Grid._load_preprocess_str(values)
    try:
        class_, values2 = values.split("::")
        return create_from_str_and_class(values2, class_, row_wise=row_wise)
    except Exception as e:
        raise ValueError(f"Cannot parse puzzle string \"{values}\". Error: {e}", )


def create_from_str_and_class(values: str, class_: Union[type, str], /, row_wise=True) -> Grid:
    """Specify the puzzle as standard format string and the class name seperately"""
    values = str(values)
    # noinspection PyProtectedMember
    values = Grid._load_preprocess_str(values)
    if isinstance(class_, str):
        if class_.strip().lower() == "sudoku":
            class_ = Sudoku
        elif class_.strip().lower() == "futoshiki":
            class_ = Futoshiki
        elif class_.strip().lower() == "killersudoku":
            class_ = KillerSudoku
        else:
            raise ValueError(f"Puzzle class {class_} not supported.")
    assert isinstance(class_, type), "not isinstance(class_, type)"
    return _create_from_str_and_class(values, class_, row_wise=row_wise)


def _create_from_str_and_class(values: str, class_: type, /, row_wise=True) -> Grid:
    g = None

    # noinspection PyProtectedMember
    if class_ is Sudoku:
        size = len(values) ** 0.25
        if size != int(size):
            raise ValueError(f"Cannot infer size from non biquadratic length {len(values)}.")
        size = int(size)
        g = Sudoku(size, size, size, size)
    elif class_ is KillerSudoku:
        size = len(values) ** 0.25
        if size != int(size):
            raise ValueError(f"Cannot infer size from non biquadratic length {len(values)}.")
        size = int(size)
        g = KillerSudoku(None, size, size, size, size)
    elif class_ is Futoshiki:
        size = len(values) ** 0.5
        if size != int(size):
            raise ValueError(f"Cannot infer size from non quadratic length {len(values)}.")
        size = int(size)
        g = Futoshiki(size)

    if g is None:
        raise ValueError(f"Puzzle class {class_} not supported.")

    g.load(values, row_wise=row_wise)
    return g
