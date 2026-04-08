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
    # Only use full-size uniqueness groups (rows, cols, boxes) — not partial groups like
    # killer sudoku cages, which have fewer cells than max_elem.
    unique_rule_cells: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if len(unique_rule_cells) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    # Precompute: for each group, which values are still candidates and where
    # We only need pairs of groups that actually overlap
    for g1, g2 in itertools.combinations(unique_rule_cells, 2):
        intersection = g1 & g2
        if not intersection or len(intersection) == len(g1) or len(intersection) == len(g2):
            # No overlap, or one is subset of the other — skip
            continue

        g1_only = g1 - intersection
        g2_only = g2 - intersection

        for val in range(1, grid.max_elem + 1):
            # Check if val in g1 is locked to the intersection
            # (all occurrences of val in g1 are within g1 & g2)
            val_in_g1_only = any(val in cands[cell] and known[cell] == 0 for cell in g1_only)
            if not val_in_g1_only:
                # val in g1 is confined to intersection → eliminate from g2_only (Pointing)
                val_in_intersection = any(val in cands[cell] and known[cell] == 0 for cell in intersection)
                if val_in_intersection:
                    for cell in g2_only:
                        if val in cands[cell]:
                            _lg.logr(f"LockedCandidate",
                                     f"{val} removed (pointing) w/ locked set {c(intersection)}",
                                     c(cell))
                            cands[cell].discard(val)

            # Check the reverse: val in g2 is locked to the intersection
            val_in_g2_only = any(val in cands[cell] and known[cell] == 0 for cell in g2_only)
            if not val_in_g2_only:
                val_in_intersection = any(val in cands[cell] and known[cell] == 0 for cell in intersection)
                if val_in_intersection:
                    for cell in g1_only:
                        if val in cands[cell]:
                            _lg.logr(f"LockedCandidate",
                                     f"{val} removed (claiming) w/ locked set {c(intersection)}",
                                     c(cell))
                            cands[cell].discard(val)
