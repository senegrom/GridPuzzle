from array import ArrayType, array
from numbers import Integral
from typing import Sequence, Optional, Union, overload, Tuple, Iterator

import gridsolver.abstract_grids.gridsize_container
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print
from gridsolver.rules.rules import IdxTypeSlice


class ImmutableGrid(gridsolver.abstract_grids.gridsize_container.GridSizeContainer, Sequence[int]):
    def __init__(self, known: Sequence[int], rows: int, cols: Optional[int] = None,
                 max_elem: Optional[int] = None, name: Optional[str] = None):
        gridsolver.abstract_grids.gridsize_container.GridSizeContainer.__init__(self, rows, cols, max_elem)
        self._known: ArrayType = array('i', known)
        self.__hash: int = hash((bytes(self._known)))
        self.format_args = PrettyPrintArgs()
        self.name = name

    def __eq__(self, other: 'ImmutableGrid') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self._known == other._known

    def __ne__(self, other: 'ImmutableGrid') -> bool:
        return not self == other

    def __hash__(self):
        return self.__hash

    @property
    def known(self) -> ArrayType:
        return self._known

    def _get_index_from_key(self, key: IdxTypeSlice) -> Union[int, slice]:
        if isinstance(key, int):
            return key
        if isinstance(key, Integral):
            return int(key)
        if isinstance(key, slice):
            return key
        if not isinstance(key, Sequence):
            raise TypeError(f"Index {key!r} must be integral or integral tuple.")
        if len(key) == 1 and isinstance(key[0], Integral):
            return key[0]
        if len(key) == 2 and isinstance(key[0], Integral) and isinstance(key[1], Integral):
            return key[0] + key[1] * self.rows
        raise TypeError(f"Index {key!r} must be integral or integral tuple of length 1 or 2.")

    @overload
    def __getitem__(self, i: int) -> int:
        ...

    @overload
    def __getitem__(self, i: slice) -> int:
        ...

    @overload
    def __getitem__(self, i: Tuple[int, int]) -> int:
        ...

    @overload
    def __getitem__(self, i: IdxTypeSlice) -> int:
        ...

    def __getitem__(self, key: IdxTypeSlice) -> int:
        return self._known[self._get_index_from_key(key)]

    def __iter__(self) -> Iterator[int]:
        return iter(self._known)

    def _str_header(self, detailed=False):
        s = f"{self.name or self.__class__.__name__}({self.rows},{self.cols})"
        return s

    def __str__(self) -> str:
        return self.to_str(PrettyPrintArgs(print_candidates=False, args=self.format_args))

    def __repr__(self) -> str:
        return self.to_str(PrettyPrintArgs(print_candidates=False, args=self.format_args))

    def to_str(self, args: PrettyPrintArgs = None) -> str:
        candidates = None
        if hasattr(self, "_candidates"):
            candidates = self._candidates

        return self._str_header(args.detail_rule) + "\n" + pretty_print(self.rows, self.cols, self.max_elem,
                                                                        self._known, candidates, args)
