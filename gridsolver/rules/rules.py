import numbers
import reprlib
from abc import abstractmethod, ABC
from array import array, ArrayType
from typing import Tuple, Set, Sequence, Iterable, MutableSequence, Union, Callable, NamedTuple, Optional

import gridsolver.abstract_grids.gridsize_container
from gridsolver import util

IdxType = Union[int, Tuple[int, int]]
IdxTypeSlice = Union[int, Tuple[int, int], slice]
CellCreatorType = Callable[['Rule'], Iterable[IdxType]]


class InvalidGrid(Exception):
    pass


class RuleAlwaysSatisfied(Exception):
    pass


class Guarantee(NamedTuple):
    val: int
    cells: ArrayType

    def __hash__(self):
        return hash((type(self), bytes(self.cells), self.val))


class Rule(ABC):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', '_lcells')

    def __init__(self, gsz: gridsolver.abstract_grids.gridsize_container.GridSizeContainer,
                 cells: Optional[Iterable[IdxType]] = None,
                 cell_creator: Optional[CellCreatorType] = None):

        self.cells: ArrayType
        self._rows: int = gsz.rows
        self._cols: int = gsz.cols
        self._max_elem: int = gsz.max_elem
        if cells is not None:
            first, cells = util.peek(cells)
        else:
            first, cells = util.peek(cell_creator(self))

        rc = self._rows * self._cols
        if not isinstance(first, numbers.Integral):
            cells = (keyx + keyy * gsz.rows for keyx, keyy in cells if
                     0 <= keyx < self._rows and 0 <= keyy < self._cols)
        self.cells = array('i', (cell for cell in cells if 0 <= cell < rc))
        self.len_cells: int = len(self.cells)

    def cells_as_row_or_column(self, idx: int, row_wise: bool) -> Iterable[IdxType]:
        if row_wise:
            return (idx + col * self._rows for col in range(self._cols))
        else:
            return (idx * self._rows + row for row in range(self._cols))

    @abstractmethod
    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None) -> \
            Tuple[
                bool, Optional[Iterable['Rule']], Optional[Iterable[Guarantee]]]:
        pass

    def __repr__(self):
        cell_str = reprlib.repr(self.cells)
        return f"{type(self).__name__}[{cell_str.partition('[')[2][:-1]}"

    def __eq__(self, other: 'Rule') -> bool:
        if type(other) != type(self) or len(self.cells) != len(other.cells):
            return False
        return self._rows == other._rows and self._cols == other._cols and \
               self._max_elem == other._max_elem and self.cells == other.cells

    def __le__(self, other: 'Rule') -> bool:
        if not isinstance(other, Rule):
            return False
        # todo

    def __hash__(self):
        return hash((type(self), bytes(self.cells), self._rows, self._cols, self._max_elem, self.len_cells))

    def __ne__(self, other: 'Rule') -> bool:
        return not self == other
