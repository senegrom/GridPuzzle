from collections import deque
from typing import List, FrozenSet, Dict, Set, Tuple

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def alternating_inference_chain(grid: Grid) -> None:
    """Alternating Inference Chain (AIC) technique.

    Builds a graph of strong and weak links between (cell, digit) nodes.
    Searches for chains of odd length that start and end with strong links.
    If both endpoints have the same digit, any cell seeing both endpoints
    can have that digit eliminated.

    Strong links: conjugate pairs (digit in exactly 2 cells of a house),
                  bivalue cells (if not A then B).
    Weak links: same house (if cell has D, peer can't have D),
                same cell (if cell has A, it doesn't have B).
    """
    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    houses = [grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem]
    if not houses:
        return

    # Build link graph: node = (cell, digit)
    strong: Dict[Tuple[int, int], Set[Tuple[int, int]]] = {}
    weak: Dict[Tuple[int, int], Set[Tuple[int, int]]] = {}

    def _add(d, src, dst):
        d.setdefault(src, set()).add(dst)

    # Conjugate pairs → strong links
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            if len(cells) == 2:
                _add(strong, (cells[0], val), (cells[1], val))
                _add(strong, (cells[1], val), (cells[0], val))

    # Bivalue cells → strong links
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) == 2:
            a, b = list(cands[cell])
            _add(strong, (cell, a), (cell, b))
            _add(strong, (cell, b), (cell, a))

    if not strong:
        return

    # Same-house weak links (same digit, different cells)
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            for i, a in enumerate(cells):
                for b in cells[i + 1:]:
                    _add(weak, (a, val), (b, val))
                    _add(weak, (b, val), (a, val))

    # Same-cell weak links (different digits)
    for cell in range(grid.len):
        if known[cell] == 0:
            vals = list(cands[cell])
            for i, a in enumerate(vals):
                for b in vals[i + 1:]:
                    _add(weak, (cell, a), (cell, b))
                    _add(weak, (cell, b), (cell, a))

    # Precompute cell peers
    cell_peers: Dict[int, Set[int]] = {}
    for cell in range(grid.len):
        peers = set()
        for house in houses:
            if cell in house:
                peers |= house
        peers.discard(cell)
        cell_peers[cell] = peers

    # Search for AICs: start from each node, follow strong→weak→strong→...
    # Looking for chains where the END node has the same digit as start,
    # reached via a strong link (so both endpoints are "true or").
    # Chain: start --strong--> A --weak--> B --strong--> C --weak--> ... --strong--> end
    # Length must be odd (counted by links): 3, 5, 7

    max_depth = 7  # max number of links

    for start_node in strong:
        start_cell, start_val = start_node

        # BFS with (current_node, next_is_weak, depth)
        # Use visited per (node, parity) to allow reaching same node via different parities
        visited = set()
        visited.add((start_node, False))  # start: next link from here is strong (parity=False=strong)
        queue = deque()

        # Follow strong links from start (depth 1, next is weak)
        for nb in strong.get(start_node, ()):
            key = (nb, True)  # arrived via strong, next is weak
            if key not in visited:
                visited.add(key)
                queue.append((nb, True, 1))

        while queue:
            current, next_is_weak, depth = queue.popleft()
            cur_cell, cur_val = current

            # Check: arrived via strong link (next_is_weak=True), same digit as start,
            # different cell, depth >= 3 (at least 3 links)
            if next_is_weak and depth >= 3 and cur_val == start_val and cur_cell != start_cell:
                common_peers = cell_peers.get(start_cell, set()) & cell_peers.get(cur_cell, set())
                for z in common_peers:
                    if known[z] == 0 and z != start_cell and z != cur_cell and cur_val in cands[z]:
                        _lg.logr("AIC",
                                 f"{cur_val} removed (chain len {depth}: "
                                 f"{c(start_cell)}..{c(cur_cell)})",
                                 c(z))
                        cands[z].discard(cur_val)
                        if not cands[z]:
                            raise InvalidGrid()
                        return

            if depth >= max_depth:
                continue

            # Follow next links
            if next_is_weak:
                links = weak.get(current, ())
                next_parity = False
            else:
                links = strong.get(current, ())
                next_parity = True

            for nb in links:
                key = (nb, next_parity)
                if key not in visited:
                    visited.add(key)
                    queue.append((nb, next_parity, depth + 1))
