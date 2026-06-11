import itertools
from typing import Dict, FrozenSet, List, Tuple

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


def _full_houses(grid: Grid) -> List[FrozenSet[int]]:
    return [grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem]


def _cell_houses(grid: Grid, all_houses: List[FrozenSet[int]]) -> Dict[int, list]:
    """cell -> houses containing it; cached (houses derive from the rule set)."""
    return grid.cached_struct(
        "als_cell_houses",
        lambda: {cell: [h for h in all_houses if cell in h] for cell in range(grid.len)})


# noinspection PyProtectedMember
def _build_als_list(grid: Grid, all_houses: List[FrozenSet[int]]) -> List[Tuple[FrozenSet[int], FrozenSet[int]]]:
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


def _cells_see_each_other(cells_a: FrozenSet[int], cells_b: FrozenSet[int], cell_houses: Dict[int, list]) -> bool:
    """Check if every cell in A sees every cell in B (shares a house)."""
    for ca in cells_a:
        for cb in cells_b:
            if not any(cb in h for h in cell_houses[ca]):
                return False
    return True


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
    all_houses = _full_houses(grid)
    if not all_houses:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    unique_als = _build_als_list(grid, all_houses)
    if len(unique_als) < 2:
        return

    cell_houses = _cell_houses(grid, all_houses)

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
                if not _cells_see_each_other(x_cells_a, x_cells_b, cell_houses):
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
                            _lg.on and _lg.logr("ALS-XZ",
                                                f"{z} removed (X={x}) w/ ALS {c(sorted(cells_a))}+{c(sorted(cells_b))}",
                                                c(cell))
                            cands[cell].discard(z)
                            if not cands[cell]:
                                raise InvalidGrid()


# noinspection PyProtectedMember
def als_xy_wing(grid: Grid) -> None:
    """ALS-XY-Wing: three ALSs A, B and hinge C, pairwise disjoint.

    C shares restricted common X with A and restricted common Y with B (X != Y).
    For any digit Z common to A and B (Z not in {X, Y}): if a cell saw all
    Z-candidates of A and B and were Z, both A and B would lose Z, locking X
    into A and Y into B, stripping both X and Y from C — leaving C with N cells
    but only N-1 values. So Z can be eliminated from every cell (outside A, B
    and C) that sees all Z-cells of both A and B.

    With three single-cell ALSs this degenerates to the classic XY-Wing.
    """
    all_houses = _full_houses(grid)
    if not all_houses:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    unique_als = _build_als_list(grid, all_houses)
    if len(unique_als) < 3:
        return

    cell_houses = _cell_houses(grid, all_houses)

    # restricted-common adjacency between disjoint ALS pairs: idx -> [(other_idx, X)]
    rc_adj: Dict[int, list] = {i: [] for i in range(len(unique_als))}
    for i, (cells_a, vals_a) in enumerate(unique_als):
        for j in range(i + 1, len(unique_als)):
            cells_b, vals_b = unique_als[j]
            if cells_a & cells_b:
                continue
            for x in vals_a & vals_b:
                x_cells_a = frozenset(cell for cell in cells_a if x in cands[cell])
                x_cells_b = frozenset(cell for cell in cells_b if x in cands[cell])
                if not x_cells_a or not x_cells_b:
                    continue
                if _cells_see_each_other(x_cells_a, x_cells_b, cell_houses):
                    rc_adj[i].append((j, x))
                    rc_adj[j].append((i, x))

    for ci, (cells_c, _) in enumerate(unique_als):
        partners = rc_adj[ci]
        if len(partners) < 2:
            continue
        for (ai, x), (bi, y) in itertools.combinations(partners, 2):
            if x == y or ai == bi:
                continue
            cells_a, vals_a = unique_als[ai]
            cells_b, vals_b = unique_als[bi]
            if cells_a & cells_b:
                continue
            for z in (vals_a & vals_b) - {x, y}:
                z_cells_a = frozenset(cell for cell in cells_a if z in cands[cell])
                z_cells_b = frozenset(cell for cell in cells_b if z in cands[cell])
                if not z_cells_a or not z_cells_b:
                    continue
                all_z_cells = z_cells_a | z_cells_b
                for cell in range(grid.len):
                    if cell in cells_a or cell in cells_b or cell in cells_c:
                        continue
                    if known[cell] > 0 or z not in cands[cell]:
                        continue
                    if all(any(cell in h for h in cell_houses[zc]) for zc in all_z_cells):
                        _lg.on and _lg.logr(
                            "ALS-XY-Wing",
                            f"{z} removed (X={x},Y={y}) w/ ALS {c(sorted(cells_a))}+{c(sorted(cells_b))}"
                            f" hinge {c(sorted(cells_c))}",
                            c(cell))
                        cands[cell].discard(z)
                        if not cands[cell]:
                            raise InvalidGrid()
