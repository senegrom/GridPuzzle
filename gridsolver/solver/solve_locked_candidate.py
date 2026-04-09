import itertools
from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def locked_candidate(grid: Grid) -> None:
    """Pointing and Claiming (Locked Candidate) technique.

    For each pair of intersecting uniqueness groups (e.g. a box and a row),
    if a candidate value within one group only appears in cells that belong to
    both groups, then that value can be eliminated from the other group's
    remaining cells (those outside the intersection).
    """
    # Only use full-size uniqueness groups (rows, cols, boxes)
    unique_rule_cells: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if len(unique_rule_cells) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    # Precompute intersecting pairs and their partitions
    pairs = []
    for g1, g2 in itertools.combinations(unique_rule_cells, 2):
        intersection = g1 & g2
        if not intersection or len(intersection) == len(g1) or len(intersection) == len(g2):
            continue
        pairs.append((tuple(g1 - intersection), tuple(g2 - intersection), tuple(intersection)))

    for g1_only, g2_only, intersection in pairs:
        for val in range(1, grid.max_elem + 1):
            # Check if val in g1 is locked to the intersection
            g1_has_val = False
            for cell in g1_only:
                if known[cell] == 0 and val in cands[cell]:
                    g1_has_val = True
                    break
            if not g1_has_val:
                # val in g1 is confined to intersection → eliminate from g2_only
                isect_has_val = False
                for cell in intersection:
                    if known[cell] == 0 and val in cands[cell]:
                        isect_has_val = True
                        break
                if isect_has_val:
                    for cell in g2_only:
                        if val in cands[cell]:
                            _lg.logr("LockedCandidate",
                                     f"{val} removed (pointing) w/ locked set {c(intersection)}",
                                     c(cell))
                            cands[cell].discard(val)

            # Check the reverse: val in g2 is locked to the intersection
            g2_has_val = False
            for cell in g2_only:
                if known[cell] == 0 and val in cands[cell]:
                    g2_has_val = True
                    break
            if not g2_has_val:
                isect_has_val = False
                for cell in intersection:
                    if known[cell] == 0 and val in cands[cell]:
                        isect_has_val = True
                        break
                if isect_has_val:
                    for cell in g1_only:
                        if val in cands[cell]:
                            _lg.logr("LockedCandidate",
                                     f"{val} removed (claiming) w/ locked set {c(intersection)}",
                                     c(cell))
                            cands[cell].discard(val)
