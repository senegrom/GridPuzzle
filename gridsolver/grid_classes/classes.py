import copy
import itertools
from array import ArrayType, array
from enum import Enum
from functools import partial
from numbers import Integral
from typing import Tuple, Set, Sequence, Iterable, MutableSequence, Union, Callable, Optional, Iterator, \
    MutableMapping, Generator, overload, List, Type, Dict, Any

from sortedcontainers import SortedSet

from gridsolver import util
from gridsolver.rules.rules import Rule, Guarantee, IdxType, IdxTypeSlice
from gridsolver.rules.unique import ElementsAtMostOnce, ElementsAtLeastOnce


class SolveStatus(Enum):
    NONE = 0
    SOLVED = 1
    INVALID = -1


class RuleContainer:
    def __init__(self):
        self.rules: SortedSet[Rule] = SortedSet(key=RuleContainer._rule_key)
        self._rules_ia: SortedSet[Rule] = SortedSet(key=RuleContainer._rule_key)
        self.guarantees: SortedSet[Guarantee] = SortedSet(key=RuleContainer._grt_kee)
        self._guarantees_ia: SortedSet[Guarantee] = SortedSet(key=RuleContainer._grt_kee)

    def __eq__(self, other: 'RuleContainer') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self.rules == other.rules and self._rules_ia == other._rules_ia and \
               self.guarantees == other.guarantees and self._guarantees_ia == other._guarantees_ia

    def __ne__(self, other: 'RuleContainer') -> bool:
        return not self == other

    @staticmethod
    def _rule_key(rule: Rule) -> Tuple:
        return rule.cells, type(rule).__name__

    @staticmethod
    def _grt_kee(gt: Guarantee) -> Tuple:
        return gt.val, gt.cells


class ImmutableGrid(util.GridSizeContainer, Sequence[int]):
    def __init__(self, known: Sequence[int], rows: int, cols: Optional[int] = None,
                 max_elem: Optional[int] = None, name: Optional[str] = None):
        util.GridSizeContainer.__init__(self, rows, cols, max_elem)
        self._known: ArrayType = array('i', known)
        self.__hash: int = hash((bytes(self._known)))
        self.format_args = util.PrettyPrintArgs()
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
        return self.to_str(util.PrettyPrintArgs(print_possible=False, args=self.format_args))

    def __repr__(self) -> str:
        return self.to_str(util.PrettyPrintArgs(print_possible=False, args=self.format_args))

    def to_str(self, args: util.PrettyPrintArgs = None) -> str:
        candidates = None
        if hasattr(self, "_candidates"):
            candidates = self._candidates

        return self._str_header(args.detail_rule) + "\n" + util.pretty_print(self.rows, self.cols, self.max_elem,
                                                                             self._known, candidates, args)


