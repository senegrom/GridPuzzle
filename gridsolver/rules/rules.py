import numbers
from abc import abstractmethod, ABC
from array import array, ArrayType
from typing import Tuple, Set, Iterable, MutableSequence, Union, Callable, NamedTuple, Optional, FrozenSet, List

from gridsolver import util
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer

IdxType = Union[int, Tuple[int, int]]
IdxTypeSlice = Union[int, Tuple[int, int], slice]
TCellCreator = Callable[['Rule'], Iterable[IdxType]]


class InvalidGrid(Exception):
    pass


class RuleAlwaysSatisfied(Exception):
    pass


def _format_coord(i: int, rows: int):
    return f"({i % rows},{i // rows})"


class Guarantee(NamedTuple):
    val: int
    cells: FrozenSet
    rows: int
    cols: int

    def __hash__(self):
        return hash((type(self), hash(self.cells), self.val, self.rows, self.cols))

TApplyResult = Tuple[bool, Optional[Iterable['Rule']], Optional[Iterable[Guarantee]]]


class Rule(ABC):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells')

    def __init__(self, gsz: GridSizeContainer,
                 cells: Optional[Iterable[IdxType]] = None,
                 cell_creator: Optional[TCellCreator] = None):

        self.cells: ArrayType
        self._rows: int = gsz.rows
        self._cols: int = gsz.cols
        self._max_elem: int = gsz.max_elem
        if cells is not None:
            first, cells = util.peek(cells)
        else:
            first, cells = util.peek(cell_creator(self))
            cells = sorted(list(cells))

        rc = self._rows * self._cols
        if not isinstance(first, numbers.Integral):
            cells = (keyx + keyy * gsz.rows for keyx, keyy in cells if
                     0 <= keyx < self._rows and 0 <= keyy < self._cols)
        self.cells = array('I', (cell for cell in cells if 0 <= cell < rc))
        self.len_cells: int = len(self.cells)

    def cells_as_row_or_column(self, idx: int, row_wise: bool) -> Iterable[IdxType]:
        if row_wise:
            return (idx + col * self._rows for col in range(self._cols))
        else:
            return (idx * self._rows + row for row in range(self._cols))

    @abstractmethod
    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            TApplyResult:
        pass

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{cell_str}]"

    def __eq__(self, other: 'Rule') -> bool:
        if type(other) != type(self) or len(self.cells) != len(other.cells):
            return False
        return self._rows == other._rows and self._cols == other._cols and \
               self._max_elem == other._max_elem and self.cells == other.cells

    def __hash__(self):
        return hash((type(self), bytes(self.cells), self._rows, self._cols, self._max_elem, self.len_cells))

    def __ne__(self, other: 'Rule') -> bool:
        return not self == other
