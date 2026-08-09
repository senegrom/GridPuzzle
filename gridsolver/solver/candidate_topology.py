"""Candidate-state topology shared by advanced deduction techniques."""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from gridsolver.abstract_grids.grid import Grid


def cells_mask(cells: Iterable[int]) -> int:
    mask = 0
    for cell in cells:
        mask |= 1 << cell
    return mask


def iter_cells(mask: int) -> Iterator[int]:
    while mask:
        bit = mask & -mask
        yield bit.bit_length() - 1
        mask ^= bit


@dataclass(slots=True)
class CandidateTopology:
    """Static peer masks plus one immutable view of candidate locations."""

    grid: Grid
    houses: tuple[frozenset[int], ...]
    house_masks: tuple[int, ...]
    peer_masks: tuple[int, ...]
    candidate_masks: tuple[int, ...]
    unsolved_mask: int
    all_cells_mask: int

    @classmethod
    def build(cls, grid: Grid) -> "CandidateTopology":
        houses = tuple(
            house
            for house in grid.unique_rule_cells
            if len(house) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)

        def build_peer_masks() -> tuple[int, ...]:
            peers = [0] * grid.len
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    peers[cell] |= house_mask & ~(1 << cell)
            return tuple(peers)

        peer_masks = grid.cached_rule_struct(
            "cell_peer_masks",
            build_peer_masks,
        )

        per_value = [0] * (grid.max_elem + 1)
        unsolved_mask = 0
        for cell, possible in enumerate(grid._candidates):
            if grid._known[cell] > 0:
                continue
            bit = 1 << cell
            unsolved_mask |= bit
            for value in possible:
                per_value[value] |= bit

        return cls(
            grid=grid,
            houses=houses,
            house_masks=house_masks,
            peer_masks=peer_masks,
            candidate_masks=tuple(per_value),
            unsolved_mask=unsolved_mask,
            all_cells_mask=(1 << grid.len) - 1,
        )

    def visible_from_mask(self, source_mask: int) -> int:
        """Cells seeing every source cell."""
        if not source_mask:
            return 0
        visible = self.all_cells_mask
        for cell in iter_cells(source_mask):
            visible &= self.peer_masks[cell]
            if not visible:
                break
        return visible
