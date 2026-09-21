"""Consecutive-set rule used by Str8ts streets."""

from collections.abc import Iterable, MutableSequence

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied


class ConsecutiveSetRule(Rule):
    """Require cells to contain distinct consecutive values in any order.

    A length-k street must be exactly one of the intervals
    ``{a, ..., a+k-1}``. Candidate pruning keeps only values supported by at
    least one perfect matching to a feasible interval. Street sizes in
    Str8ts are at most nine, so the exact matching check is tiny.
    """

    __slots__ = ()

    def __init__(self, gsz: GridSizeContainer, cells: Iterable[int]) -> None:
        super().__init__(gsz, cells, None)
        self.cells = tuple(sorted(self.cells))
        if self.len_cells > self._max_elem:
            raise ValueError("A consecutive set cannot be longer than its value domain")

    @staticmethod
    def _matching_exists(options: tuple[frozenset[int], ...]) -> bool:
        if any(not values for values in options):
            return False
        order = tuple(sorted(range(len(options)), key=lambda i: len(options[i])))

        def visit(position: int, used: int) -> bool:
            if position == len(order):
                return True
            for value in options[order[position]]:
                bit = 1 << (value - 1)
                if not used & bit and visit(position + 1, used | bit):
                    return True
            return False

        return visit(0, 0)

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        if self.len_cells <= 1:
            raise RuleAlwaysSatisfied()

        fixed = [known[cell] for cell in self.cells]
        if all(value > 0 for value in fixed):
            if (
                len(set(fixed)) != self.len_cells
                or max(fixed) - min(fixed) != self.len_cells - 1
            ):
                raise InvalidGrid()
            raise RuleAlwaysSatisfied()

        supported = {cell: set() for cell in self.cells}
        for lower in range(1, self._max_elem - self.len_cells + 2):
            interval = frozenset(range(lower, lower + self.len_cells))
            options = tuple(
                frozenset(candidates[cell] & interval) for cell in self.cells
            )
            if not self._matching_exists(options):
                continue
            for index, cell in enumerate(self.cells):
                for value in options[index]:
                    forced = list(options)
                    forced[index] = frozenset((value,))
                    if self._matching_exists(tuple(forced)):
                        supported[cell].add(value)

        if any(not values for values in supported.values()):
            raise InvalidGrid()
        for cell, values in supported.items():
            candidates[cell].intersection_update(values)
            if not candidates[cell]:
                raise InvalidGrid()
        return False, None, None