class Grid(ImmutableGrid, RuleContainer, MutableSequence[int]):
    def __delitem__(self, i: int) -> None:
        raise TypeError("Grid.__delitem__ not supported")

    def insert(self, index: int, obj) -> None:
        raise TypeError("Grid.insert not supported")

    def __init__(self, rows: int, cols: Optional[int] = None, max_elem: Optional[int] = None):
        ImmutableGrid.__init__(self, array('i', [0] * (rows * rows)), rows, cols, max_elem)
        RuleContainer.__init__(self)
        candidates_gen: Generator[Set[int]] = (set(range(1, self.max_elem + 1)) for _ in range(len(self)))
        self._candidates: Tuple[Set[int]] = tuple(candidates_gen)
        self.has_been_filled = False
        self.presolved_not_yet_once: bool = True

    @overload
    def __setitem__(self, i: int, val: int) -> None:
        ...

    @overload
    def __setitem__(self, i: Tuple[int, int], val: int) -> None:
        ...

    @overload
    def __setitem__(self, i: IdxType, val: int) -> None:
        ...

    def __setitem__(self, key: IdxType, val: int) -> None:
        self.has_been_filled = True
        idx = self._get_index_from_key(key)
        if isinstance(idx, slice):
            raise TypeError("Index slices not supported for setting.")
        self._known[idx] = val
        p = self._candidates[idx]
        if val > 0:
            p &= {val}

    def __repr__(self) -> str:
        return self.to_str(util.PrettyPrintArgs(print_possible=True, args=self.format_args))

    def __eq__(self, other: 'Grid') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self._known == other._known and self._candidates == other._candidates and RuleContainer.__eq__(self,
                                                                                                              other)

    def all_but_rule_equal(self, other: 'Grid') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self._known == other._known and self._candidates == other._candidates

    def __ne__(self, other: 'Grid') -> bool:
        return not self == other

    # noinspection PyArgumentList
    def __deepcopy__(self, memo: MutableMapping = None) -> 'Grid':
        if memo is None:
            memo = {}
        cls = type(self)
        result = cls.__new__(cls)
        memo[id(self)] = result
        setattr(result, "_GridSizeContainer__rows", self.rows)
        setattr(result, "_GridSizeContainer__cols", self.cols)
        setattr(result, "_GridSizeContainer__max_elem", self.max_elem)
        setattr(result, "_GridSizeContainer__len", self.len)
        setattr(result, "_known", copy.deepcopy(self._known, memo=memo))
        setattr(result, "_candidates", copy.deepcopy(self._candidates, memo=memo))
        setattr(result, "rules", copy.copy(self.rules))
        setattr(result, "_rules_ia", copy.copy(self._rules_ia))
        setattr(result, "guarantees", copy.copy(self.guarantees))
        setattr(result, "_guarantees_ia", copy.copy(self._guarantees_ia))
        setattr(result, "presolved_not_yet_once", self.presolved_not_yet_once)
        setattr(result, "format_args", copy.copy(self.format_args))
        return result

    def deepcopy(self) -> 'Grid':
        return copy.deepcopy(self)

    @property
    def is_solved(self) -> bool:
        return all(0 < k in p for p, k in zip(self._candidates, self._known))

    @property
    def is_valid(self) -> bool:
        return all(self._candidates)

    def get_candidates(self, key: IdxType) -> Set[int]:
        return self._candidates[self._get_index_from_key(key)]

    def get_smallest_candidate_set_gt1(self) -> Tuple[int, Set[int]]:
        possible_where_len_gt1 = ((i, pp) for i, pp in enumerate(self._candidates) if len(pp) > 1)
        mysorted = min(possible_where_len_gt1, key=lambda x: len(x[1]))
        return mysorted

    def get_smallest_guarantee(self) -> Optional[Guarantee]:
        if not self.guarantees:
            return None
        mysorted = min(self.guarantees, key=lambda gt: len(gt.cells))
        return mysorted

    def add_rule_checked(self, rule: Rule):
        if rule not in self._rules_ia:
            self.rules.add(rule)

    def deactivate_rule(self, rule: Rule):
        self.rules.remove(rule)
        self._rules_ia.add(rule)

    def add_gtee_checked(self, gtee: Guarantee):
        if gtee not in self._guarantees_ia:
            self.guarantees.add(gtee)

    def deactivate_gtee(self, gtee: Guarantee):
        self.guarantees.remove(gtee)
        self._guarantees_ia.add(gtee)

    @staticmethod
    def _load_preprocess_str(values: str):
        return values.strip().replace(" ", "") \
            .replace("\n", "").replace("\r", "").replace("\t", "").replace(".", "0")

    def _load_preprocess_sequence(self, values: Union[str, Iterable[int], Iterable[Iterable[int]]]):
        assert not self.has_been_filled, "Grid can only be filled once; or be used in individual access mode"
        flattened_once = False

        while not isinstance(values, str) and not flattened_once:
            values = util.flatten(values)
            flattened_once = True

        if isinstance(values, str):
            values = self._load_preprocess_str(values)

        assert len(values) == len(self._known), f"len: {len(values)} != {len(self._known)}"
        self.has_been_filled = True
        return values

    @overload
    def load(self, values: str, row_wise=True) -> None:
        ...

    @overload
    def load(self, values: Iterable[int], row_wise=True) -> None:
        ...

    @overload
    def load(self, values: Iterable[Iterable[int]], row_wise=True) -> None:
        ...

    def load(self, values: Any, row_wise=False):
        values = self._load_preprocess_sequence(values)
        if row_wise:
            for i, nk in enumerate(values):
                row, col = divmod(i, self.rows)
                self[(row, col)] = int(nk)
        else:
            for i, nk in enumerate(values):
                self[i] = int(nk)

    def presolve_hook_once(self):
        pass

    def presolve_hook(self):
        pass

    def _str_header(self, detailed=False):

        s = f"{self.__class__.__name__}({self.rows},{self.cols})" + \
            f" - [{len(self.rules)} rls, {len(self._rules_ia)} ria, {len(self.guarantees)} gts," \
            f" {len(self._guarantees_ia)} gia]"

        if detailed:
            grp1 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self.rules, key=lambda x: type(x).__name__), lambda x: type(x).__name__)}
            grp2 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self._rules_ia, key=lambda x: type(x).__name__),
                                      lambda x: type(x).__name__)}
            s1 = '\n'.join(map(str, (f"  {len(grp):6} \t {key}" for key, grp in grp1.items())))
            s2 = '\n'.join(map(str, (f"  {len(grp):6} \t {key}" for key, grp in grp2.items())))
            s += f"\n{s1}\n  ───────\n{s2}"

        return s

    def ext_rules(self, rule_cls: Type[Rule], kwargs_list: List[Dict[str, Any]] = None,
                  fun_it: Iterable[Callable[[Rule], Iterable]] = None) -> None:
        if kwargs_list is None and fun_it is None:
            new_rules = (rule_cls(self),)
        elif kwargs_list is not None and fun_it is None:
            new_rules = (rule_cls(self, **kwargs) for kwargs in kwargs_list)
        elif kwargs_list is None and fun_it is not None:
            new_rules = (rule_cls(self, cell_creator=fun) for fun in fun_it)
        else:
            new_rules = (rule_cls(self, cell_creator=fun, **kwargs) for kwargs in kwargs_list for fun in fun_it)

        for rule in new_rules:
            self.add_rule_checked(rule)

    @property
    def row_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        # noinspection PyTypeChecker
        return (partial(Rule.cells_as_row_or_column, idx=i, row_wise=True) for i in range(self.rows))

    @property
    def col_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        # noinspection PyTypeChecker
        return (partial(Rule.cells_as_row_or_column, idx=i, row_wise=False) for i in range(self.rows))


class UniqueSquare(Grid):
    """Square grid with uniqueness contraints for rows and columns"""

    def __init__(self, n: int):
        super().__init__(n)

        self.ext_rules(ElementsAtMostOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtMostOnce, None, self.col_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.col_rule_applicators)
