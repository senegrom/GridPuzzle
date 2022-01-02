from array import ArrayType, array
from numbers import Integral
from typing import Sequence, Optional, Union, overload, Tuple, Iterator, Collection

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print
from gridsolver.abstract_grids.rule_container import RuleContainer
from gridsolver.rules.rules import IdxTypeSlice, Rule
from gridsolver.rules.uneq import IneqRule


class ImmutableGrid(GridSizeContainer, Sequence[int]):
    format_args = PrettyPrintArgs()

    def __init__(self, known: Sequence[int], rows: int, cols: Optional[int] = None,
                 max_elem: Optional[int] = None, name: Optional[str] = None):
        GridSizeContainer.__init__(self, rows, cols, max_elem)
        self._known: ArrayType = array('I', known)
        self.__hash: int = hash((bytes(self._known)))
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

    def to_str(self, args: PrettyPrintArgs = None, rules: Collection[Rule] = None) -> str:
        candidates = tuple()
        ineqs = set()

        if hasattr(self, "_candidates"):
            candidates = self._candidates
        if args.sep_in_ve == 4 or args.sep_in_ho == 4:
            assert isinstance(self, RuleContainer) or rules, "Need rules to display inequalities"
            if not rules:
                rules = self.rules
            ineqs = {(rule.lt_cell, rule.gt_cell) for rule in rules if isinstance(rule, IneqRule)}

        return self._str_header(False) + "\n" + \
               pretty_print(self.rows, self.cols, self.max_elem, self._known, candidates=candidates,
                            args=args, ineqs=ineqs)
