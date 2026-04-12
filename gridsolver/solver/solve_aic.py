from collections import deque
from typing import List, FrozenSet, Dict, Set, Tuple

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def alternating_inference_chain(grid: Grid) -> None:
    """Alternating Inference Chain (AIC) technique.

    An AIC is a chain of alternating strong and weak links that can span
    different digits. A strong link means "if A is false, B must be true."
    A weak link means "if A is true, B must be false."

    Strong links:
    - Conjugate pair: digit D in exactly 2 cells of a house → one must have D
    - Bivalue cell: cell has exactly {A, B} → if not A then B

    Weak links:
    - Same house: if cell X has D, cell Y in same house can't have D
    - Same cell: if cell has A, it can't also have B

    If a chain starts and ends on the same digit+cell with an odd number of links:
    - Start with strong link, end with strong link → the start/end must be true
    - Start with weak link, end with weak link → the start/end must be false

    More practically: if both ends of the chain see a cell Z and can eliminate
    digit D from Z, then D can be eliminated from Z.
    """
    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    houses = [grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem]
    if not houses:
        return

    # Build the link graph
    # Node: (cell, digit) tuple
    # Strong link: if node A is false → node B must be true
    # Weak link: if node A is true → node B must be false

    # Strong links from conjugate pairs (digit in exactly 2 cells of a house)
    strong: Dict[Tuple[int, int], Set[Tuple[int, int]]] = {}
    # Weak links from same-house and same-cell constraints
    weak: Dict[Tuple[int, int], Set[Tuple[int, int]]] = {}

    def _add_link(d, src, dst):
        d.setdefault(src, set()).add(dst)

    # Build strong links from conjugate pairs
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells_with_val = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            if len(cells_with_val) == 2:
                a, b = cells_with_val
                _add_link(strong, (a, val), (b, val))
                _add_link(strong, (b, val), (a, val))

    # Build strong links from bivalue cells
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) == 2:
            vals = list(cands[cell])
            _add_link(strong, (cell, vals[0]), (cell, vals[1]))
            _add_link(strong, (cell, vals[1]), (cell, vals[0]))

    # Build weak links from same-house (same digit, different cells)
    for house in houses:
        for val in range(1, grid.max_elem + 1):
            cells_with_val = [cell for cell in house if known[cell] == 0 and val in cands[cell]]
            for i, a in enumerate(cells_with_val):
                for b in cells_with_val[i + 1:]:
                    _add_link(weak, (a, val), (b, val))
                    _add_link(weak, (b, val), (a, val))

    # Build weak links from same-cell (different digits)
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) >= 2:
            vals = list(cands[cell])
            for i, a in enumerate(vals):
                for b in vals[i + 1:]:
                    _add_link(weak, (cell, a), (cell, b))
                    _add_link(weak, (cell, b), (cell, a))

    if not strong:
        return

    # Precompute: for each node, which cells see it (share a house)
    cell_peers: Dict[int, Set[int]] = {}
    for cell in range(grid.len):
        peers = set()
        for house in houses:
            if cell in house:
                peers |= house
        peers.discard(cell)
        cell_peers[cell] = peers

    # BFS for short AICs (length 3-7) starting with a strong link
    # An AIC of odd length starting and ending with strong links:
    # if both endpoints share a peer cell Z, and both endpoints have digit D,
    # then D can be eliminated from Z.
    max_chain_len = 7

    for start_node in strong:
        start_cell, start_val = start_node

        # BFS: alternate strong → weak → strong → ...
        # State: (node, is_next_strong, path_length)
        visited = {start_node}
        queue = deque()

        # First step: follow strong links from start
        for next_node in strong.get(start_node, ()):
            if next_node not in visited:
                queue.append((next_node, True, 1))  # is_next_weak=True, length=1

        while queue:
            current, is_next_weak, path_len = queue.popleft()

            if path_len >= max_chain_len:
                continue

            cur_cell, cur_val = current

            # Check for elimination: if chain ends with a strong link (is_next_weak=True)
            # and start and end have the same digit, cells seeing both can lose that digit
            if is_next_weak and path_len >= 3 and cur_val == start_val:
                # Both endpoints are "true or" — if start is false, chain propagates to
                # end being true, and vice versa. Any cell seeing both must not have this digit.
                target_cells = cell_peers.get(start_cell, set()) & cell_peers.get(cur_cell, set())
                for z in target_cells:
                    if known[z] == 0 and z != start_cell and z != cur_cell and cur_val in cands[z]:
                        _lg.logr("AIC",
                                 f"{cur_val} removed (AIC endpoints {c(start_cell)},{c(cur_cell)} "
                                 f"both see {c(z)})",
                                 c(z))
                        cands[z].discard(cur_val)
                        if not cands[z]:
                            raise InvalidGrid()
                        return  # Made progress

            # Follow next links (alternate strong/weak)
            if is_next_weak:
                next_links = weak.get(current, ())
            else:
                next_links = strong.get(current, ())

            for next_node in next_links:
                if next_node not in visited:
                    visited.add(next_node)
                    queue.append((next_node, not is_next_weak, path_len + 1))
