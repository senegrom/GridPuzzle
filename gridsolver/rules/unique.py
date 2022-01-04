from typing import Tuple, Set, Iterable, MutableSequence, List

import gridsolver.abstract_grids.gridsize_container
from gridsolver.rules.rules import Rule, RuleAlwaysSatisfied, Guarantee, InvalidGrid, IdxType


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


class ElementsAtLeastOnce(Rule):

    def __init__(self, gsz: gridsolver.abstract_grids.gridsize_container.GridSizeContainer,
                 cells: Iterable[IdxType] = None, cell_creator=None):
        sorted(list(cells)) if cells is not None else None
        super().__init__(gsz, cells, cell_creator)

    def apply(self, known: MutableSequence[int], possible: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        return False, [], [Guarantee(val, frozenset(self.cells), self._rows, self._cols) for val in
                           range(1, self._max_elem + 1)]
