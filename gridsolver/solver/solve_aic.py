from collections import deque
from typing import List, FrozenSet, Dict, Set, Tuple, Union

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

# A node is either a single (cell, digit) or a group (frozenset_of_cells, digit)
Node = Tuple[Union[int, FrozenSet[int]], int]


# noinspection PyProtectedMember
def alternating_inference_chain(grid: Grid) -> None:
    """Alternating Inference Chain (AIC) with grouped strong links.

    Nodes: (cell_or_group, digit).
    Strong links: conjugate pairs, bivalue cells, AND grouped links from
    box-line intersections (if digit D in a house is confined to 2 sectors).
    Weak links: same house, same cell, AND group-to-cell (if a cell sees
    all cells in a group for the same digit).
    """
    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    houses = [grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem]
    if not houses:
        return

    strong: Dict[Node, Set[Node]] = {}
    weak: Dict[Node, Set[Node]] = {}

    def _add(d, src, dst):
        d.setdefault(src, set()).add(dst)

    # --- Single-cell strong links ---

    # Conjugate pairs
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            if len(cells) == 2:
                _add(strong, (cells[0], val), (cells[1], val))
                _add(strong, (cells[1], val), (cells[0], val))

    # Bivalue cells
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) == 2:
            a, b = list(cands[cell])
            _add(strong, (cell, a), (cell, b))
            _add(strong, (cell, b), (cell, a))

    # --- Grouped strong links ---
    # For each pair of houses that intersect, check if a digit's candidates
    # in one house are split into exactly 2 sectors (intersections with other houses)
    rows_n = grid.rows

    for house in houses:
        for val in range(1, grid.max_elem + 1):
            val_cells = frozenset(cell for cell in house if known[cell] == 0 and val in cands[cell])
            if len(val_cells) < 3:
                continue  # Already covered by conjugate pairs

            # Find how val_cells split across other houses
            for other_house in houses:
                if other_house is house:
                    continue
                intersection = val_cells & other_house
                if not intersection:
                    continue
                remainder = val_cells - intersection
                if not remainder:
                    continue
                # intersection and remainder form a strong link:
                # D must be in intersection OR remainder (within this house)
                if len(intersection) <= 3 and len(remainder) <= 3:
                    g1 = frozenset(intersection) if len(intersection) > 1 else next(iter(intersection))
                    g2 = frozenset(remainder) if len(remainder) > 1 else next(iter(remainder))
                    _add(strong, (g1, val), (g2, val))
                    _add(strong, (g2, val), (g1, val))

    if not strong:
        return

    # --- Weak links ---

    # Same-house (same digit, different cells)
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            for i, a in enumerate(cells):
                for b in cells[i + 1:]:
                    _add(weak, (a, val), (b, val))
                    _add(weak, (b, val), (a, val))

    # Same-cell (different digits)
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) >= 2:
            vals = list(cands[cell])
            for i, a in enumerate(vals):
                for b in vals[i + 1:]:
                    _add(weak, (cell, a), (cell, b))
                    _add(weak, (cell, b), (cell, a))

    # Group-to-cell weak links: if a cell sees ALL cells in a group (same digit)
    # then group being true → cell can't have that digit
    all_group_nodes = set()
    for node in strong:
        if isinstance(node[0], frozenset):
            all_group_nodes.add(node)

    for gnode in all_group_nodes:
        group_cells, val = gnode
        # Find cells that see ALL cells in the group and have val as candidate
        common_peers = None
        for gc in group_cells:
            peers = set()
            for house in houses:
                if gc in house:
                    peers |= house
            peers.discard(gc)
            if common_peers is None:
                common_peers = peers
            else:
                common_peers &= peers
        if common_peers:
            for peer in common_peers:
                if known[peer] == 0 and val in cands[peer] and peer not in group_cells:
                    _add(weak, gnode, (peer, val))
                    _add(weak, (peer, val), gnode)

    # --- Precompute cell peers ---
    cell_peers: Dict[int, Set[int]] = {}
    for cell in range(grid.len):
        peers = set()
        for house in houses:
            if cell in house:
                peers |= house
        peers.discard(cell)
        cell_peers[cell] = peers

    def _get_cells(node: Node) -> Set[int]:
        """Get the cell(s) of a node."""
        n, _ = node
        if isinstance(n, frozenset):
            return n
        return {n}

    def _cells_see_all(target_cell: int, node: Node) -> bool:
        """Check if target_cell sees all cells in node."""
        for nc in _get_cells(node):
            if nc not in cell_peers.get(target_cell, set()):
                return False
        return True

    # --- BFS for AICs ---
    max_depth = 9

    for start_node in strong:
        start_cells = _get_cells(start_node)
        start_val = start_node[1]

        visited = set()
        visited.add((start_node, False))
        queue = deque()

        for nb in strong.get(start_node, ()):
            key = (nb, True)
            if key not in visited:
                visited.add(key)
                queue.append((nb, True, 1))

        while queue:
            current, next_is_weak, depth = queue.popleft()
            cur_cells = _get_cells(current)
            cur_val = current[1]

            # Check: arrived via strong link, same digit as start, different cells
            if next_is_weak and depth >= 3 and cur_val == start_val and cur_cells != start_cells:
                # Find cells that see ALL cells in both endpoints
                for z in range(grid.len):
                    if known[z] == 0 and z not in start_cells and z not in cur_cells \
                            and cur_val in cands[z]:
                        if _cells_see_all(z, start_node) and _cells_see_all(z, current):
                            _lg.logr("AIC",
                                     f"{cur_val} removed (chain len {depth}: "
                                     f"{c(sorted(start_cells))}..{c(sorted(cur_cells))})",
                                     c(z))
                            cands[z].discard(cur_val)
                            if not cands[z]:
                                raise InvalidGrid()
                            return

            if depth >= max_depth:
                continue

            if next_is_weak:
                links = weak.get(current, ())
                next_par = False
            else:
                links = strong.get(current, ())
                next_par = True

            for nb in links:
                key = (nb, next_par)
                if key not in visited:
                    visited.add(key)
                    queue.append((nb, next_par, depth + 1))
