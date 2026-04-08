from typing import List, FrozenSet, Dict, Set, Optional

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def simple_coloring(grid: Grid) -> None:
    """Simple Coloring technique (Color Trap + Color Wrap).

    For each digit, build connected components of conjugate pairs (cells where the
    digit appears in exactly 2 cells of a house). Color them in 2 colors. Then:
    - Color Wrap: if two same-color cells share a house, that color is false →
      the digit goes in all opposite-color cells, remove from same-color cells.
    - Color Trap: if an uncolored cell sees cells of both colors, remove the digit.
    """
    # Only use full-size uniqueness groups (rows, cols, boxes) — not partial groups
    # like killer sudoku cages which have fewer cells than max_elem.
    unique_rule_cells: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if not unique_rule_cells:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    for val in range(1, grid.max_elem + 1):
        # Find conjugate pairs: houses where val appears in exactly 2 cells
        conjugate_pairs: List[tuple[int, int]] = []
        for house in unique_rule_cells:
            cells_with_val = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            if len(cells_with_val) == 2:
                conjugate_pairs.append((cells_with_val[0], cells_with_val[1]))

        if not conjugate_pairs:
            continue

        # Build connected components via BFS and assign 2-coloring
        colored: Dict[int, int] = {}  # cell -> color (0 or 1)
        components: List[tuple[Set[int], Set[int]]] = []  # (color0_cells, color1_cells)

        all_cells = set()
        for a, b in conjugate_pairs:
            all_cells.add(a)
            all_cells.add(b)

        # Build adjacency from conjugate pairs
        adj: Dict[int, Set[int]] = {cell: set() for cell in all_cells}
        for a, b in conjugate_pairs:
            adj[a].add(b)
            adj[b].add(a)

        for start in all_cells:
            if start in colored:
                continue

            # BFS to color this component
            color0: Set[int] = set()
            color1: Set[int] = set()
            queue = [start]
            colored[start] = 0
            color0.add(start)

            while queue:
                cell = queue.pop()
                cell_color = colored[cell]
                opp_color = 1 - cell_color
                for nb in adj[cell]:
                    if nb in colored:
                        continue
                    colored[nb] = opp_color
                    if opp_color == 0:
                        color0.add(nb)
                    else:
                        color1.add(nb)
                    queue.append(nb)

            if len(color0) + len(color1) < 2:
                continue

            components.append((color0, color1))

        # Apply Color Wrap and Color Trap for each component
        for color0, color1 in components:
            # Color Wrap: check if any house contains two same-color cells
            wrap_false_color: Optional[int] = None
            for house in unique_rule_cells:
                c0_in_house = color0 & house
                c1_in_house = color1 & house
                if len(c0_in_house) >= 2:
                    wrap_false_color = 0
                    break
                if len(c1_in_house) >= 2:
                    wrap_false_color = 1
                    break

            if wrap_false_color is not None:
                # The false color's cells cannot have val
                false_cells = color0 if wrap_false_color == 0 else color1
                for cell in false_cells:
                    if val in cands[cell]:
                        _lg.logr("ColorWrap",
                                 f"{val} removed (wrap contradiction)",
                                 c(cell))
                        cands[cell].discard(val)
                        if not cands[cell]:
                            raise InvalidGrid()
                continue  # Don't also do trap for this component

            # Color Trap: uncolored cells seeing both colors lose val
            # Precompute which houses each colored cell belongs to
            houses_of: Dict[int, List[FrozenSet[int]]] = {}
            for cell in color0 | color1:
                houses_of[cell] = [h for h in unique_rule_cells if cell in h]

            # For each uncolored cell with val as candidate
            for cell in range(grid.len):
                if cell in colored or known[cell] > 0 or val not in cands[cell]:
                    continue

                sees_color0 = any(cell in h for c0_cell in color0 for h in houses_of[c0_cell])
                sees_color1 = any(cell in h for c1_cell in color1 for h in houses_of[c1_cell])

                if sees_color0 and sees_color1:
                    _lg.logr("ColorTrap",
                             f"{val} removed (sees both colors)",
                             c(cell))
                    cands[cell].discard(val)
                    if not cands[cell]:
                        raise InvalidGrid()
