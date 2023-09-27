import collections
import itertools
import reprlib
from typing import Tuple, Set, Sequence, List, Iterable, Deque, MutableSequence, Iterator, Optional, FrozenSet

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Rule, Guarantee, RuleAlwaysSatisfied, InvalidGrid, IdxType, _format_coord
from gridsolver.rules.unique import ElementsAtMostOnce


class SumRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'sum')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], mysum: int):
        if not gsz is None and not cells is None:
            cells = sorted(list(cells))
            super().__init__(gsz, cells, None)
        self.sum: int = mysum

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        my_known: List[int] = []
        for cell in self.cells:
            k = known[cell]
            if k > 0:
                my_known.append(k)

        lk = len(my_known)
        current_sum = sum(my_known)
        if lk == self.len_cells and current_sum == self.sum:
            raise RuleAlwaysSatisfied()
        elif lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.sum - current_sum
            last_cell = next(cell for cell in self.cells if known[cell] == 0)
            if k in candidates[last_cell]:
                candidates[last_cell].clear()
                candidates[last_cell].add(k)
                raise RuleAlwaysSatisfied()
            else:
                candidates[last_cell].clear()
                raise InvalidGrid()

        for cell in self.cells:
            tmax = self.sum - current_sum + lk - len(self.cells)
            for c in list(candidates[cell]):
                if c > tmax:
                    candidates[cell].discard(c)

        if lk:
            new_target = self.sum - current_sum
            if new_target < 0:
                self.invalidate_current_cells_and_raise_invalid_grid(candidates)
            return False, [
                SumRule(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=[cell for cell in self.cells if known[cell] == 0], mysum=new_target
                )
            ], []

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumRule
        return self.sum == other.sum

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.sum}: {cell_str}]"


class DiffRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'diff')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if not gsz is None and not cells is None:
            cells = list(cells)
            assert len(cells) == 2
            super().__init__(gsz, cells, None)
        self.diff: int = target

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        first = known[self.cells[0]]
        second = known[self.cells[1]]
        if first > 0 and second > 0 and (first - second == self.diff or second - first == self.diff):
            raise RuleAlwaysSatisfied()
        elif first > 0 and second > 0:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif first > 0:
            new_cand = {first - self.diff, first + self.diff}
            candidates[self.cells[1]].intersection_update(new_cand)
            if len(candidates[self.cells[1]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[1]]) == 0:
                raise InvalidGrid()
        elif second > 0:
            new_cand = {second - self.diff, second + self.diff}
            candidates[self.cells[0]].intersection_update(new_cand)
            if len(candidates[self.cells[0]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[0]]) == 0:
                raise InvalidGrid()

        for cell in self.cells:
            for c in list(candidates[cell]):
                t1 = c + self.diff
                t2 = c - self.diff
                t2 = t2 if t2 > 0 else -1
                for cell2 in self.cells:
                    if cell == cell2:
                        continue
                    if t1 in candidates[cell2]:
                        t1 = 0
                    if t2 in candidates[cell2]:
                        t2 = 0
                    if t1 == 0 or t2 == 0:
                        break
                if t1 != 0 and t2 != 0:
                    candidates[cell].discard(c)
        if any(not candidates[cell] for cell in self.cells):
            raise InvalidGrid()

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.diff))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: DiffRule
        return self.diff == other.diff

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.diff}: {cell_str}]"


class ProdRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'prod')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if not gsz is None and not cells is None:
            cells = sorted(list(cells))
            super().__init__(gsz, cells, None)
        self.prod: int = target

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
        my_known: List[int] = []
        for cell in self.cells:
            k = known[cell]

            if k > 0:
                my_known.append(k)

        lk = len(my_known)
        current_prod = 1
        for k in my_known:
            current_prod *= k
        if lk == self.len_cells and current_prod == self.prod:
            raise RuleAlwaysSatisfied()
        elif lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.prod / current_prod
            last_cell = next(cell for cell in self.cells if known[cell] == 0)
            if k != int(k):
                candidates[last_cell].clear()
                raise InvalidGrid()
            k = int(k)
            if k in candidates[last_cell]:
                candidates[last_cell].clear()
                candidates[last_cell].add(k)
                raise RuleAlwaysSatisfied()
            else:
                candidates[last_cell].clear()
                raise InvalidGrid()

        for cell in self.cells:
            tmax = self.prod / current_prod
            for c in list(candidates[cell]):
                if c > tmax:
                    candidates[cell].discard(c)

        if any(not candidates[cell] for cell in self.cells):
            raise InvalidGrid()

        if lk:
            new_target = self.prod / current_prod
            if new_target != int(new_target):
                self.invalidate_current_cells_and_raise_invalid_grid(candidates)
            new_target = int(new_target)
            return False, [
                ProdRule(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=[cell for cell in self.cells if known[cell] == 0], target=new_target
                )
            ], []

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.prod))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: ProdRule
        return self.prod == other.prod

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.prod}: {cell_str}]"


class DivRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'div')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if not gsz is None and not cells is None:
            cells = list(cells)
            assert len(cells) == 2
            super().__init__(gsz, cells, None)
        self.div: int = target

    def __hash__(self):
        return hash((super().__hash__(), self.div))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: DivRule
        return self.div == other.div

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        first = known[self.cells[0]]
        second = known[self.cells[1]]
        if first > 0 and second > 0 and (first / second == self.div or second / first == self.div):
            raise RuleAlwaysSatisfied()
        elif first > 0 and second > 0:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif first > 0:
            new_cand = {first * self.div}
            if int(first / self.div) == first / self.div:
                new_cand.add(int(first / self.div))
            candidates[self.cells[1]].intersection_update(new_cand)
            if len(candidates[self.cells[1]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[1]]) == 0:
                raise InvalidGrid()
        elif second > 0:
            new_cand = {second * self.div}
            if int(second / self.div) == second / self.div:
                new_cand.add(int(second / self.div))
            candidates[self.cells[0]].intersection_update(new_cand)
            if len(candidates[self.cells[0]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[0]]) == 0:
                raise InvalidGrid()

        for cell in self.cells:
            for c in list(candidates[cell]):
                t1 = c * self.div
                t2 = c / self.div
                t2 = int(t2) if int(t2) == t2 else -1
                for cell2 in self.cells:
                    if cell == cell2:
                        continue
                    if t1 in candidates[cell2]:
                        t1 = 0
                    if t2 in candidates[cell2]:
                        t2 = 0
                    if t1 == 0 or t2 == 0:
                        break
                if t1 != 0 and t2 != 0:
                    candidates[cell].discard(c)
        if any(not candidates[cell] for cell in self.cells):
            raise InvalidGrid()

        return False, None, []

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.div}: {cell_str}]"


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
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
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
        SumAndElementsAtMostOnce._update_from_guarantees(candidates, new_candidate_cells, guarantees)

        if lk:
            new_target = self.sum - sum(my_known)
            if new_target < 0:
                self.invalidate_current_cells_and_raise_invalid_grid(candidates)
            return False, [
                SumAndElementsAtMostOnce(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=new_candidate_cells, mysum=new_target
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
