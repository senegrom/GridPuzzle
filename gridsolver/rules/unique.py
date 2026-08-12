from collections.abc import Iterable, MutableSequence
from functools import lru_cache
from numbers import Integral

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, IdxType, InvalidGrid, Rule, RuleAlwaysSatisfied


@lru_cache(maxsize=256)
def _cached_value_presence_guarantees(
    cells: frozenset[int],
    max_elem: int,
    rows: int,
    cols: int,
) -> tuple[Guarantee, ...]:
    """Build one immutable guarantee family for a canonical cell set."""
    return tuple(
        Guarantee(value, cells, rows, cols)
        for value in range(1, max_elem + 1)
    )


def value_presence_guarantees(
    cells: Iterable[int],
    *,
    max_elem: int,
    rows: int,
    cols: int,
) -> tuple[Guarantee, ...]:
    """Return cached guarantees requiring every domain value in ``cells``.

    The returned objects are immutable and every member shares the same
    ``frozenset``.  Identical families may therefore be reused safely across
    puzzle instances without allocating one cell set per value.
    """
    dimensions: list[int] = []
    for name, raw_value in (
        ("max_elem", max_elem),
        ("rows", rows),
        ("cols", cols),
    ):
        if isinstance(raw_value, bool) or not isinstance(raw_value, Integral):
            raise TypeError(f"{name} must be an integer")
        value = int(raw_value)
        if value <= 0:
            raise ValueError(f"{name} must be positive")
        dimensions.append(value)
    max_elem, rows, cols = dimensions

    if isinstance(cells, (str, bytes, bytearray)):
        raise TypeError("Value-presence cells must be an iterable of integers")
    try:
        raw_cells = tuple(cells)
    except TypeError as exc:
        raise TypeError(
            "Value-presence cells must be an iterable of integers"
        ) from exc
    if not raw_cells:
        raise ValueError("Value-presence guarantees require at least one cell")

    normalized: set[int] = set()
    cell_count = rows * cols
    for raw_cell in raw_cells:
        if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
            raise TypeError("Value-presence cells must be integers")
        cell = int(raw_cell)
        if not 0 <= cell < cell_count:
            raise ValueError(
                f"Value-presence cell {cell} is outside 0..{cell_count - 1}"
            )
        normalized.add(cell)

    return _cached_value_presence_guarantees(
        frozenset(normalized),
        max_elem,
        rows,
        cols,
    )


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
        self.cells = tuple(sorted(self.cells))

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
            # Equal cell sets cannot eliminate anything.  A strict subset
            # avoids waking a whole-house presence guarantee merely to compute
            # an empty difference.
            if guarantee.cells < unknown_cells:
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
            # 93.5% of these are no-ops on enumeration workloads, and a no-op
            # -= still journals a trail snapshot; the disjoint pre-check skips
            # both (an already-empty set is disjoint, so the raise still fires)
            if not possible.isdisjoint(my_known):
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
        self.cells = tuple(sorted(self.cells))

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, tuple[Rule, ...], tuple[Guarantee, ...]]:
        return False, (), value_presence_guarantees(
            self.cells,
            max_elem=self._max_elem,
            rows=self._rows,
            cols=self._cols,
        )
