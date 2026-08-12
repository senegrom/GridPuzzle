"""Compact variable grids backed by arbitrary puzzle-domain keys."""

from collections.abc import Hashable, Iterable, Mapping, Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid, TechniqueProfile


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
    """Store only real puzzle variables while retaining their domain keys.

    Board puzzles with blocked cells and edge puzzles do not naturally map to a
    dense rectangular value grid.  CompactGrid keeps the solver-facing cells in
    one row and supplies a stable key <-> cell mapping for rendering and APIs.
    The specialised puzzle rules provide the primary propagation. Generic
    all-different, tuple, forcing, and trial deductions remain available,
    while geometry-specific Sudoku patterns are excluded.
    """

    technique_profile = TechniqueProfile.GENERIC

    def __init__(self, keys: Iterable[Hashable], max_elem: int) -> None:
        cell_to_key = tuple(keys)
        if not cell_to_key:
            raise ValueError("A compact grid requires at least one variable")
        try:
            unique_keys = set(cell_to_key)
        except TypeError as exc:
            raise TypeError("Compact-grid keys must be hashable") from exc
        if len(cell_to_key) != len(unique_keys):
            raise ValueError("Compact-grid keys must be unique")

        super().__init__(1, len(cell_to_key), max_elem=max_elem)
        self.cell_to_key: tuple[Hashable, ...] = cell_to_key
        self.key_to_cell: dict[Hashable, int] = {
            key: cell for cell, key in enumerate(cell_to_key)
        }

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.cell_to_key = self.cell_to_key
        result.key_to_cell = self.key_to_cell.copy()

    def compact_cell(self, key: Hashable) -> int:
        try:
            return self.key_to_cell[key]
        except TypeError as exc:
            raise TypeError("Puzzle keys must be hashable") from exc
        except KeyError as exc:
            raise KeyError(f"Unknown puzzle key {key!r}") from exc

    def _get_index_from_key(self, key):
        """Resolve integral indexes as compact cells and everything else as keys.

        The inherited (row, col) tuple math would silently alias the board
        coordinates most compact families use as keys: on this 1xN layout
        an internal (0, col) tuple and a board key (0, col) are different
        cells. Integral indexes keep their compact-cell meaning; any other
        index must be a known puzzle key.
        """
        if isinstance(key, bool):
            raise TypeError("Boolean grid indexes are not supported")
        if isinstance(key, Integral):
            return int(key)
        if isinstance(key, slice):
            return key
        return self.compact_cell(key)

    def key_for_cell(self, cell: int) -> Hashable:
        if isinstance(cell, bool) or not isinstance(cell, Integral):
            raise TypeError("Compact cell must be an integer")
        cell = int(cell)
        if not 0 <= cell < self.len:
            raise IndexError(f"Compact cell {cell} is outside 0..{self.len - 1}")
        return self.cell_to_key[cell]

    def values_by_key(self, values: Sequence[int]) -> dict[Hashable, int]:
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

    def load_key_values(self, values: Mapping[Hashable, int]) -> None:
        """Load keyed givens atomically through the normal Grid loader."""
        if not isinstance(values, Mapping):
            raise TypeError("values must be a mapping from puzzle keys to integers")
        compact = [0] * self.len
        for key, raw_value in values.items():
            cell = self.compact_cell(key)
            if isinstance(raw_value, bool) or not isinstance(raw_value, Integral):
                raise TypeError(f"Value for {key!r} must be an integer")
            value = int(raw_value)
            if not 0 <= value <= self.max_elem:
                raise ValueError(
                    f"Value {value} for {key!r} is outside 0..{self.max_elem}"
                )
            compact[cell] = value
        self.load(compact, row_wise=False)

    def format_solution(self, values: Sequence[int]) -> str:
        """Subclasses render their geometry; this fallback exposes key/value rows."""
        keyed = self.values_by_key(values)
        return "\n".join(f"{key!r}: {value}" for key, value in keyed.items())
