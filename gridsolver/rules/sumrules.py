import collections
import itertools
import reprlib
from abc import abstractmethod
from typing import Tuple, Set, Sequence, List, Iterable, Deque, MutableSequence, Iterator, Optional, FrozenSet

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Rule, Guarantee, RuleAlwaysSatisfied, InvalidGrid, IdxType, _format_coord
from gridsolver.rules.unique import ElementsAtMostOnce, multi_occur_check


class SumRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'sum', '_sum_candidates', '_candidates')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], mysum: int):
        if not gsz is None and not cells is None:
            cells = sorted(list(cells))
            super().__init__(gsz, cells, None)
        self.sum: int = mysum
        self._sum_candidates: Optional[Tuple[Set[int]]] = None
        self._candidates = None

    @abstractmethod
    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[
                bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
        pass


# todo combine to sum rules for large areas
# todo subtract from guarantees to make new subrules

class SumAndElementsAtMostOnce(ElementsAtMostOnce, SumRule):
    def __init__(self, gsz: GridSizeContainer, cells: Iterable[IdxType], mysum: int):
        ElementsAtMostOnce.__init__(self, gsz, cells, None)
        SumRule.__init__(self, None, None, mysum)

    @property
    def sum_candidates(self) -> Tuple[FrozenSet[int]]:
        if self._sum_candidates is None:
            len_cell = self.len_cells
            self._sum_candidates = tuple(
                frozenset(p) for p in SumAndElementsAtMostOnce.partition2(self.sum, len_cell, 1, self._max_elem)
                if len(set(p)) == len_cell
            )

        return self._sum_candidates

    @property
    def candidates(self) -> FrozenSet[int]:
        if self._candidates is None:
            self._candidates = frozenset(x for y in self.sum_candidates for x in y)
        return self._candidates

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumAndElementsAtMostOnce
        return self.sum == other.sum

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.sum}: {cell_str}; {reprlib.repr([set(p) for p in self.sum_candidates])}]"

    _partition_dic = {}

    @staticmethod
    def partition(n: int, count: int, mini: int, maxi: int) -> Iterator[Deque[int]]:
        if maxi < mini or count <= 0:
            return

        if maxi >= n and count == 1:
            yield collections.deque(iterable=(n,))
            return
        elif count == 1:
            return

        mymax = min(n // count, maxi) + 1
        if count == 2:
            for i in range(mini, mymax):
                for p in SumAndElementsAtMostOnce.partition(n - i, count - 1, i, maxi):
                    p.appendleft(i)
                    yield p
        else:
            for i in range(mini, mymax):
                for p in SumAndElementsAtMostOnce.partition2(n - i, count - 1, i, maxi):
                    p = p.copy()
                    p.appendleft(i)
                    yield p

    @staticmethod
    def partition2(n: int, count: int, mini: int = 1, maxi: Optional[int] = None) -> List[Deque[int]]:
        if maxi is None:
            maxi = n

        if maxi < mini or count <= 0:
            return []

        if maxi >= n and count == 1:
            return [collections.deque((n,))]
        elif count == 1:
            return []

        key = (n, count, mini, maxi)
        result = SumAndElementsAtMostOnce._partition_dic.get(key)
        if result is not None:
            return result
        result = list(SumAndElementsAtMostOnce.partition(n, count, mini, maxi))
        SumAndElementsAtMostOnce._partition_dic[key] = result
        return result

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        my_known, new_candidates, new_candidate_cells = self._process_new_candidate_cells(known, candidates)

        lk = len(my_known)
        if lk == self.len_cells and sum(my_known) == self.sum:
            raise RuleAlwaysSatisfied()
        elif lk == self.len_cells:
            for p in candidates:
                p.clear()
                raise InvalidGrid()
        elif lk == self.len_cells - 1:
            k = self.sum - sum(my_known)
            np0 = new_candidates[0]
            if k in np0 and k not in my_known:
                np0.clear()
                np0.add(k)
                raise RuleAlwaysSatisfied()
            else:
                np0.clear()
                raise InvalidGrid()

        candidates_union = set.union(*new_candidates)
        new_sum_candidates = (sp - my_known for sp in self.sum_candidates if my_known <= sp)
        new_sum_candidates = [sp for sp in new_sum_candidates if sp <= candidates_union]
        new_candidate_sets = frozenset().union(*new_sum_candidates)
        for p in new_candidates:
            p &= new_candidate_sets
            if not p:
                raise InvalidGrid()

        new_gts = self._filter_new_sum_candidates(new_candidate_cells, new_candidates,
                                                  new_sum_candidates, guarantees)
        multi_occur_check(self.len_cells - lk, new_candidates)
        SumAndElementsAtMostOnce._update_from_guarantees(candidates, new_candidate_cells, guarantees)

        if lk:
            return False, [
                SumAndElementsAtMostOnce(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=new_candidate_cells, mysum=self.sum - sum(my_known)
                )
            ], new_gts

        return False, None, new_gts

    def _filter_new_sum_candidates(self, new_cells: Sequence[int], new_candidates: Sequence[Set[int]],
                                   new_sum_candidates: Iterable[FrozenSet[int]], gts: Iterable[Guarantee]) \
            -> List[Guarantee]:

        allowed_perms: Set[Tuple[int]] = set()
        for sp in new_sum_candidates:
            for perm in itertools.permutations(sp):
                if all(val in p for val, p in zip(perm, new_candidates)):
                    allowed_perms.add(perm)

        nc_set = frozenset(new_cells)
        for gt in gts:
            if nc_set >= gt.cells:
                for perm in allowed_perms.copy():
                    if not any(cell in gt.cells and perm[i] == gt.val for (i, cell) in enumerate(new_cells)):
                        allowed_perms.remove(perm)

        for i, p in enumerate(new_candidates):
            p &= {perm[i] for perm in allowed_perms}
            if not p:
                raise InvalidGrid()

        intersect = frozenset.intersection(*new_sum_candidates)

        return [Guarantee(
            val=i, cells=frozenset(c for (c, p) in zip(new_cells, new_candidates) if i in p),
            rows=self._rows, cols=self._cols
        ) for i in intersect]
