from abc import ABC
from typing import Tuple, Set, Iterable, MutableSequence, FrozenSet, Optional

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Rule, RuleAlwaysSatisfied, Guarantee, InvalidGrid, IdxType, _format_coord


class IneqRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', '_lt_cell', '_gt_cell')

    def __init__(self, gsz: GridSizeContainer, gt_cell: IdxType, lt_cell: IdxType):
        super().__init__(gsz, [gt_cell, lt_cell], None)
        self._gt_cell, self._lt_cell = self.cells

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        plt = candidates[self._lt_cell]
        pgt = candidates[self._gt_cell]
        plt.intersection_update(range(1, max(pgt, default=0)))
        pgt.intersection_update(range(min(plt, default=self._max_elem) + 1, self._max_elem + 1))
        if not plt or not pgt:
            raise InvalidGrid()
        if known[self._gt_cell] > 0 and 0 < known[self._lt_cell] < known[self._gt_cell]:
            raise RuleAlwaysSatisfied()
        return False, None, None


class SingleRelationRule(Rule, ABC):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'origin_cell', 'rel_cells')

    def __init__(self, gsz: GridSizeContainer, origin_cell: IdxType,
                 rel_cells: Iterable[IdxType]):
        rel_cells = list(rel_cells)
        super().__init__(gsz, [origin_cell] + sorted(rel_cells), None)
        self.origin_cell: int = self.cells[0]
        self.rel_cells: FrozenSet[int] = frozenset(self.cells[1:])

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.rel_cells)
        return f"{type(self).__name__}[{_format_coord(self.origin_cell, self._rows)}: {cell_str}]"


class UneqRule(SingleRelationRule):
    def __init__(self, gsz: GridSizeContainer, origin_cell: IdxType,
                 rel_cells: Iterable[IdxType]):
        super().__init__(gsz, origin_cell, rel_cells)

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        k = known[self.origin_cell]

        if k > 0:
            p: Set[int]
            for p in (candidates[cell] for cell in self.rel_cells):
                p.discard(k)
                if not p:
                    raise InvalidGrid()

        por: Set[int] = candidates[self.origin_cell]
        removed_values = set()
        for kre in (known[cell] for cell in self.rel_cells):
            if kre > 0 and kre not in removed_values:
                por.discard(kre)
                removed_values.add(kre)
                if not por:
                    raise InvalidGrid()

        for gt in guarantees:
            if gt.val not in removed_values and self.rel_cells >= gt.cells:
                por.discard(gt.val)
                removed_values.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0 and all(0 < known[cell] != k for cell in self.rel_cells):
            raise RuleAlwaysSatisfied()
        return False, None, None


class DiffGe2Rule(SingleRelationRule):
    def __init__(self, gsz: GridSizeContainer, origin_cell: IdxType, rel_cells: Iterable[IdxType]):
        SingleRelationRule.__init__(self, gsz, origin_cell, rel_cells)

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        k = known[self.origin_cell]
        por = candidates[self.origin_cell]
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
            for p in (candidates[cell] for cell in self.rel_cells):
                p -= kk
                if not p:
                    raise InvalidGrid()

        for kre, pre in ((known[cell], candidates[cell]) for cell in self.rel_cells):
            if not pre:
                raise InvalidGrid()
            kk = get_diff_set(kre, pre)
            if kk:
                por -= kk
                if not por:
                    raise InvalidGrid()

        removed_values1 = set()
        removed_values2 = set()

        rcso = self.rel_cells.union([self.origin_cell])
        for gt in guarantees:
            if gt.val not in removed_values1 and self.rel_cells >= gt.cells:
                por -= {gt.val - 1, gt.val, gt.val + 1}
                removed_values1.add(gt.val)
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()
            elif gt.val not in removed_values2 and rcso >= gt.cells:
                por -= {gt.val - 1, gt.val + 1}
                removed_values2.add(gt.val)
                if not por:
                    raise InvalidGrid()

        if k > 0:
            forb = {k - 1, k, k + 1}
            if all(0 < known[cell] and known[cell] not in forb for cell in self.rel_cells):
                raise RuleAlwaysSatisfied()

        return False, None, None
