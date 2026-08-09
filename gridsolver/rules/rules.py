import numbers
import zlib
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, MutableSequence, Sequence
from functools import cache
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

    # Equality remains type-strict; unequal types may legally share a hash.
    __hash__ = tuple.__hash__

    def __eq__(self, other: object) -> bool:
        return type(other) is Guarantee and tuple.__eq__(self, other)

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)


@cache
def _stable_rule_type_tag(rule_type: type["Rule"]) -> int:
    """Return a deterministic integer tag for a concrete rule class."""
    identity = (
        f"{rule_type.__module__}\0{rule_type.__qualname__}"
    ).encode("utf-8")
    return zlib.crc32(identity)


type TApplyResult = tuple[
    bool,
    Iterable["Rule"] | None,
    Iterable[Guarantee] | None,
]


class Rule(ABC):
    __slots__ = (
        "cells",
        "_rows",
        "_cols",
        "_max_elem",
        "len_cells",
        "_frozen",
        "_base_hash_cache",
    )

    # False lets the solver skip per-rule guarantee-list construction. Every
    # subclass whose apply() body reads guarantees must set this to True.
    uses_guarantees = False

    def __setattr__(self, name: str, value: object) -> None:
        if getattr(self, "_frozen", False) and hasattr(self, name):
            raise AttributeError(
                f"{type(self).__name__} is immutable after hashing or registration"
            )
        object.__setattr__(self, name, value)

    def freeze(self) -> "Rule":
        object.__setattr__(self, "_frozen", True)
        return self

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator: TCellCreator | None = None,
        *,
        _clip_outside_after_first: bool = False,
    ) -> None:
        object.__setattr__(self, "_frozen", False)
        object.__setattr__(self, "_base_hash_cache", None)
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
            for position, raw_cell in enumerate(raw_cells):
                if isinstance(raw_cell, bool) or not isinstance(raw_cell, numbers.Integral):
                    raise TypeError("Rule cells must not mix integer and coordinate forms")
                cell = int(raw_cell)
                if not 0 <= cell < cell_count:
                    if _clip_outside_after_first and position > 0:
                        continue
                    raise ValueError(
                        f"{type(self).__name__} cell {cell} is outside "
                        f"0..{cell_count - 1}"
                    )
                normalized.append(cell)
        else:
            for position, coordinate in enumerate(raw_cells):
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
                if not (0 <= row < self._rows and 0 <= col < self._cols):
                    if _clip_outside_after_first and position > 0:
                        continue
                    raise ValueError(
                        f"{type(self).__name__} coordinate {(row, col)!r} is outside "
                        f"a {self._rows}x{self._cols} grid"
                    )
                normalized.append(row + col * self._rows)

        if len(normalized) != len(set(normalized)):
            raise ValueError(f"{type(self).__name__} cells must be unique")

        self.cells: tuple[int, ...] = tuple(normalized)
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
        cached = getattr(self, "_base_hash_cache", None)
        if cached is not None and getattr(self, "_frozen", False):
            return cached

        self.freeze()
        # The cache survives pickle round trips. Avoid type/string hashes,
        # which are process-local, by reducing the class identity to a
        # deterministic integer and hashing only integers/tuples of integers.
        cached = hash(
            (
                _stable_rule_type_tag(type(self)),
                self.cells,
                self._rows,
                self._cols,
                self._max_elem,
                self.len_cells,
            )
        )
        object.__setattr__(self, "_base_hash_cache", cached)
        return cached

    def __ne__(self, other: object) -> bool:
        return not self == other

    def invalidate_current_cells_and_raise_invalid_grid(
        self,
        candidates: tuple[set[int], ...],
    ) -> None:
        for cell in self.cells:
            candidates[cell].clear()
        raise InvalidGrid()
