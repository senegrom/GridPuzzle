"""Apply compact-grid and standard file-loader boundary hardening."""

from pathlib import Path


COMPACT = Path("gridsolver/grid_classes/compact_grid.py")
PATHS = Path("gridsolver/grid_classes/path_puzzles.py")
SLITHER = Path("gridsolver/grid_classes/slitherlink.py")
LOADING = Path("gridsolver/abstract_grids/grid_loading.py")
CI = Path(".github/workflows/ci.yml")
TEST = Path("tests/test_compact_api_hardening.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    COMPACT,
    "from numbers import Integral\nfrom typing import Any\n\n",
    "from numbers import Integral\n\n",
    "unused Any import",
)
replace_once(
    COMPACT,
    "from gridsolver.abstract_grids.grid import Grid, TechniqueProfile\n\n\nclass CompactGrid(Grid):\n",
    '''from gridsolver.abstract_grids.grid import Grid, TechniqueProfile


def _rectangular_rows(
    raw_rows: Iterable[Iterable[object]],
    description: str,
) -> tuple[tuple[object, ...], ...]:
    """Materialise a non-empty rectangular matrix without treating text as rows."""
    if isinstance(raw_rows, (str, bytes, bytearray)):
        raise TypeError(f"{description} must be a sequence of rows")
    try:
        iterator = iter(raw_rows)
    except TypeError as exc:
        raise TypeError(f"{description} must be a sequence of rows") from exc

    rows: list[tuple[object, ...]] = []
    for row_index, raw_row in enumerate(iterator):
        if isinstance(raw_row, (str, bytes, bytearray)):
            raise TypeError(f"{description} row {row_index} must not be text")
        try:
            row = tuple(raw_row)
        except TypeError as exc:
            raise TypeError(
                f"{description} row {row_index} must be a sequence"
            ) from exc
        rows.append(row)

    if not rows or not rows[0]:
        raise ValueError(f"{description} must not be empty")
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise ValueError(f"{description} rows must all have the same length")
    return tuple(rows)


class CompactGrid(Grid):
''',
    "shared rectangular parser",
)
replace_once(
    COMPACT,
    '''        if not cell_to_key:
            raise ValueError("A compact grid requires at least one variable")
        if len(cell_to_key) != len(set(cell_to_key)):
            raise ValueError("Compact-grid keys must be unique")
''',
    '''        if not cell_to_key:
            raise ValueError("A compact grid requires at least one variable")
        try:
            unique_keys = set(cell_to_key)
        except TypeError as exc:
            raise TypeError("Compact-grid keys must be hashable") from exc
        if len(cell_to_key) != len(unique_keys):
            raise ValueError("Compact-grid keys must be unique")
''',
    "hashable compact keys",
)
replace_once(
    COMPACT,
    '''    def compact_cell(self, key: Hashable) -> int:
        try:
            return self.key_to_cell[key]
        except KeyError as exc:
            raise KeyError(f"Unknown puzzle key {key!r}") from exc
''',
    '''    def compact_cell(self, key: Hashable) -> int:
        try:
            return self.key_to_cell[key]
        except TypeError as exc:
            raise TypeError("Puzzle keys must be hashable") from exc
        except KeyError as exc:
            raise KeyError(f"Unknown puzzle key {key!r}") from exc
''',
    "compact lookup error",
)
replace_once(
    COMPACT,
    '''    def values_by_key(self, values: Sequence[int]) -> dict[Hashable, int]:
        if len(values) != self.len:
            raise ValueError(f"Expected {self.len} values, got {len(values)}")
        return dict(zip(self.cell_to_key, values))
''',
    '''    def values_by_key(self, values: Sequence[int]) -> dict[Hashable, int]:
        if isinstance(values, (str, bytes, bytearray)):
            raise TypeError("Compact-grid values must be an integer sequence")
        try:
            value_count = len(values)
        except TypeError as exc:
            raise TypeError(
                "Compact-grid values must be an integer sequence"
            ) from exc
        if value_count != self.len:
            raise ValueError(f"Expected {self.len} values, got {value_count}")

        normalized: list[int] = []
        for cell, raw_value in enumerate(values):
            if isinstance(raw_value, bool) or not isinstance(raw_value, Integral):
                raise TypeError(f"Value for compact cell {cell} must be an integer")
            value = int(raw_value)
            if not 0 <= value <= self.max_elem:
                raise ValueError(
                    f"Value {value} for compact cell {cell} is outside "
                    f"0..{self.max_elem}"
                )
            normalized.append(value)
        return dict(zip(self.cell_to_key, normalized, strict=True))
''',
    "compact value validation",
)

