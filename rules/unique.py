import collections
import itertools

from rules.rules import *


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
