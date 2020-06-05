import collections
import itertools

from rules.rules import *
from rules.unique import ElementsAtMostOnce


class SumRule(Rule):
    def __init__(self, gsz: util.GridSizeContainer, cells: Iterable[IdxType], mysum: int):
        super().__init__(gsz, sorted(cells), None)
        self.sum: int = mysum
        self._sum_possibles: Optional[Tuple[Set[int]]] = None
        self._possibles = None
        raise NotImplementedError()

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None) -> \
            Tuple[
                bool, Optional[Iterable['Rule']], Optional[Iterable[Guarantee]]]:
        pass


# todo combine to sum rules for large areas
# todo subtract from guarantees to make new subrules

class SumAndElementsAtMostOnce(ElementsAtMostOnce):
    def __init__(self, gsz: util.GridSizeContainer, cells: Iterable[IdxType], mysum: int):
        super().__init__(gsz, sorted(cells), None)
        self.sum: int = mysum
        self._sum_possibles: Optional[Tuple[Set[int]]] = None
        self._possibles = None

    @property
    def sum_possibles(self) -> Tuple[FrozenSet[int]]:
        if self._sum_possibles is None:
            len_cell = self.len_cells
            self._sum_possibles = tuple(
                frozenset(p) for p in SumAndElementsAtMostOnce.partition2(self.sum, len_cell, 1, self._max_elem)
                if len(set(p)) == len_cell
            )

        return self._sum_possibles

    @property
    def possibles(self) -> FrozenSet[int]:
        if self._possibles is None:
            self._possibles = frozenset(x for y in self.sum_possibles for x in y)
        return self._possibles

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumAndElementsAtMostOnce
        return self.sum == other.sum

    def __repr__(self):
        cell_str = reprlib.repr(self.cells)
        return f"{type(self).__name__}[{cell_str.partition('[')[2][:-2]}; {self.sum}; " \
               f"{reprlib.repr(set(self.possibles))}; {reprlib.repr([set(p) for p in self.sum_possibles])}]"

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
    def partition2(n: int, count: int, mini: int = 1, maxi: Optional[int] = None) -> Iterator[Deque[int]]:
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

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        my_known, new_possible, new_possible_cells = self._process_new_possible_cells(known, possible)

        lk = len(my_known)
        if lk == self.len_cells and sum(my_known) == self.sum:
            raise RuleAlwaysSatisfied()
        elif lk == self.len_cells:
            for p in possible:
                p.clear()
                raise InvalidGrid()
        elif lk == self.len_cells - 1:
            k = self.sum - sum(my_known)
            np0 = new_possible[0]
            if k in np0 and k not in my_known:
                np0.clear()
                np0.add(k)
                raise RuleAlwaysSatisfied()
            else:
                np0.clear()
                raise InvalidGrid()

        possible_union = set.union(*new_possible)
        new_sum_possibles = (sp - my_known for sp in self.sum_possibles if my_known <= sp)
        new_sum_possibles = [sp for sp in new_sum_possibles if sp <= possible_union]
        new_possibles = frozenset().union(*new_sum_possibles)
        for p in new_possible:
            p &= new_possibles
            if not p:
                raise InvalidGrid()

        new_gts = SumAndElementsAtMostOnce._filter_new_sum_possibles(new_possible_cells, new_possible,
                                                                     new_sum_possibles, guarantees)
        SumAndElementsAtMostOnce._multi_occur_check(self.len_cells - lk, new_possible)
        SumAndElementsAtMostOnce._update_from_guarantees(possible, new_possible_cells, guarantees)

        if lk:
            return False, [SumAndElementsAtMostOnce(gsz=util.GridSizeContainer(self._rows, self._cols, self._max_elem),
                                                    cells=new_possible_cells, mysum=self.sum - sum(my_known))], new_gts

        return False, None, new_gts

    @staticmethod
    def _filter_new_sum_possibles(new_cells: Sequence[int], new_possible: Sequence[Set[int]],
                                  new_sum_possibles: Iterable[FrozenSet[int]], gts: Iterable[Guarantee]) \
            -> List[Guarantee]:

        allowed_perms: Set[Tuple[int]] = set()
        for sp in new_sum_possibles:
            for perm in itertools.permutations(sp):
                if all(val in p for val, p in zip(perm, new_possible)):
                    allowed_perms.add(perm)

        nc_set = frozenset(new_cells)
        for gt in gts:
            if nc_set.issuperset(gt.cells):
                for perm in allowed_perms.copy():
                    if not any(cell in gt.cells and perm[i] == gt.val for (i, cell) in enumerate(new_cells)):
                        allowed_perms.remove(perm)

        for i, p in enumerate(new_possible):
            p &= {perm[i] for perm in allowed_perms}
            if not p:
                raise InvalidGrid()

        intersect = frozenset.intersection(*new_sum_possibles)

        return [Guarantee(val=i, cells=array('i', (c for (c, p) in zip(new_cells, new_possible) if i in p))) for i in
                intersect]
