from abc import ABC
from array import ArrayType, array
from typing import Tuple, Set, Sequence, Iterable, MutableSequence

from gridsolver import util
from gridsolver.rules.rules import Rule, RuleAlwaysSatisfied, Guarantee, InvalidGrid, IdxType


class IneqRule(Rule):
    def __init__(self, gsz: util.GridSizeContainer, gt_cell: IdxType, lt_cell: IdxType):
        super().__init__(gsz, [gt_cell, lt_cell], None)
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


class SingleRelationRule(Rule, ABC):
    def __init__(self, gsz: util.GridSizeContainer, origin_cell: IdxType, rel_cells: Iterable[IdxType]):
        rel_cells = list(rel_cells)
        super().__init__(gsz, [origin_cell] + sorted(rel_cells), None)
        self.origin_cell: int = self.cells[0]
        self.rel_cells: ArrayType = array('i', self.cells[1:])


class UneqRule(SingleRelationRule):
    def __init__(self, gsz: util.GridSizeContainer, origin_cell: IdxType, rel_cells: Iterable[IdxType]):
        super().__init__(gsz, origin_cell, rel_cells)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Sequence[Guarantee] = None):
        k = known[self.origin_cell]

        if k > 0:
            p: Set[int]
            for p in (possible[cell] for cell in self.rel_cells):
                p.discard(k)
                if not p:
                    raise InvalidGrid()

        por: Set[int] = possible[self.origin_cell]
        removed_values = set()
        for kre in (known[cell] for cell in self.rel_cells):
            if kre > 0 and kre not in removed_values:
                por.discard(kre)
                removed_values.add(kre)
                if not por:
                    raise InvalidGrid()

        rcs = frozenset(self.rel_cells)
        for gt in guarantees:
            if gt.val not in removed_values and rcs.issuperset(gt.cells):
                por.discard(gt.val)
                removed_values.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0 and all(0 < known[cell] != k for cell in self.rel_cells):
            raise RuleAlwaysSatisfied()
        return False, None, None


class DiffGe2Rule(SingleRelationRule):
    def __init__(self, gsz: util.GridSizeContainer,
                 origin_cell: IdxType,
                 rel_cells: Iterable[IdxType]):
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
                p -= kk
                if not p:
                    raise InvalidGrid()

        for kre, pre in ((known[cell], possible[cell]) for cell in self.rel_cells):
            if not pre:
                raise InvalidGrid()
            kk = get_diff_set(kre, pre)
            if kk:
                por -= kk
                if not por:
                    raise InvalidGrid()

        removed_values1 = set()
        removed_values2 = set()
        rcs = frozenset(self.rel_cells)
        rcso = frozenset([self.origin_cell, *self.rel_cells])
        for gt in guarantees:
            gtcs = frozenset(gt.cells)
            if gt.val not in removed_values1 and rcs >= gtcs:
                por -= {gt.val - 1, gt.val, gt.val + 1}
                removed_values1.add(gt.val)
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()
            elif gt.val not in removed_values2 and rcso >= gtcs:
                por -= {gt.val - 1, gt.val + 1}
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0:
            forb = {k - 1, k, k + 1}
            if all(0 < known[cell] and known[cell] not in forb for cell in self.rel_cells):
                raise RuleAlwaysSatisfied()

        return False, None, None
