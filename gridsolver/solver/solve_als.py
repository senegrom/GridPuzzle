import itertools
from typing import List, FrozenSet, Set

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def als_xz(grid: Grid) -> None:
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
    all_houses: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if not all_houses:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    # Build all ALSs: for each house, find subsets of N unsolved cells with N+1 candidates
    all_als: list[tuple[frozenset[int], frozenset[int], FrozenSet[int]]] = []
    # Each ALS: (cells, values, house)

    for house in all_houses:
        unsolved = [(cell, frozenset(cands[cell])) for cell in house
                    if known[cell] == 0 and len(cands[cell]) >= 2]

        # ALS of size 1: a single cell with 2 candidates (bivalue cell)
        for cell, cell_cands in unsolved:
            if len(cell_cands) == 2:
                all_als.append((frozenset([cell]), cell_cands, house))

        # ALS of size 2: two cells with 3 total candidates
        for (c1, cd1), (c2, cd2) in itertools.combinations(unsolved, 2):
            union = cd1 | cd2
            if len(union) == 3:
                all_als.append((frozenset([c1, c2]), union, house))

        # ALS of size 3: three cells with 4 total candidates
        if len(unsolved) >= 3:
            for combo in itertools.combinations(unsolved, 3):
                cells_fs = frozenset(cell for cell, _ in combo)
                union = frozenset().union(*(cd for _, cd in combo))
                if len(union) == 4:
                    all_als.append((cells_fs, union, combo[0][1]))  # house doesn't matter much

    if len(all_als) < 2:
        return

    # Deduplicate ALSs by (cells, values)
    seen_als = set()
    unique_als = []
    for cells, vals, house in all_als:
        key = (cells, vals)
        if key not in seen_als:
            seen_als.add(key)
            unique_als.append((cells, vals))

    # Precompute: for each cell, which houses it belongs to
    cell_houses: dict[int, list[FrozenSet[int]]] = {}
    for cell in range(grid.len):
        cell_houses[cell] = [h for h in all_houses if cell in h]

    def cells_see_each_other(cells_a: frozenset, cells_b: frozenset) -> bool:
        """Check if every cell in A sees every cell in B (share a house)."""
        for ca in cells_a:
            for cb in cells_b:
                if not any(cb in h for h in cell_houses[ca]):
                    return False
        return True

    # Check all ALS pairs
    for i, (cells_a, vals_a) in enumerate(unique_als):
        for cells_b, vals_b in unique_als[i + 1:]:
            # ALSs must not overlap
            if cells_a & cells_b:
                continue

            common_vals = vals_a & vals_b
            if len(common_vals) < 2:
                continue  # Need at least X and Z

            # Find restricted common digits X
            for x in common_vals:
                x_cells_a = frozenset(cell for cell in cells_a if x in cands[cell])
                x_cells_b = frozenset(cell for cell in cells_b if x in cands[cell])

                if not x_cells_a or not x_cells_b:
                    continue

                # X is restricted common if all X-cells in A see all X-cells in B
                if not cells_see_each_other(x_cells_a, x_cells_b):
                    continue

                # Found restricted common X. Now for each other common digit Z:
                for z in common_vals:
                    if z == x:
                        continue

                    z_cells_a = frozenset(cell for cell in cells_a if z in cands[cell])
                    z_cells_b = frozenset(cell for cell in cells_b if z in cands[cell])

                    if not z_cells_a or not z_cells_b:
                        continue

                    all_z_cells = z_cells_a | z_cells_b

                    # Eliminate Z from cells that see ALL z-cells in both ALSs
                    for cell in range(grid.len):
                        if cell in cells_a or cell in cells_b:
                            continue
                        if known[cell] > 0 or z not in cands[cell]:
                            continue
                        # Cell must see every z-cell
                        if all(any(cell in h for h in cell_houses[zc]) for zc in all_z_cells):
                            _lg.logr("ALS-XZ",
                                     f"{z} removed (X={x}) w/ ALS {c(sorted(cells_a))}+{c(sorted(cells_b))}",
                                     c(cell))
                            cands[cell].discard(z)
                            if not cands[cell]:
                                raise InvalidGrid()