replace_once(
    PATHS,
    "from gridsolver.grid_classes.compact_grid import CompactGrid\n",
    "from gridsolver.grid_classes.compact_grid import CompactGrid, _rectangular_rows\n",
    "path rectangular helper import",
)
replace_once(
    PATHS,
    '''        if isinstance(board, (str, bytes, bytearray)):
            raise TypeError("Path board must be a sequence of rows")
        try:
            rows = tuple(tuple(row) for row in board)
        except TypeError as exc:
            raise TypeError("Path board must be a sequence of rows") from exc
        if not rows or not rows[0]:
            raise ValueError("Path board must not be empty")
        width = len(rows[0])
        if any(len(row) != width for row in rows):
            raise ValueError("Path board rows must all have the same length")
''',
    '''        rows = _rectangular_rows(board, "Path board")
        width = len(rows[0])
''',
    "path rectangular parsing",
)

replace_once(
    SLITHER,
    "from gridsolver.grid_classes.compact_grid import CompactGrid\n",
    "from gridsolver.grid_classes.compact_grid import CompactGrid, _rectangular_rows\n",
    "slither rectangular helper import",
)
replace_once(
    SLITHER,
    '''        if isinstance(clues, (str, bytes, bytearray)):
            raise TypeError("Slitherlink clues must be a sequence of rows")
        try:
            rows = tuple(tuple(row) for row in clues)
        except TypeError as exc:
            raise TypeError(
                "Slitherlink clues must be a sequence of rows"
            ) from exc
        if not rows or not rows[0]:
            raise ValueError("Slitherlink clue grid must not be empty")
        board_cols = len(rows[0])
        if any(len(row) != board_cols for row in rows):
            raise ValueError("Slitherlink clue rows must have equal length")
''',
    '''        rows = _rectangular_rows(clues, "Slitherlink clue grid")
        board_cols = len(rows[0])
''',
    "slither rectangular parsing",
)

replace_once(
    LOADING,
    "        key = class_.strip().lower()\n",
    "        key = class_.strip().lstrip(\"\\ufeff\").strip().lower()\n",
    "class-name BOM handling",
)
replace_once(
    LOADING,
    '        if line and not line.startswith("#")\n',
    '        if line and not line.startswith(("#", ";"))\n',
    "semicolon comments",
)

ci_text = CI.read_text(encoding="utf-8")
marker = "          tests/test_candidate_mask_index.py\n"
if ci_text.count(marker) != 2:
    raise SystemExit(
        f"CI candidate-mask marker: expected two, found {ci_text.count(marker)}"
    )
ci_text = ci_text.replace(
    marker,
    marker
    + "          tests/test_candidate_domain.py\n"
    + "          tests/test_compact_api_hardening.py\n",
)
CI.write_text(ci_text, encoding="utf-8")

TEST.write_text(
    '''import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.grid_classes.path_puzzles import Hidato
from gridsolver.grid_classes.slitherlink import Slitherlink


def test_compact_grid_rejects_unhashable_keys_and_lookups():
    with pytest.raises(TypeError, match="keys must be hashable"):
        CompactGrid(([0],), max_elem=1)

    grid = CompactGrid(((0, 0),), max_elem=1)
    with pytest.raises(TypeError, match="keys must be hashable"):
        grid.compact_cell([0, 0])


def test_values_by_key_validates_types_and_domain():
    grid = CompactGrid(("a", "b"), max_elem=2)

    assert grid.values_by_key((0, 2)) == {"a": 0, "b": 2}
    with pytest.raises(TypeError, match="integer sequence"):
        grid.values_by_key("12")
    with pytest.raises(TypeError, match="compact cell 1"):
        grid.values_by_key((1, True))
    with pytest.raises(ValueError, match=r"outside 0\\.\\.2"):
        grid.values_by_key((1, 3))


@pytest.mark.parametrize(
    "factory, rows, message",
    (
        (Hidato.from_board, ("12", "34"), "Path board row 0 must not be text"),
        (Slitherlink, ("12", "34"), "Slitherlink clue grid row 0 must not be text"),
    ),
)
def test_rectangular_puzzle_rows_reject_ambiguous_text_rows(
    factory, rows, message
):
    with pytest.raises(TypeError, match=message):
        factory(rows)


def test_standard_file_loader_accepts_bom_and_semicolon_comments(tmp_path):
    puzzle = tmp_path / "latin.pzl"
    puzzle.write_text(
        "; retained source comment\\n"
        "\\ufeffLatinSquare::\\n"
        ". .\\n"
        ". .\\n",
        encoding="utf-8",
    )

    grid = create_from_file(puzzle, space_sep=True)

    assert grid.rows == grid.cols == 2
''',
    encoding="utf-8",
)
