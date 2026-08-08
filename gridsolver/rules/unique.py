from array import array
from collections.abc import Iterable, MutableSequence

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, IdxType, InvalidGrid, Rule, RuleAlwaysSatisfied


class ElementsAtMostOnce(Rule):
    __slots__ = ()
    uses_guarantees = True  # _update_from_guarantees (and SaEAMO's cage filter)

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator=None,
    ) -> None:
        # Call Rule directly: SumAndElementsAtMostOnce also inherits SumRule,
        # so cooperative super() would route this constructor through
        # SumRule.__init__ with the cell_creator argument as a temporary sum.
        Rule.__init__(self, gsz, cells, cell_creator)
        self.cells = array("I", sorted(self.cells))

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        my_known, new_candidates, new_candidate_cells = self._process_new_candidate_cells(
            known,
            candidates,
        )

        if len(my_known) == self.len_cells:
            raise RuleAlwaysSatisfied()

        self._update_from_guarantees(
            candidates,
            new_candidate_cells,
            () if guarantees is None else guarantees,
        )
        return False, None, None

    @staticmethod
    def _update_from_guarantees(
        candidates: tuple[set[int], ...],
        new_candidate_cells: list[int],
        guarantees: Iterable[Guarantee],
    ) -> None:
        unknown_cells = frozenset(new_candidate_cells)
        for guarantee in guarantees:
            if guarantee.cells <= unknown_cells:
                for cell in unknown_cells - guarantee.cells:
                    candidates[cell].discard(guarantee.val)
                    if not candidates[cell]:
                        raise InvalidGrid()

    def _process_new_candidate_cells(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
    ) -> tuple[set[int], list[set[int]], list[int]]:
        my_known: set[int] = set()
        new_candidates: list[set[int]] = []
        new_candidate_cells: list[int] = []
        for cell in self.cells:
            possible = candidates[cell]
            value = known[cell]

            if value > 0:
                if value in my_known:
                    possible.clear()
                    raise InvalidGrid()
                my_known.add(value)
            else:
                new_candidates.append(possible)
                new_candidate_cells.append(cell)

        for possible in new_candidates:
            possible -= my_known
            if not possible:
                raise InvalidGrid()

        return my_known, new_candidates, new_candidate_cells


class ElementsAtLeastOnce(Rule):
    __slots__ = ()

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator=None,
    ) -> None:
        Rule.__init__(self, gsz, cells, cell_creator)
        self.cells = array("I", sorted(self.cells))

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, list[Rule], list[Guarantee]]:
        return False, [], [
            Guarantee(value, frozenset(self.cells), self._rows, self._cols)
            for value in range(1, self._max_elem + 1)
        ]
