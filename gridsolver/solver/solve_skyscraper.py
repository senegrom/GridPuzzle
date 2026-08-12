from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.candidate_topology import CandidateTopology, iter_cells
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def skyscraper(
    grid: Grid,
    topology: CandidateTopology | None = None,
) -> None:
    """Skyscraper over full houses using candidate and visibility bitsets."""
    topology = CandidateTopology.build(grid) if topology is None else topology
    if topology.grid is not grid:
        raise ValueError("Candidate topology belongs to another grid")
    if len(topology.houses) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    eliminations: dict[tuple[int, int], tuple[int, int]] = {}

    for value in range(1, grid.max_elem + 1):
        value_locations = topology.candidate_masks[value]
        conjugate_pairs: list[int] = []
        seen_pairs: set[int] = set()
        for house_mask in topology.house_masks:
            pair = house_mask & value_locations
            if pair.bit_count() == 2 and pair not in seen_pairs:
                seen_pairs.add(pair)
                conjugate_pairs.append(pair)

        for pair_index, first_pair in enumerate(conjugate_pairs):
            first_a, first_b = tuple(iter_cells(first_pair))
            for second_pair in conjugate_pairs[pair_index + 1 :]:
                cells4 = first_pair | second_pair
                if cells4.bit_count() != 4:
                    continue
                second_a, second_b = tuple(iter_cells(second_pair))

                for base_a, top_a in (
                    (first_a, first_b),
                    (first_b, first_a),
                ):
                    for base_b, top_b in (
                        (second_a, second_b),
                        (second_b, second_a),
                    ):
                        if not topology.house_peer_masks[base_a] & (1 << base_b):
                            continue
                        targets = (
                            topology.house_peer_masks[top_a]
                            & topology.house_peer_masks[top_b]
                            & value_locations
                            & ~cells4
                        )
                        for cell in iter_cells(targets):
                            eliminations.setdefault(
                                (cell, value),
                                (top_a, top_b),
                            )

    for (cell, value), (top_a, top_b) in eliminations.items():
        possible = cands[cell]
        if value not in possible:
            continue
        _lg.on and _lg.logr(
            "Skyscraper",
            f"{value} removed w/ tops {c(top_a)},{c(top_b)}",
            c(cell),
        )
        possible.discard(value)
        if not possible:
            raise InvalidGrid()
