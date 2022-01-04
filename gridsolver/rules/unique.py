import collections
import itertools
from typing import Tuple, Set, Sequence, Iterable, MutableSequence, List, Counter, FrozenSet

import gridsolver.abstract_grids.gridsize_container
from gridsolver.rules.rules import Rule, RuleAlwaysSatisfied, Guarantee, InvalidGrid, IdxType
from gridsolver.solver.solver_log import lg as _lg


class ElementsAtMostOnce(Rule):

    def __init__(self, gsz: gridsolver.abstract_grids.gridsize_container.GridSizeContainer,
                 cells: Iterable[IdxType] = None, cell_creator=None):
        cells = sorted(list(cells)) if cells is not None else None
        super().__init__(gsz, cells, cell_creator)

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        my_known, new_candidates, new_candidates_cells = self._process_new_candidate_cells(known, candidates)

        len_known = len(my_known)
        if len_known == self.len_cells:
            raise RuleAlwaysSatisfied()

        multi_occur_check(self.len_cells - len_known, new_candidates)
        ElementsAtMostOnce._update_from_guarantees(candidates, new_candidates_cells, guarantees)

        return False, None, None

    @staticmethod
    def _update_from_guarantees(candidates: Tuple[Set[int]], new_candidates_cells: List[int],
                                guarantees: Set[Guarantee]) -> None:
        npc_set = frozenset(new_candidates_cells)
        for gt in guarantees:
            if gt.cells <= npc_set:
                for cell in npc_set - gt.cells:
                    candidates[cell].discard(gt.val)

    def _process_new_candidate_cells(self, known: MutableSequence[int], candidates: Tuple[Set[int]]):
        my_known = set()
        new_candidates = []
        new_candidates_cells: List[int] = []
        for cell in self.cells:
            p = candidates[cell]
            k = known[cell]

            if k > 0:
                if k in my_known:
                    p.clear()
                    raise InvalidGrid()
                my_known.add(k)
            else:
                new_candidates.append(p)
                new_candidates_cells.append(cell)

        for p in new_candidates:
            p -= my_known
            if not p:
                raise InvalidGrid()

        return my_known, new_candidates, new_candidates_cells


def multi_occur_check(len_unknown: int, candidates: Sequence[Set[int]]) -> None:
    candidates_intg = [p for p in candidates if 1 < len(p) < len_unknown]
    candidates_ct: Counter[FrozenSet[int]] = collections.Counter()
    for p in candidates_intg:
        candidates_ct.update({frozenset(p): 1})
    pct_items = candidates_ct.items()

    for key, count in pct_items:
        _do_filter(key, count, candidates)

    for comb_ct in range(2, len_unknown):
        for combs in itertools.combinations(pct_items, comb_ct):
            count = 0
            key = set()
            for keyx, countx in combs:
                count += countx
                key |= keyx
                if countx > len(keyx):
                    raise RuntimeError("This should be unreachable.")
            if count >= len_unknown:
                continue
            _do_filter(key, count, candidates)


def _do_filter(key_, count_, candidates):
    if count_ == (len_key := len(key_)):
        for p in candidates:
            if not p <= key_ and (p & key_):
                _lg.logr("NakedTuple",
                         f"{count_} times: {set(p)} vs {set(key_)}",
                         set(key_))
                p -= key_
            if not p:
                raise InvalidGrid()
    elif count_ > len_key:
        for p in candidates:
            if p <= key_:
                _lg.logr("TooManyNakedTuple",
                         f"occuring too often - {count_} times - invalid",
                         set(p))
                p.clear()
                raise InvalidGrid()


class ElementsAtLeastOnce(Rule):

    def __init__(self, gsz: gridsolver.abstract_grids.gridsize_container.GridSizeContainer,
                 cells: Iterable[IdxType] = None, cell_creator=None):
        sorted(list(cells)) if cells is not None else None
        super().__init__(gsz, cells, cell_creator)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        return False, [], [Guarantee(val, frozenset(self.cells), self._rows, self._cols) for val in
                           range(1, self._max_elem + 1)]
