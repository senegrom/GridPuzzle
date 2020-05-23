import collections
import itertools
import numbers
import reprlib
from abc import abstractmethod, ABC
from array import array, ArrayType
from typing import *

import util


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

    def __init__(self, gsz: util.GridSizeContainer,
                 cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]] = None,
                 cell_creator: Callable[
                     ['Rule'], Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]]] = None):

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

    def cells_as_row_or_column(self, idx: int, row_wise: bool) -> Iterable[
        Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]]:
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
        return self._rows == other._rows and self._cols == other._cols and self._max_elem == other._max_elem and \
               self.cells == other.cells

    def __hash__(self):
        return hash((type(self), bytes(self.cells), self._rows, self._cols, self._max_elem, self.len_cells))

    def __ne__(self, other: 'Rule') -> bool:
        return not self == other


class ElementsAtMostOnce(Rule):
    def __init__(self, gsz: util.GridSizeContainer,
                 cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]] = None,
                 cell_creator=None):
        Rule.__init__(self, gsz, sorted(cells) if cells is not None else None, cell_creator)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        my_known, new_possible, new_possible_cells = self._process_new_possible_cells(known, possible)

        lk = len(my_known)
        if lk == self.len_cells:
            raise RuleAlwaysSatisfied()

        ElementsAtMostOnce._multi_occur_check(self.len_cells - lk, new_possible)
        ElementsAtMostOnce._update_from_guarantees(possible, new_possible_cells, guarantees)

        return False, None, None

    @classmethod
    def _update_from_guarantees(cls, possible: Tuple[Set[int]], new_possible_cells: List[int],
                                guarantees: Sequence[Guarantee]) -> None:
        npc_set = frozenset(new_possible_cells)
        for gt in guarantees:
            gt_cells = frozenset(gt.cells)
            if gt_cells.issubset(npc_set):
                for cell in npc_set - gt_cells:
                    possible[cell].difference_update({gt.val})

    def _process_new_possible_cells(self, known: MutableSequence[int], possible: Tuple[Set[int]]):
        my_known = set()
        new_possible = []
        new_possible_cells: List[int] = []
        for cell in self.cells:
            p = possible[cell]
            k = known[cell]

            if k > 0:
                if k in my_known:
                    p.clear()
                    raise InvalidGrid()
                my_known.add(k)
            else:
                new_possible.append(p)
                new_possible_cells.append(cell)

        for p in new_possible:
            p.difference_update(my_known)
            if not p:
                raise InvalidGrid()

        return my_known, new_possible, new_possible_cells

    @classmethod
    def _multi_occur_check(cls, lkx: int, possible: Sequence[Set[int]]) -> None:
        possible_st: Set[FrozenSet[int]] = set()
        possible_intg = [p for p in possible if 1 < len(p) < lkx]
        for p in possible_intg:
            possible_st.add(frozenset(p))

        possible_ct: Counter[FrozenSet[int]] = collections.Counter()
        for p in possible_intg:
            possible_ct.update({frozenset(p): 1})
        pct_items = possible_ct.items()

        for key, count in pct_items:
            lk = len(key)
            if count == lk:
                for p in possible:
                    if not p.issubset(key):
                        p.difference_update(key)
                    if not p:
                        raise InvalidGrid()
            elif count > lk:
                for p in possible:
                    if p.issubset(key):
                        p.clear()
                        raise InvalidGrid()

        for comb_ct in range(2, lkx):
            for combs in itertools.combinations(pct_items, comb_ct):
                count = 0
                key = set()
                dismiss = False
                for keyx, countx in combs:
                    count += countx
                    key |= keyx
                    if countx > len(keyx):
                        dismiss = True
                if count >= lkx or dismiss:
                    continue
                lk = len(key)
                if count == lk:
                    for p in possible:
                        if not p.issubset(key):
                            p.difference_update(key)
                        if not p:
                            raise InvalidGrid()
                elif count > lk:
                    for p in possible:
                        if p.issubset(key):
                            p.clear()
                            raise InvalidGrid()


class ElementsAtLeastOnce(Rule):
    def __init__(self, gsz: util.GridSizeContainer,
                 cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]] = None,
                 cell_creator=None):
        Rule.__init__(self, gsz, sorted(cells) if cells is not None else None, cell_creator)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        return False, [], [Guarantee(val, self.cells) for val in range(1, self._max_elem + 1)]


class IneqRule(Rule):
    def __init__(self, gsz: util.GridSizeContainer,
                 gt_cell: Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]],
                 lt_cell: Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]):
        Rule.__init__(self, gsz, [gt_cell, lt_cell], None)
        self._gt_cell, self._lt_cell = self.cells

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        plt = possible[self._lt_cell]
        pgt = possible[self._gt_cell]
        plt.intersection_update(range(1, max(pgt, default=0)))
        pgt.intersection_update(range(min(plt, default=self._max_elem) + 1, self._max_elem + 1))
        if not plt or not pgt:
            raise InvalidGrid()
        if known[self._gt_cell] > 0 and 0 < known[self._lt_cell] < known[self._gt_cell]:
            raise RuleAlwaysSatisfied()
        return False, None, None


class SingleRelationRule(Rule):
    def __init__(self, gsz: util.GridSizeContainer,
                 origin_cell: Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]],
                 rel_cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]]):
        rel_cells = list(rel_cells)
        Rule.__init__(self, gsz, [origin_cell] + sorted(rel_cells), None)
        self.origin_cell: int = self.cells[0]
        self.rel_cells: ArrayType = array('i', self.cells[1:])


