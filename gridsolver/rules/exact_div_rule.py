from typing import Iterable, MutableSequence, Optional, Set, Tuple

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, IdxType, InvalidGrid, Rule, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import DivRule


class ExactDivRule(DivRule):
    """A two-cell division rule implemented without floating-point arithmetic.

    KenKen values are integers.  Comparing quotients through ``/`` loses
    precision for sufficiently large values, while multiplication and
    ``divmod`` remain exact for arbitrary-size Python integers.
    """

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if target <= 0:
            raise ValueError("Division targets must be positive")
        if cells is not None:
            cells = list(cells)
            if len(cells) != 2:
                raise ValueError("Division cages must contain exactly two cells")
        super().__init__(gsz=gsz, cells=cells, target=target)

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]],
              guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
        first_cell, second_cell = self.cells
        first = known[first_cell]
        second = known[second_cell]

        if first > 0 and second > 0:
            if first == second * self.div or second == first * self.div:
                raise RuleAlwaysSatisfied()
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)

        if first > 0:
            allowed = {first * self.div}
            quotient, remainder = divmod(first, self.div)
            if remainder == 0:
                allowed.add(quotient)
            candidates[second_cell].intersection_update(allowed)
            if not candidates[second_cell]:
                raise InvalidGrid()
            if len(candidates[second_cell]) == 1:
                raise RuleAlwaysSatisfied()

        elif second > 0:
            allowed = {second * self.div}
            quotient, remainder = divmod(second, self.div)
            if remainder == 0:
                allowed.add(quotient)
            candidates[first_cell].intersection_update(allowed)
            if not candidates[first_cell]:
                raise InvalidGrid()
            if len(candidates[first_cell]) == 1:
                raise RuleAlwaysSatisfied()

        for cell, other_cell in ((first_cell, second_cell), (second_cell, first_cell)):
            other_candidates = candidates[other_cell]
            for value in tuple(candidates[cell]):
                multiplied = value * self.div
                quotient, remainder = divmod(value, self.div)
                if multiplied not in other_candidates and (remainder != 0 or quotient not in other_candidates):
                    candidates[cell].discard(value)
            if not candidates[cell]:
                raise InvalidGrid()

        return False, None, []
