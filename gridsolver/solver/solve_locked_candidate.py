import itertools

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
def locked_candidate(
    grid: Grid,
    topology: CandidateTopology | None = None,
) -> None:
    """Pointing and claiming over full all-different houses.

    Candidate locations are read from the grid's incremental per-value index.
    All eliminations are collected from one immutable state before mutation, so
    later deductions in this call never depend on stale bitsets.
    """
    topology = CandidateTopology.build(grid) if topology is None else topology
    topology.validate_for(grid)
    if len(topology.houses) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates

    def build_pairs() -> tuple[tuple[int, int, int, tuple[int, ...]], ...]:
        result = []
        for first, second in itertools.combinations(topology.houses, 2):
            intersection = first & second
            if (
                not intersection
                or len(intersection) == len(first)
                or len(intersection) == len(second)
            ):
                continue
            result.append(
                (
                    cells_mask(first - intersection),
                    cells_mask(second - intersection),
                    cells_mask(intersection),
                    tuple(sorted(intersection)),
                )
            )
        return tuple(result)

    pairs = grid.cached_rule_struct(
        "locked_candidate_mask_pairs",
        build_pairs,
    )
    eliminations: dict[tuple[int, int], tuple[str, tuple[int, ...]]] = {}

    for first_only, second_only, intersection, intersection_cells in pairs:
        for value in range(1, grid.max_elem + 1):
            locations = topology.candidate_masks[value]
            if not locations & intersection:
                continue
            if not locations & first_only:
                for cell in iter_cells(locations & second_only):
                    eliminations.setdefault(
                        (cell, value),
                        ("pointing", intersection_cells),
                    )
            if not locations & second_only:
                for cell in iter_cells(locations & first_only):
                    eliminations.setdefault(
                        (cell, value),
                        ("claiming", intersection_cells),
                    )

    for (cell, value), (mode, intersection) in eliminations.items():
        possible = cands[cell]
        if value not in possible:
            continue
        _lg.on and _lg.logr(
            "LockedCandidate",
            f"{value} removed ({mode}) w/ locked set {c(intersection)}",
            c(cell),
        )
        possible.discard(value)
        if not possible:
            raise InvalidGrid()
