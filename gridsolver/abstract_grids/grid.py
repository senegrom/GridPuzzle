import copy
import itertools
from array import array
from enum import Enum
from functools import partial
from typing import Tuple, Set, Iterable, MutableSequence, Union, Callable, Optional, Iterator, \
    MutableMapping, Generator, overload, List, Type, Dict, Any, Sequence, FrozenSet, TypeVar

from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.rule_container import RuleContainer
from gridsolver.rules.rules import Rule, Guarantee, IdxType
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.util import flatten


class SolveStatus(Enum):
    NONE = 0
    SOLVED = 1
    INVALID = -1


def _load_preprocess_str(values: str):
    assert isinstance(values, str), f"Cannot call _load_preprocess_str with object {values}, only strings."
    return values.strip().replace(" ", "") \
        .replace("\n", "").replace("\r", "").replace("\t", "").replace(".", "0")


def _load_preprocess_str_space_sep(values: Union[str, Iterable[str]]):
    if isinstance(values, str):
        values = values.strip().split("\n")
    values = (x for value in values for x in value.split("\n"))
    values = (x for value in values for x in value.split(" "))
    values = (x for value in values for x in value.split("\t"))
    values = (x.strip().replace(".", "0") for x in values)
    values = (x for x in values if x)
    return list(values)


T_ = TypeVar("T_", bound=Rule)