class UneqRule(SingleRelationRule):
    def __init__(self, gsz: util.GridSizeContainer,
                 origin_cell: Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]],
                 rel_cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]]):
        SingleRelationRule.__init__(self, gsz, origin_cell, rel_cells)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        k = known[self.origin_cell]

        if k > 0:
            kk = {k}
            for p in (possible[cell] for cell in self.rel_cells):
                p.difference_update(kk)
                if not p:
                    raise InvalidGrid()

        por = possible[self.origin_cell]
        removed_values = set()
        for kre in (known[cell] for cell in self.rel_cells):
            if kre > 0 and kre not in removed_values:
                por.difference_update({kre})
                removed_values.add(kre)
                if not por:
                    raise InvalidGrid()

        rcs = frozenset(self.rel_cells)
        for gt in guarantees:
            if gt.val not in removed_values and rcs.issuperset(gt.cells):
                por.difference_update({gt.val})
                removed_values.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0 and all(0 < known[cell] != k for cell in self.rel_cells):
            raise RuleAlwaysSatisfied()
        return False, None, None


class DiffGe2Rule(SingleRelationRule):
    def __init__(self, gsz: util.GridSizeContainer,
                 origin_cell: Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]],
                 rel_cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]]):
        SingleRelationRule.__init__(self, gsz, origin_cell, rel_cells)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        k = known[self.origin_cell]
        por = possible[self.origin_cell]
        if not por:
            raise InvalidGrid()

        def get_diff_set(kx, px):
            if kx > 0:
                return {kx - 1, kx, kx + 1}
            elif max(px) == min(px) + 2:
                return {min(px) + 1}
            elif max(px) == min(px) + 1:
                return {min(px), min(px) + 1}
            else:
                return None

        kk = get_diff_set(k, por)
        if kk:
            for p in (possible[cell] for cell in self.rel_cells):
                p.difference_update(kk)
                if not p:
                    raise InvalidGrid()

        for kre, pre in ((known[cell], possible[cell]) for cell in self.rel_cells):
            if not pre:
                raise InvalidGrid()
            kk = get_diff_set(kre, pre)
            if kk:
                por.difference_update(kk)
                if not por:
                    raise InvalidGrid()

        removed_values1 = set()
        removed_values2 = set()
        rcs = frozenset(self.rel_cells)
        rcso = frozenset([self.origin_cell, *self.rel_cells])
        for gt in guarantees:
            gtcs = frozenset(gt.cells)
            if gt.val not in removed_values1 and rcs.issuperset(gtcs):
                por.difference_update({gt.val - 1, gt.val, gt.val + 1})
                removed_values1.add(gt.val)
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()
            elif gt.val not in removed_values2 and rcso.issuperset(gtcs):
                por.difference_update({gt.val - 1, gt.val + 1})
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0:
            forb = {k - 1, k, k + 1}
            if all(0 < known[cell] and known[cell] not in forb for cell in self.rel_cells):
                raise RuleAlwaysSatisfied()

        return False, None, None


class SumAndElementsAtMostOnce(ElementsAtMostOnce):
    def __init__(self, gsz: util.GridSizeContainer,
                 cells: Iterable[Union[numbers.Integral, Tuple[numbers.Integral, numbers.Integral]]],
                 mysum: int):
        Rule.__init__(self, gsz, sorted(cells), None)
        self.sum: int = mysum
        self._sum_possibles: Optional[Tuple[Set[int]]] = None
        self._possibles = None

    @property
    def sum_possibles(self) -> Tuple[FrozenSet[int]]:
        if self._sum_possibles is None:
            len_cell = self.len_cells
            self._sum_possibles = tuple(
                frozenset(p) for p in SumAndElementsAtMostOnce.partition(self.sum, 1, self._max_elem)
                if len(p) == len_cell and len(set(p)) == len_cell
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

    @classmethod
    def partition(cls, n: int, ii: int = 1, maxi: int = None) -> Iterator[Tuple[int]]:
        if maxi < ii:
            yield from []
            return

        if maxi is None or maxi >= n:
            yield (n,)
            maxi = n

        mymax = min(n // 2, maxi) + 1
        for i in range(ii, mymax):
            for p in SumAndElementsAtMostOnce.partition(n - i, i, maxi):
                yield (i,) + p

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
        new_sum_possibles = (sp - my_known for sp in self.sum_possibles if my_known.issubset(sp))
        new_sum_possibles = [sp for sp in new_sum_possibles if sp.issubset(possible_union)]
        new_possibles = frozenset().union(*new_sum_possibles)
        for p in new_possible:
            p.intersection_update(new_possibles)
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

    @classmethod
    def _filter_new_sum_possibles(self, new_cells: Sequence[int], new_possible: Sequence[Set[int]],
                                  new_sum_possibles: Iterable[FrozenSet[int]], gts: Iterable[Guarantee]) \
            -> List[Guarantee]:

        allowed_perms: Set[Tuple[int]] = set()
        for sp in new_sum_possibles:
            for perm in itertools.permutations(sp):
                if all(val in p for val, p in zip(perm, new_possible)):
                    allowed_perms.add(perm)

        nc_set = frozenset(new_cells)
        for gt in gts:
            if frozenset(gt.cells).issubset(nc_set):
                for perm in allowed_perms.copy():
                    if not any(cell in gt.cells and perm[i] == gt.val for (i, cell) in enumerate(new_cells)):
                        allowed_perms.remove(perm)

        for i, p in enumerate(new_possible):
            p.intersection_update({perm[i] for perm in allowed_perms})
            if not p:
                raise InvalidGrid()

        intersect = frozenset.intersection(*new_sum_possibles)

        return [Guarantee(val=i, cells=array('i', (c for (c, p) in zip(new_cells, new_possible) if i in p))) for i in
                intersect]
