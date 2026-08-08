import numbers
from abc import ABC, abstractmethod
from array import ArrayType, array
from collections.abc import Callable, Iterable, MutableSequence, Sequence
from typing import NamedTuple

from gridsolver import util
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer


type IdxType = int | tuple[int, int]
type IdxTypeSlice = int | tuple[int, int] | slice
type TCellCreator = Callable[["Rule"], Iterable[IdxType]]


class InvalidGrid(Exception):
    pass


class RuleAlwaysSatisfied(Exception):
    pass


def _format_coord(index: int, rows: int) -> str:
    return f"({index % rows},{index // rows})"


class Guarantee(NamedTuple):
    val: int
    cells: frozenset[int]
    rows: int
    cols: int

    def __hash__(self) -> int:
        return hash((type(self), hash(self.cells), self.val, self.rows, self.cols))

    def __eq__(self, other: object) -> bool:
        # The hash mixes in the type, so equality must be type-strict as well.
        return type(other) is Guarantee and tuple.__eq__(self, other)

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)


type TApplyResult = tuple[
    bool,
    Iterable["Rule"] | None,
    Iterable[Guarantee] | None,
]


class Rule(ABC):
    __slots__ = ("cells", "_rows", "_cols", "_max_elem", "len_cells")

    # False lets the solver skip per-rule guarantee-list construction. Every
    # subclass whose apply() body reads guarantees must set this to True.
    uses_guarantees = False

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator: TCellCreator | None = None,
    ) -> None:
        self._rows = gsz.rows
        self._cols = gsz.cols
        self._max_elem = gsz.max_elem

        if cells is not None:
            source = cells
            sort_cells = False
        elif cell_creator is not None:
            source = cell_creator(self)
            sort_cells = True
        else:
            raise ValueError("A rule requires cells or a cell_creator")

        try:
            first, replay = util.peek(source)
        except ValueError as exc:
            raise ValueError(f"{type(self).__name__} cells must not be empty") from exc

        raw_cells = list(replay)
        if sort_cells:
            raw_cells.sort()

        cell_count = self._rows * self._cols
        normalized: list[int] = []
        if isinstance(first, numbers.Integral) and not isinstance(first, bool):
            for cell in raw_cells:
                if isinstance(cell, bool) or not isinstance(cell, numbers.Integral):
                    raise TypeError("Rule cells must not mix integer and coordinate forms")
                cell = int(cell)
                if 0 <= cell < cell_count:
                    normalized.append(cell)
        else:
            for coordinate in raw_cells:
                if (
                    isinstance(coordinate, (str, bytes, bytearray))
                    or not isinstance(coordinate, Sequence)
                    or len(coordinate) != 2
                    or any(
                        isinstance(value, bool) or not isinstance(value, numbers.Integral)
                        for value in coordinate
                    )
                ):
                    raise TypeError(f"Invalid rule coordinate {coordinate!r}")
                row, col = map(int, coordinate)
                if 0 <= row < self._rows and 0 <= col < self._cols:
                    normalized.append(row + col * self._rows)

        if not normalized:
            raise ValueError(f"{type(self).__name__} has no cells inside the grid")
        if len(normalized) != len(set(normalized)):
            raise ValueError(f"{type(self).__name__} cells must be unique")

        self.cells: ArrayType = array("I", normalized)
        self.len_cells = len(self.cells)

    def cells_as_row_or_column(self, idx: int, row_wise: bool) -> Iterable[IdxType]:
        if row_wise:
            return (idx + col * self._rows for col in range(self._cols))
        return (idx * self._rows + row for row in range(self._rows))

    @abstractmethod
    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> TApplyResult:
        raise NotImplementedError

    def __repr__(self) -> str:
        cell_str = ", ".join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{cell_str}]"

    def __eq__(self, other: object) -> bool:
        if type(other) is not type(self):
            return False
        return (
            len(self.cells) == len(other.cells)
            and self._rows == other._rows
            and self._cols == other._cols
            and self._max_elem == other._max_elem
            and self.cells == other.cells
        )

    def __hash__(self) -> int:
        return hash(
            (
                type(self),
                bytes(self.cells),
                self._rows,
                self._cols,
                self._max_elem,
                self.len_cells,
            )
        )

    def __ne__(self, other: object) -> bool:
        return not self == other

    def invalidate_current_cells_and_raise_invalid_grid(
        self,
        candidates: tuple[set[int], ...],
    ) -> None:
        for cell in self.cells:
            candidates[cell].clear()
        raise InvalidGrid()
