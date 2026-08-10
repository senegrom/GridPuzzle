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
    extra_peer_masks: tuple[int, ...]
    candidate_masks: tuple[int, ...]
    unsolved_mask: int
    all_cells_mask: int

    @classmethod
    def build(cls, grid: Grid) -> "CandidateTopology":
        unique_groups = tuple(grid.unique_rule_cells)
        houses = tuple(
            group
            for group in unique_groups
            if len(group) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)

        def build_peer_masks() -> tuple[tuple[int, ...], tuple[int, ...]]:
            house_peers = [0] * grid.len
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    house_peers[cell] |= house_mask & ~(1 << cell)

            # Start from complete-house visibility, then add partial
            # at-most-once groups and explicit UneqRule relations.
            peers = house_peers.copy()
            for group in unique_groups:
                if len(group) == grid.max_elem:
                    continue
                group_mask = cells_mask(group)
                for cell in group:
                    peers[cell] |= group_mask & ~(1 << cell)
            for cell, links in enumerate(grid.weak_links):
                peers[cell] |= cells_mask(links)

            return tuple(house_peers), tuple(peers)

        house_peer_masks, peer_masks = grid.cached_rule_struct(
            "cell_peer_masks",
            build_peer_masks,
        )
        extra_peer_masks = tuple(
            peers & ~house_peers
            for peers, house_peers in zip(peer_masks, house_peer_masks)
        )

        all_cells_mask = (1 << grid.len) - 1
        known_mask = 0
        for cell, value in enumerate(grid._known):
            if value > 0:
                known_mask |= 1 << cell
        unsolved_mask = all_cells_mask & ~known_mask
        per_value = tuple(
            mask & unsolved_mask
            for mask in grid.candidate_masks
        )

        return cls(
            grid=grid,
            houses=houses,
            house_masks=house_masks,
            peer_masks=peer_masks,
            extra_peer_masks=extra_peer_masks,
            candidate_masks=per_value,
            unsolved_mask=unsolved_mask,
            all_cells_mask=all_cells_mask,
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
