import itertools
from dataclasses import dataclass

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.candidate_topology import (
    CandidateTopology,
    cells_mask,
    iter_cells,
)
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


def cell_houses(
    grid: Grid,
    all_houses: list[frozenset[int]],
) -> dict[int, list[frozenset[int]]]:
    """cell -> houses containing it; cached (houses derive from the rule set)."""
    return grid.cached_rule_struct(
        "als_cell_houses",
        lambda: {
            cell: [house for house in all_houses if cell in house]
            for cell in range(grid.len)
        },
    )


# noinspection PyProtectedMember
def _build_als_list(
    grid: Grid,
    all_houses: list[frozenset[int]],
) -> list[tuple[frozenset[int], frozenset[int]]]:
    """All ALSs of size 1-3: N unsolved cells within one house holding N+1 candidates.
    Returns deduplicated (cells, values) pairs."""
    cands = grid._candidates
    known = grid._known
    all_als: list[tuple[frozenset[int], frozenset[int]]] = []

    for house in all_houses:
        unsolved = [(cell, frozenset(cands[cell])) for cell in house
                    if known[cell] == 0 and len(cands[cell]) >= 2]

        # ALS of size 1: a single cell with 2 candidates (bivalue cell)
        for cell, cell_cands in unsolved:
            if len(cell_cands) == 2:
                all_als.append((frozenset([cell]), cell_cands))

        # ALS of size 2: two cells with 3 total candidates
        for (c1, cd1), (c2, cd2) in itertools.combinations(unsolved, 2):
            union = cd1 | cd2
            if len(union) == 3:
                all_als.append((frozenset([c1, c2]), union))

        # ALS of size 3: three cells with 4 total candidates
        if len(unsolved) >= 3:
            for combo in itertools.combinations(unsolved, 3):
                cells_fs = frozenset(cell for cell, _ in combo)
                union = frozenset().union(*(cd for _, cd in combo))
                if len(union) == 4:
                    all_als.append((cells_fs, union))

    seen_als = set()
    unique_als = []
    for cells, vals in all_als:
        key = (cells, vals)
        if key not in seen_als:
            seen_als.add(key)
            unique_als.append((cells, vals))
    return unique_als


@dataclass(slots=True)
class ALSAnalysis:
    """Candidate-state ALS data shared by XZ and XY-Wing."""

    topology: CandidateTopology
    sets: tuple[tuple[frozenset[int], frozenset[int]], ...]
    set_masks: tuple[int, ...]
    value_cell_masks: tuple[dict[int, int], ...]
    value_visibility_masks: tuple[dict[int, int], ...]
    restricted_commons: dict[tuple[int, int], tuple[int, ...]]
    restricted_adjacency: tuple[tuple[tuple[int, int], ...], ...]

    @classmethod
    def build(
        cls,
        grid: Grid,
        topology: CandidateTopology | None = None,
    ) -> "ALSAnalysis":
        topology = CandidateTopology.build(grid) if topology is None else topology
        sets = tuple(_build_als_list(grid, list(topology.houses)))
        set_masks = tuple(cells_mask(cells) for cells, _ in sets)
        value_cell_masks = tuple(
            {
                value: set_mask & topology.candidate_masks[value]
                for value in values
            }
            for set_mask, (_, values) in zip(set_masks, sets)
        )
        value_visibility_masks = tuple(
            {
                value: topology.visible_from_mask(value_mask)
                for value, value_mask in positions.items()
            }
            for positions in value_cell_masks
        )

        restricted_commons: dict[tuple[int, int], tuple[int, ...]] = {}
        adjacency: list[list[tuple[int, int]]] = [
            [] for _ in range(len(sets))
        ]
        for first, (first_cells, first_values) in enumerate(sets):
            for second in range(first + 1, len(sets)):
                second_cells, second_values = sets[second]
                if first_cells & second_cells:
                    continue
                restricted = tuple(
                    value
                    for value in sorted(first_values & second_values)
                    if not value_cell_masks[second][value]
                    & ~value_visibility_masks[first][value]
                )
                if not restricted:
                    continue
                restricted_commons[(first, second)] = restricted
                for value in restricted:
                    adjacency[first].append((second, value))
                    adjacency[second].append((first, value))

        return cls(
            topology=topology,
            sets=sets,
            set_masks=set_masks,
            value_cell_masks=value_cell_masks,
            value_visibility_masks=value_visibility_masks,
            restricted_commons=restricted_commons,
            restricted_adjacency=tuple(tuple(items) for items in adjacency),
        )


