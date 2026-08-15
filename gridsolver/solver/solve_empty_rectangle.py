from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.candidate_topology import (
    CandidateTopology,
    cells_mask,
    iter_cells,
)
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def empty_rectangle(
    grid: Grid,
    topology: CandidateTopology | None = None,
) -> None:
    """Empty Rectangle generalised to untyped full houses.

    Candidate locations and house visibility come from one immutable topology
    snapshot.  The technique collects all consequences before mutation, which
    keeps the bitset view exact for every deduction made in this call.
    """
    topology = CandidateTopology.build(grid) if topology is None else topology
    topology.validate_for(grid)
    if len(topology.houses) < 3:
        return

    cands = grid._candidates
    c = CoordToString(grid.rows)
    semi_strong = grid.semi_strong_links

    def build_guarantee_masks() -> tuple[tuple[int, ...], ...]:
        masks: list[list[int]] = [
            [] for _ in range(grid.max_elem + 1)
        ]
        for guarantee in grid.guarantees:
            masks[guarantee.val].append(cells_mask(guarantee.cells))
        return tuple(tuple(items) for items in masks)

    guarantee_masks = grid.cached_guarantee_struct(
        "guarantee_masks_by_value",
        build_guarantee_masks,
    )
    eliminations: dict[
        tuple[int, int],
        tuple[int, int, tuple[int, ...]],
    ] = {}

    for box_index, box_mask in enumerate(topology.house_masks):
        for value in range(1, grid.max_elem + 1):
            value_locations = topology.candidate_masks[value]
            box_values = box_mask & value_locations
            if box_values.bit_count() < 3:
                continue
            if not any(
                guarantee_mask & ~box_mask == 0
                for guarantee_mask in guarantee_masks[value]
            ):
                continue

            touching = [
                index
                for index, house_mask in enumerate(topology.house_masks)
                if index != box_index and house_mask & box_values
            ]
            box_cells = tuple(iter_cells(box_values))
            for row_index in touching:
                row_mask = topology.house_masks[row_index]
                rest = box_values & ~row_mask
                if not rest or rest == box_values:
                    continue
                for col_index in touching:
                    if col_index == row_index:
                        continue
                    col_mask = topology.house_masks[col_index]
                    if rest & ~col_mask:
                        continue

                    for first in iter_cells(row_mask & ~box_mask):
                        for second in semi_strong[value][first]:
                            second_bit = 1 << second
                            if second_bit & box_mask:
                                continue
                            targets = (
                                col_mask
                                & ~box_mask
                                & value_locations
                                & topology.house_peer_masks[second]
                                & ~second_bit
                            )
                            for cell in iter_cells(targets):
                                eliminations.setdefault(
                                    (cell, value),
                                    (first, second, box_cells),
                                )

    for (cell, value), (first, second, box_cells) in eliminations.items():
        possible = cands[cell]
        if value not in possible:
            continue
        _lg.on and _lg.logr(
            "EmptyRectangle",
            f"{value} removed w/ ER {c(box_cells)} pair {c(first)}-{c(second)}",
            c(cell),
        )
        possible.discard(value)
        if not possible:
            raise InvalidGrid()
