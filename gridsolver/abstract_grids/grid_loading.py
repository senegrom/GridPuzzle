import math
from collections.abc import Iterable
from pathlib import Path

from gridsolver.abstract_grids.grid import (
    Grid,
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
)
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.latins_square import DiagonalLatinSquare, LatinSquare, PandiagonalLatinSquare
from gridsolver.grid_classes.sudoku import Sudoku


type PuzzleClass = type[Grid]

_PUZZLE_CLASSES: dict[str, PuzzleClass] = {
    "sudoku": Sudoku,
    "futoshiki": Futoshiki,
    "killersudoku": KillerSudoku,
    "latinsquare": LatinSquare,
    "diagonallatinsquare": DiagonalLatinSquare,
    "pandiagonallatinsquare": PandiagonalLatinSquare,
    "kenken": Kenken,
}


def create_from_file(
    path: Path | str,
    /,
    row_wise: bool = True,
    space_sep: bool = False,
) -> Grid:
    """Load ``<Class>::<PuzzleString>`` from a UTF-8 text file."""
    row_wise, space_sep = _validate_load_options(row_wise, space_sep)
    path = path if isinstance(path, Path) else Path(path)
    lines = (
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
    )
    payload = "\n".join(line for line in lines if line and not line.startswith("#"))
    return create_from_str(payload, row_wise=row_wise, space_sep=space_sep)


def create_from_str(
    values: str,
    /,
    row_wise: bool = True,
    space_sep: bool = False,
) -> Grid:
    """Load a puzzle encoded as ``<Class>::<PuzzleString>``."""
    row_wise, space_sep = _validate_load_options(row_wise, space_sep)
    if not isinstance(values, str):
        raise TypeError(f"Puzzle input must be str, got {type(values).__name__}")
    class_name, separator, payload = values.partition("::")
    if not separator:
        raise ValueError("Puzzle string contains no :: class separator")
    return create_from_str_and_class(
        payload,
        class_name,
        row_wise=row_wise,
        space_sep=space_sep,
    )


def create_from_str_and_class(
    values: str | Iterable[int] | Iterable[str],
    class_: PuzzleClass | str,
    /,
    row_wise: bool = True,
    space_sep: bool = False,
) -> Grid:
    """Load a puzzle string when its concrete grid class is known separately."""
    row_wise, space_sep = _validate_load_options(row_wise, space_sep)
    if isinstance(values, str):
        normalized: str | list[str] = (
            _load_preprocess_str_space_sep(values)
            if space_sep
            else _load_preprocess_str(values)
        )
    elif isinstance(values, (bytes, bytearray)):
        raise TypeError("Puzzle input bytes must be decoded to str first")
    elif isinstance(values, Iterable):
        normalized = list(values)
    else:
        raise TypeError(f"Puzzle input must be str or iterable, got {type(values).__name__}")

    if isinstance(class_, str):
        key = class_.strip().lower()
        try:
            class_ = _PUZZLE_CLASSES[key]
        except KeyError as exc:
            supported = ", ".join(sorted(_PUZZLE_CLASSES))
            raise ValueError(f"Puzzle class {key!r} is not supported; choose one of {supported}") from exc
    elif not isinstance(class_, type) or not issubclass(class_, Grid):
        raise TypeError("class_ must be a supported Grid subclass or class name")
    elif class_ not in _PUZZLE_CLASSES.values():
        supported = ", ".join(sorted(_PUZZLE_CLASSES))
        raise ValueError(
            f"Puzzle class {class_.__name__!r} is not supported; "
            f"choose one of {supported}"
        )

    try:
        return _create_from_str_and_class(
            normalized,
            class_,
            row_wise=row_wise,
            space_sep=space_sep,
        )
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise ValueError(
            f"Cannot parse puzzle input with class {class_.__name__}: {exc}"
        ) from exc


def _perfect_square_root(length: int, description: str) -> int:
    root = math.isqrt(length)
    if root * root != length:
        raise ValueError(f"Cannot infer {description} from non-square length {length}")
    return root


def _standard_sudoku_box_size(layout_length: int) -> int:
    grid_side = _perfect_square_root(layout_length, "Sudoku side length")
    box_side = math.isqrt(grid_side)
    if box_side * box_side != grid_side:
        raise ValueError(
            f"Cannot infer equal square Sudoku boxes from grid side {grid_side}"
        )
    return box_side


def _layout_length_before_dictionary(values: str | list) -> int:
    try:
        return values.index(":")
    except ValueError as exc:
        raise ValueError("Puzzle string contains no : cage dictionary separator") from exc


def _futoshiki_size(length: int) -> int:
    discriminant = 1 + 3 * length
    root = math.isqrt(discriminant)
    if root * root != discriminant or (1 + root) % 3:
        raise ValueError(
            f"Cannot infer Futoshiki size from length {length}; expected 3n²-2n"
        )
    return (1 + root) // 3


def _create_from_str_and_class(
    values: str | list[int] | list[str],
    class_: PuzzleClass,
    /,
    row_wise: bool,
    space_sep: bool,
) -> Grid:
    if class_ is Sudoku:
        box_side = _standard_sudoku_box_size(len(values))
        grid: Grid = Sudoku(box_side, box_side, box_side, box_side)
    elif class_ is KillerSudoku:
        box_side = _standard_sudoku_box_size(_layout_length_before_dictionary(values))
        grid = KillerSudoku(None, box_side, box_side, box_side, box_side)
    elif class_ is Kenken:
        size = _perfect_square_root(
            _layout_length_before_dictionary(values),
            "KenKen side length",
        )
        grid = Kenken(None, size)
    elif class_ is Futoshiki:
        grid = Futoshiki(_futoshiki_size(len(values)))
    elif class_ in {LatinSquare, DiagonalLatinSquare, PandiagonalLatinSquare}:
        grid = class_(_perfect_square_root(len(values), "Latin-square side length"))
    else:
        raise ValueError(f"Puzzle class {class_.__name__} is not supported")

    grid.load(values, row_wise=row_wise, space_sep=space_sep)
    return grid
