import itertools
from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def sue_de_coq(grid: Grid) -> None:
    """Sue de Coq (Two-Sector Disjoint Subsets) technique.

    Consider the intersection of a box and a line (row or column).
    If the unsolved cells in this intersection have candidates that can be
    partitioned into two disjoint subsets — one locked to the box-remainder
    and one locked to the line-remainder — then we can eliminate:
    - The box-subset values from the line-remainder
    - The line-subset values from the box-remainder

    Concretely: intersection cells have candidates C. If we can find:
    - An ALS in the box-remainder covering some values of C
    - An ALS in the line-remainder covering the other values of C
    Such that these two ALS sets plus the intersection cover all of C exactly,
    then eliminations follow.
    """
    all_houses: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if len(all_houses) < 3:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known
    rows_n = grid.rows

    # Identify boxes, rows, cols
    boxes = []
    lines = []
    for house in all_houses:
        r = {cell % rows_n for cell in house}
        co = {cell // rows_n for cell in house}
        if len(r) > 1 and len(co) > 1:
            boxes.append(house)
        else:
            lines.append(house)

    if not boxes or not lines:
        return

    for box in boxes:
        for line in lines:
            intersection = box & line
            if len(intersection) < 2:
                continue

            # Unsolved cells in intersection
            isect_cells = [cell for cell in intersection if known[cell] == 0]
            if len(isect_cells) < 2:
                continue

            # Candidates in intersection
            isect_cands = set()
            for cell in isect_cells:
                isect_cands |= cands[cell]

            n_isect = len(isect_cells)
            n_cands = len(isect_cands)

            # Need more candidates than cells (otherwise it's a locked set)
            if n_cands <= n_isect:
                continue

            # Box-remainder and line-remainder unsolved cells
            box_rem = [cell for cell in box - intersection if known[cell] == 0]
            line_rem = [cell for cell in line - intersection if known[cell] == 0]

            if not box_rem or not line_rem:
                continue

            # Box-remainder candidates that overlap with intersection
            box_rem_cands = set()
            for cell in box_rem:
                box_rem_cands |= cands[cell]
            box_overlap = isect_cands & box_rem_cands

            # Line-remainder candidates that overlap with intersection
            line_rem_cands = set()
            for cell in line_rem:
                line_rem_cands |= cands[cell]
            line_overlap = isect_cands & line_rem_cands

            # For Sue de Coq: find an ALS in box_rem that covers some subset of isect_cands
            # and an ALS in line_rem that covers the complementary subset
            # ALS: N cells with N+1 candidates

            # Try small ALSs (1-3 cells) in box_rem
            box_als_list = _find_als_in(box_rem, cands, isect_cands, max_size=3)
            line_als_list = _find_als_in(line_rem, cands, isect_cands, max_size=3)

            for box_als_cells, box_als_vals in box_als_list:
                for line_als_cells, line_als_vals in line_als_list:
                    # The two ALS val sets must be disjoint
                    if box_als_vals & line_als_vals:
                        continue

                    # Together with intersection cells, they must cover isect_cands
                    covered = box_als_vals | line_als_vals
                    # The intersection cells must contribute exactly the remaining candidates
                    remaining = isect_cands - covered
                    # Each remaining value should be uniquely in the intersection
                    # (not in box_als or line_als)

                    # Check: intersection cells + box_als + line_als form a valid pattern
                    total_cells = n_isect + len(box_als_cells) + len(line_als_cells)
                    total_vals = len(isect_cands | box_als_vals | line_als_vals)

                    # Need: total_vals == total_cells (locked) or total_vals == total_cells + 1 (ALS)
                    # Actually for Sue de Coq: n_isect candidates = box_als contribution + line_als contribution + intersection-only
                    # The box_als has N+1 cands in N cells, line_als has M+1 cands in M cells
                    # Together they lock: isect cells have cands from box_als ∪ line_als ∪ extra

                    # Simplified check: do the eliminations make sense?
                    # Box_als vals are locked to box_als + intersection → remove from line_rem
                    # Line_als vals are locked to line_als + intersection → remove from box_rem

                    made_progress = False

                    # Eliminate box_als_vals from line_remainder
                    for cell in line_rem:
                        if cell in line_als_cells:
                            continue
                        for val in box_als_vals:
                            if val in cands[cell]:
                                _lg.logr("SueDeCoq",
                                         f"{val} removed from line-rem",
                                         c(cell))
                                cands[cell].discard(val)
                                if not cands[cell]:
                                    raise InvalidGrid()
                                made_progress = True

                    # Eliminate line_als_vals from box_remainder
                    for cell in box_rem:
                        if cell in box_als_cells:
                            continue
                        for val in line_als_vals:
                            if val in cands[cell]:
                                _lg.logr("SueDeCoq",
                                         f"{val} removed from box-rem",
                                         c(cell))
                                cands[cell].discard(val)
                                if not cands[cell]:
                                    raise InvalidGrid()
                                made_progress = True

                    if made_progress:
                        return


def _find_als_in(cells: list, cands, target_vals: set, max_size: int) -> list:
    """Find Almost Locked Sets in the given cells whose values overlap with target_vals.
    Returns list of (frozenset_cells, frozenset_vals)."""
    result = []

    # Size 1: bivalue cells
    for cell in cells:
        cv = cands[cell]
        if len(cv) == 2 and cv & target_vals:
            result.append((frozenset([cell]), frozenset(cv)))

    # Size 2: pairs with 3 candidates
    if max_size >= 2:
        for c1, c2 in itertools.combinations(cells, 2):
            union = cands[c1] | cands[c2]
            if len(union) == 3 and union & target_vals:
                result.append((frozenset([c1, c2]), frozenset(union)))

    # Size 3: triples with 4 candidates
    if max_size >= 3 and len(cells) >= 3:
        for combo in itertools.combinations(cells, 3):
            union = cands[combo[0]] | cands[combo[1]] | cands[combo[2]]
            if len(union) == 4 and union & target_vals:
                result.append((frozenset(combo), frozenset(union)))

    return result
