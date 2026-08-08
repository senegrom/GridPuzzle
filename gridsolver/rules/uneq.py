from abc import ABC
from collections.abc import Iterable, MutableSequence

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import (
    Guarantee,
    IdxType,
    InvalidGrid,
    Rule,
    RuleAlwaysSatisfied,
    _format_coord,
)


class IneqRule(Rule):
    __slots__ = ("_lt_cell", "_gt_cell")

    def __init__(self, gsz: GridSizeContainer, gt_cell: IdxType, lt_cell: IdxType) -> None:
        super().__init__(gsz, [gt_cell, lt_cell], None)
        self._gt_cell, self._lt_cell = self.cells

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        possible_lt = candidates[self._lt_cell]
        possible_gt = candidates[self._gt_cell]

        # lt must be below some gt candidate; gt must be above some lt candidate.
        gt_max = max(possible_gt) if possible_gt else 0
        if possible_lt and max(possible_lt) >= gt_max:
            possible_lt.difference_update(
                tuple(value for value in possible_lt if value >= gt_max)
            )

        lt_min = min(possible_lt) if possible_lt else self._max_elem
        if possible_gt and min(possible_gt) <= lt_min:
            possible_gt.difference_update(
                tuple(value for value in possible_gt if value <= lt_min)
            )

        if not possible_lt or not possible_gt:
            raise InvalidGrid()
        if known[self._gt_cell] > 0 and 0 < known[self._lt_cell] < known[self._gt_cell]:
            raise RuleAlwaysSatisfied()
        return False, None, None

    @property
    def gt_cell(self) -> int:
        return self._gt_cell

    @property
    def lt_cell(self) -> int:
        return self._lt_cell


class SingleRelationRule(Rule, ABC):
    __slots__ = ("origin_cell", "rel_cells")

    def __init__(
        self,
        gsz: GridSizeContainer,
        origin_cell: IdxType,
        rel_cells: Iterable[IdxType],
    ) -> None:
        related = list(rel_cells)
        if not related:
            raise ValueError(f"{type(self).__name__} requires at least one related cell")

        # Preserve the distinguished origin while canonicalising the related
        # set, so equivalent input orders hash and compare identically.
        super().__init__(gsz, [origin_cell, *related], None)
        if len(self.cells) < 2:
            raise ValueError(
                f"{type(self).__name__} has no related cells inside the grid"
            )
        self.origin_cell = self.cells[0]
        self.rel_cells = frozenset(self.cells[1:])
        self.cells = (self.origin_cell, *sorted(self.rel_cells))

    def __repr__(self) -> str:
        cell_str = ", ".join(_format_coord(cell, self._rows) for cell in self.rel_cells)
        return (
            f"{type(self).__name__}["
            f"{_format_coord(self.origin_cell, self._rows)}: {cell_str}]"
        )


class UneqRule(SingleRelationRule):
    __slots__ = ()
    uses_guarantees = True

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        guarantees = () if guarantees is None else guarantees
        origin_known = known[self.origin_cell]

        if origin_known > 0:
            for possible in (candidates[cell] for cell in self.rel_cells):
                possible.discard(origin_known)
                if not possible:
                    raise InvalidGrid()

        origin_candidates = candidates[self.origin_cell]
        removed_values: set[int] = set()
        for related_known in (known[cell] for cell in self.rel_cells):
            if related_known > 0 and related_known not in removed_values:
                origin_candidates.discard(related_known)
                removed_values.add(related_known)
                if not origin_candidates:
                    raise InvalidGrid()

        interesting_guarantees = (
            guarantee
            for guarantee in guarantees
            if guarantee.val not in removed_values
            and guarantee.val in origin_candidates
            and self.rel_cells >= guarantee.cells
        )
        for guarantee in interesting_guarantees:
            origin_candidates.discard(guarantee.val)
            removed_values.add(guarantee.val)
            if not origin_candidates:
                raise InvalidGrid()

        if origin_known > 0 and all(
            0 < known[cell] != origin_known for cell in self.rel_cells
        ):
            raise RuleAlwaysSatisfied()
        return False, None, None


class DiffGe2Rule(SingleRelationRule):
    __slots__ = ()
    uses_guarantees = True

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        guarantees = () if guarantees is None else guarantees
        origin_known = known[self.origin_cell]
        origin_candidates = candidates[self.origin_cell]
        if not origin_candidates:
            raise InvalidGrid()

        def forbidden_nearby(value: int, possible: set[int]) -> set[int] | None:
            if value > 0:
                return {value - 1, value, value + 1}
            if max(possible) == min(possible) + 2:
                return {min(possible) + 1}
            if max(possible) == min(possible) + 1:
                return {min(possible), min(possible) + 1}
            return None

        forbidden = forbidden_nearby(origin_known, origin_candidates)
        if forbidden:
            for possible in (candidates[cell] for cell in self.rel_cells):
                possible -= forbidden
                if not possible:
                    raise InvalidGrid()

        for related_known, related_candidates in (
            (known[cell], candidates[cell]) for cell in self.rel_cells
        ):
            if not related_candidates:
                raise InvalidGrid()
            forbidden = forbidden_nearby(related_known, related_candidates)
            if forbidden:
                origin_candidates -= forbidden
                if not origin_candidates:
                    raise InvalidGrid()

        removed_from_relations: set[int] = set()
        removed_from_origin: set[int] = set()
        all_cells = self.rel_cells | {self.origin_cell}
        for guarantee in guarantees:
            if (
                guarantee.val not in removed_from_relations
                and self.rel_cells >= guarantee.cells
            ):
                origin_candidates -= {
                    guarantee.val - 1,
                    guarantee.val,
                    guarantee.val + 1,
                }
                removed_from_relations.add(guarantee.val)
                removed_from_origin.add(guarantee.val)
                if not origin_candidates:
                    raise InvalidGrid()
            elif (
                guarantee.val not in removed_from_origin
                and all_cells >= guarantee.cells
            ):
                origin_candidates -= {guarantee.val - 1, guarantee.val + 1}
                removed_from_origin.add(guarantee.val)
                if not origin_candidates:
                    raise InvalidGrid()

        if origin_known > 0:
            forbidden = {origin_known - 1, origin_known, origin_known + 1}
            if all(
                0 < known[cell] and known[cell] not in forbidden
                for cell in self.rel_cells
            ):
                raise RuleAlwaysSatisfied()

        return False, None, None