class Grid(ImmutableGrid, RuleContainer, MutableSequence[int]):
    def __delitem__(self, i: int) -> None:
        raise TypeError("Grid.__delitem__ not supported")

    def insert(self, index: int, obj) -> None:
        raise TypeError("Grid.insert not supported")

    def __init__(self, rows: int, cols: Optional[int] = None, max_elem: Optional[int] = None):
        if cols is None:
            cols = rows
        assert rows, "Rows must be > 0"
        ImmutableGrid.__init__(self, array('I', [0] * (rows * cols)), rows, cols, max_elem)
        RuleContainer.__init__(self)
        candidates_gen: Generator[Set[int]] = (set(range(1, self.max_elem + 1)) for _ in range(len(self)))
        self._candidates: Tuple[Set[int]] = tuple(candidates_gen)
        self.has_been_filled = False

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
        if val > 0:
            self._candidates[idx].intersection_update([val])

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
        setattr(result, "rows", self.rows)
        setattr(result, "cols", self.cols)
        setattr(result, "max_elem", self.max_elem)
        setattr(result, "len", self.len)
        setattr(result, "_known", copy.deepcopy(self._known, memo=memo))
        setattr(result, "_candidates", copy.deepcopy(self._candidates, memo=memo))
        setattr(result, "rules", copy.copy(self.rules))
        setattr(result, "rules_ia", copy.copy(self.rules_ia))
        setattr(result, "guarantees", copy.copy(self.guarantees))
        setattr(result, "guarantees_ia", copy.copy(self.guarantees_ia))
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
        candidates_where_len_gt1 = ((i, pp) for i, pp in enumerate(self._candidates) if len(pp) > 1)
        mysorted = min(candidates_where_len_gt1, key=lambda x: len(x[1]))
        return mysorted

    def get_smallest_guarantee(self) -> Optional[Guarantee]:
        if not self.guarantees:
            return None
        mysorted = min(self.guarantees, key=lambda gt: len(gt.cells))
        return mysorted

    def add_rule_checked(self, rule: Rule):
        if rule not in self.rules_ia:
            self.rules.add(rule)

    def deactivate_rule(self, rule: Rule):
        self.rules.remove(rule)
        self.rules_ia.add(rule)

    def add_gtee_checked(self, gtee: Guarantee):
        if gtee not in self.guarantees_ia:
            self.guarantees.add(gtee)

    def deactivate_gtee(self, gtee: Guarantee):
        self.guarantees.remove(gtee)
        self.guarantees_ia.add(gtee)

    def _load_preprocess_sequence(self, values: Union[str, Iterable[int], Iterable[Iterable[int]]],
                                  /, space_sep=False, assert_length=None):
        if assert_length is None:
            assert_length = len(self._known)
        if not isinstance(values, str):
            values = flatten(values)

        if isinstance(values, str):
            if space_sep:
                values = _load_preprocess_str_space_sep(values)
            else:
                values = _load_preprocess_str(values)

        assert len(values) == assert_length, f"len: {len(values)} != {assert_length}"
        self.has_been_filled = True
        return values

    def load(self, values: Union[str, Sequence[int], Sequence[Iterable[int]]], /,
             row_wise=True, space_sep=False):

        assert not self.has_been_filled, "Grid can only be filled once; or be used in individual access mode"
        values = self._load_preprocess_sequence(values, space_sep=False)
        if row_wise:
            for i, nk in enumerate(values):
                row, col = divmod(i, self.cols)

                try:
                    value = int(nk)
                except ValueError:
                    value = int(nk, base=36)
                self[(row, col)] = value
        else:
            for i, nk in enumerate(values):
                self[i] = int(nk)

    def _str_header(self, detailed=False):

        s = f"{self.__class__.__name__}({self.rows},{self.cols})" + \
            f" - [{len(self.rules)} rls, {len(self.rules_ia)} ria, {len(self.guarantees)} gts," \
            f" {len(self.guarantees_ia)} gia]"

        if detailed:
            grp1 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self.rules, key=lambda x: type(x).__name__), lambda x: type(x).__name__)}
            grp2 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self.rules_ia, key=lambda x: type(x).__name__),
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
        return (partial(Rule.cells_as_row_or_column, idx=i, row_wise=False) for i in range(self.cols))

    def get_rule_cells_of_type(self, class_: Type[Rule]) -> List[FrozenSet[int]]:
        return [frozenset(rule.cells) for rule in self.get_rules_of_type(class_)]

    def get_rules_of_type(self, class_: Type[T_]) -> List[T_]:
        return [rule for rule in self.rules if isinstance(rule, class_)]

    @property
    def unique_rule_cells(self) -> List[FrozenSet[int]]:
        return self.get_rule_cells_of_type(ElementsAtMostOnce)

    @property
    def weak_links(self) -> List[FrozenSet[int]]:
        """the weak links originating from a cell in a dictionary"""
        uneq_rules = self.get_rules_of_type(UneqRule)
        return [frozenset().union(*(rule.rel_cells for rule in uneq_rules if rule.origin_cell == cell))
                for cell in range(self.len)]

    @property
    def semi_strong_links(self) -> Dict[int, List[FrozenSet[int]]]:
        """the semi-strong links originating from a cell in a dictionary"""
        g2 = self.get_guarantees_of_length(2)
        g2_dic = {val: [gt for gt in g2 if gt.val == val] for val in range(1, self.max_elem + 1)}
        links = {val: [
            set().union(*(gt.cells for gt in g2_dic[val] if cell in gt.cells))
            for cell in range(self.len)]
            for val in range(1, self.max_elem + 1)}
        for val in range(1, self.max_elem + 1):
            for cell in range(self.len):
                links[val][cell] = frozenset(links[val][cell].difference((cell,)))

        return links

    @property
    def strong_links(self) -> Dict[int, List[FrozenSet[int]]]:
        """the strong links (semi-strong and weak) originating from a cell in a dictionary"""
        wl = self.weak_links
        ssl = self.semi_strong_links
        return {val: [cell_links & wl[cell]
                      for cell, cell_links in enumerate(ssl[val])]
                for val in range(1, self.max_elem + 1)}

    @property
    def guarantees_by_value(self) -> Dict[int, List[Guarantee]]:
        return {i: [gt for gt in self.guarantees if gt.val == i] for i in range(1, self.max_elem + 1)}

    @property
    def guarantee_cells_by_value(self) -> Dict[int, List[FrozenSet]]:
        return {i: [gt.cells for gt in self.guarantees if gt.val == i] for i in range(1, self.max_elem + 1)}

    @property
    def guarantees_by_length(self) -> Dict[int, Guarantee]:
        return {ll: self.get_guarantees_of_length(ll) for ll in range(1, self.len + 1)}

    def get_guarantees_of_length(self, ll: int) -> List[Guarantee]:
        return [gt for gt in self.guarantees if len(gt.cells) == ll]

    def get_guarantees_shorter_than(self, ll: int) -> List[Guarantee]:
        return [gt for gt in self.guarantees if len(gt.cells) <= ll]

    @property
    def guarantees_by_value_and_length(self) -> Dict[int, Dict[int, List[FrozenSet]]]:
        gbv = self.guarantee_cells_by_value
        return {i:
                    {ll:
                         [gt for gt in gbv[i] if len(gt) == ll]
                     for ll in range(1, self.len)}
                for i in range(1, self.max_elem + 1)}

    def get_cells_with_candidate_length(self, i) -> List[Tuple[int, Set[int]]]:
        return [(cell, self._candidates[cell]) for cell, cts in enumerate(self._candidates) if len(cts) == i]