# noinspection PyProtectedMember
def als_xz(grid: Grid, analysis: ALSAnalysis | None = None) -> None:
    """Almost Locked Set XZ technique.

    An ALS is a group of N cells within a single house that together contain
    exactly N+1 distinct candidate values. If one value is removed, the remaining
    N values are locked into the N cells.

    ALS-XZ: given two ALSs A and B:
    - They share a "restricted common" digit X: X appears in both ALSs, and all
      cells containing X in A can see all cells containing X in B. This means X
      can't be placed in both A and B simultaneously.
    - They share another digit Z that appears in both.
    - Since X must go in one ALS, the other ALS becomes a locked set containing Z.
    - Therefore Z can be eliminated from any cell that sees ALL Z-candidates in
      both ALSs.
    """
    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known
    analysis = ALSAnalysis.build(grid) if analysis is None else analysis
    unique_als = analysis.sets
    if len(unique_als) < 2:
        return

    for i, (cells_a, vals_a) in enumerate(unique_als):
        for j in range(i + 1, len(unique_als)):
            cells_b, vals_b = unique_als[j]
            common_vals = vals_a & vals_b
            if len(common_vals) < 2:
                continue
            for x in analysis.restricted_commons.get((i, j), ()):
                for z in sorted(common_vals):
                    if z == x:
                        continue
                    all_z_cells = (
                        analysis.value_cell_masks[i][z]
                        | analysis.value_cell_masks[j][z]
                    )
                    targets = (
                        analysis.topology.visible_from_mask(all_z_cells)
                        & analysis.topology.candidate_masks[z]
                        & ~(analysis.set_masks[i] | analysis.set_masks[j])
                    )
                    for cell in iter_cells(targets):
                        if known[cell] > 0 or z not in cands[cell]:
                            continue
                        _lg.on and _lg.logr(
                            "ALS-XZ",
                            f"{z} removed (X={x}) w/ ALS "
                            f"{c(sorted(cells_a))}+{c(sorted(cells_b))}",
                            c(cell),
                        )
                        cands[cell].discard(z)
                        if not cands[cell]:
                            raise InvalidGrid()


# noinspection PyProtectedMember
def als_xy_wing(grid: Grid, analysis: ALSAnalysis | None = None) -> None:
    """ALS-XY-Wing: three ALSs A, B and hinge C, pairwise disjoint.

    C shares restricted common X with A and restricted common Y with B (X != Y).
    For any digit Z common to A and B (Z not in {X, Y}): if a cell saw all
    Z-candidates of A and B and were Z, both A and B would lose Z, locking X
    into A and Y into B, stripping both X and Y from C — leaving C with N cells
    but only N-1 values. So Z can be eliminated from every cell (outside A, B
    and C) that sees all Z-cells of both A and B.

    With three single-cell ALSs this degenerates to the classic XY-Wing.
    """
    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known
    analysis = ALSAnalysis.build(grid) if analysis is None else analysis
    unique_als = analysis.sets
    if len(unique_als) < 3:
        return

    for ci, (cells_c, _) in enumerate(unique_als):
        partners = analysis.restricted_adjacency[ci]
        if len(partners) < 2:
            continue
        for (ai, x), (bi, y) in itertools.combinations(partners, 2):
            if x == y or ai == bi:
                continue
            cells_a, vals_a = unique_als[ai]
            cells_b, vals_b = unique_als[bi]
            if cells_a & cells_b:
                continue
            for z in sorted((vals_a & vals_b) - {x, y}):
                all_z_cells = (
                    analysis.value_cell_masks[ai][z]
                    | analysis.value_cell_masks[bi][z]
                )
                targets = (
                    analysis.topology.visible_from_mask(all_z_cells)
                    & analysis.topology.candidate_masks[z]
                    & ~(
                        analysis.set_masks[ai]
                        | analysis.set_masks[bi]
                        | analysis.set_masks[ci]
                    )
                )
                for cell in iter_cells(targets):
                    if known[cell] > 0 or z not in cands[cell]:
                        continue
                    _lg.on and _lg.logr(
                        "ALS-XY-Wing",
                        f"{z} removed (X={x},Y={y}) w/ ALS "
                        f"{c(sorted(cells_a))}+{c(sorted(cells_b))} "
                        f"hinge {c(sorted(cells_c))}",
                        c(cell),
                    )
                    cands[cell].discard(z)
                    if not cands[cell]:
                        raise InvalidGrid()
