import itertools
from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def sue_de_coq(grid: Grid) -> None:
    """Sue de Coq (Two-Sector Disjoint Subsets) technique.

    Consider intersection I of a box B and a line L (row/column), with n_I unsolved cells
    and candidate union C_I. Find:
    - ALS_B: n_B cells in box-remainder with (n_B+1) candidates V_B
    - ALS_L: n_L cells in line-remainder with (n_L+1) candidates V_L

    Conditions:
    - V_B ∩ V_L = ∅ (disjoint)
    - |V_B ∩ C_I| + |V_L ∩ C_I| = |C_I| - n_I + 2  (locked set equation)

    Eliminations:
    - V_B values locked to ALS_B ∪ I within box → eliminate V_B from box-remainder - ALS_B
    - V_L values locked to ALS_L ∪ I within line → eliminate V_L from line-remainder - ALS_L
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

    # Separate into boxes and lines
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
            if not intersection:
                continue

            # Unsolved cells in intersection
            isect_cells = [cell for cell in intersection if known[cell] == 0]
            n_I = len(isect_cells)
            if n_I < 2:
                continue

            # Candidates in intersection
            C_I = set()
            for cell in isect_cells:
                C_I |= cands[cell]

            if len(C_I) <= n_I:
                continue  # Already a locked set, nothing to do

            # Box-remainder and line-remainder unsolved cells
            box_rem = [cell for cell in box - intersection if known[cell] == 0]
            line_rem = [cell for cell in line - intersection if known[cell] == 0]

            if not box_rem or not line_rem:
                continue

            # Required: |V_B ∩ C_I| + |V_L ∩ C_I| = |C_I| - n_I + 2
            required_overlap = len(C_I) - n_I + 2

            # Find ALSs in box-remainder and line-remainder
            box_als_list = _find_als(box_rem, cands, C_I)
            line_als_list = _find_als(line_rem, cands, C_I)

            for box_als_cells, box_als_vals in box_als_list:
                box_overlap = box_als_vals & C_I
                box_overlap_count = len(box_overlap)
                needed_line_overlap = required_overlap - box_overlap_count
                if needed_line_overlap < 1:
                    continue

                for line_als_cells, line_als_vals in line_als_list:
                    # Disjoint check
                    if box_als_vals & line_als_vals:
                        continue

                    line_overlap = line_als_vals & C_I
                    line_overlap_count = len(line_overlap)
                    if line_overlap_count != needed_line_overlap:
                        continue

                    # Verify the overlaps don't share values
                    if box_overlap & line_overlap:
                        continue

                    # Valid Sue de Coq! Apply eliminations.
                    made_progress = False

                    # V_B locked to ALS_B ∪ I within box
                    # → eliminate V_B from box-remainder cells NOT in ALS_B
                    for cell in box_rem:
                        if cell in box_als_cells:
                            continue
                        for val in box_als_vals:
                            if val in cands[cell]:
                                _lg.logr("SueDeCoq",
                                         f"{val} removed from box-rem (locked to ALS+intersection)",
                                         c(cell))
                                cands[cell].discard(val)
                                if not cands[cell]:
                                    raise InvalidGrid()
                                made_progress = True

                    # V_L locked to ALS_L ∪ I within line
                    # → eliminate V_L from line-remainder cells NOT in ALS_L
                    for cell in line_rem:
                        if cell in line_als_cells:
                            continue
                        for val in line_als_vals:
                            if val in cands[cell]:
                                _lg.logr("SueDeCoq",
                                         f"{val} removed from line-rem (locked to ALS+intersection)",
                                         c(cell))
                                cands[cell].discard(val)
                                if not cands[cell]:
                                    raise InvalidGrid()
                                made_progress = True

                    if made_progress:
                        return


def _find_als(cells: list, cands, target_vals: set) -> list:
    """Find Almost Locked Sets in the given cells whose values overlap with target_vals.
    Returns list of (frozenset_cells, frozenset_vals)."""
    result = []

    # Size 1: bivalue cells (1 cell, 2 candidates = ALS)
    for cell in cells:
        cv = cands[cell]
        if len(cv) == 2 and (cv & target_vals):
            result.append((frozenset([cell]), frozenset(cv)))

    # Size 2: pairs with 3 candidates (2 cells, 3 candidates = ALS)
    if len(cells) >= 2:
        for c1, c2 in itertools.combinations(cells, 2):
            union = cands[c1] | cands[c2]
            if len(union) == 3 and (union & target_vals):
                result.append((frozenset([c1, c2]), frozenset(union)))

    # Size 3: triples with 4 candidates (3 cells, 4 candidates = ALS)
    if len(cells) >= 3:
        for combo in itertools.combinations(cells, 3):
            union = cands[combo[0]] | cands[combo[1]] | cands[combo[2]]
            if len(union) == 4 and (union & target_vals):
                result.append((frozenset(combo), frozenset(union)))

    return result
