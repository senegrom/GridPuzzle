from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def skyscraper(grid: Grid) -> None:
    """Skyscraper technique.

    Two conjugate pairs for a digit in two different houses share one endpoint
    via a common house (the "base"). Cells seeing both non-shared endpoints
    ("tops") can have the digit eliminated.
    """
    all_houses: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if len(all_houses) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    # Precompute: for each cell, which houses it belongs to
    cell_houses: dict[int, list[FrozenSet[int]]] = {}
    for cell in range(grid.len):
        cell_houses[cell] = [h for h in all_houses if cell in h]

    for val in range(1, grid.max_elem + 1):
        # Find conjugate pairs: houses where val appears in exactly 2 unsolved cells
        conj_pairs: list[tuple[int, int]] = []
        for house in all_houses:
            cells_with_val = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            if len(cells_with_val) == 2:
                conj_pairs.append((cells_with_val[0], cells_with_val[1]))

        if len(conj_pairs) < 2:
            continue

        # For each pair of conjugate pairs from DIFFERENT houses
        for i in range(len(conj_pairs)):
            a1, a2 = conj_pairs[i]
            for j in range(i + 1, len(conj_pairs)):
                b1, b2 = conj_pairs[j]

                # The 4 cells must be 4 distinct cells
                cells4 = {a1, a2, b1, b2}
                if len(cells4) < 4:
                    continue

                # Try matching base/top: one endpoint from each pair shares a house
                for base_a, top_a in ((a1, a2), (a2, a1)):
                    for base_b, top_b in ((b1, b2), (b2, b1)):
                        # base_a and base_b must share a house
                        if not any(base_b in h for h in cell_houses[base_a]):
                            continue

                        # Eliminate val from cells seeing both top_a and top_b
                        # (but not top_a or top_b themselves, and not base cells)
                        sees_top_a = set()
                        for h in cell_houses[top_a]:
                            sees_top_a |= h
                        sees_top_b = set()
                        for h in cell_houses[top_b]:
                            sees_top_b |= h

                        for cell in sees_top_a & sees_top_b - cells4:
                            if known[cell] == 0 and val in cands[cell]:
                                _lg.logr("Skyscraper",
                                         f"{val} removed w/ tops {c(top_a)},{c(top_b)}",
                                         c(cell))
                                cands[cell].discard(val)
                                if not cands[cell]:
                                    raise InvalidGrid()
