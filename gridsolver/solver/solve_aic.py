from collections import deque

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.candidate_topology import (
    CandidateTopology,
    cells_mask,
    iter_cells,
)
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


type Node = tuple[int | frozenset[int], int]


# noinspection PyProtectedMember
def alternating_inference_chain(
    grid: Grid,
    topology: CandidateTopology | None = None,
) -> None:
    """Alternating inference chains with grouped strong links."""
    cands = grid._candidates
    known = grid._known
    coord = CoordToString(grid.rows)
    topology = CandidateTopology.build(grid) if topology is None else topology
    if not topology.houses:
        return

    strong: dict[Node, set[Node]] = {}
    weak: dict[Node, set[Node]] = {}

    def add_link(links: dict[Node, set[Node]], source: Node, target: Node) -> None:
        links.setdefault(source, set()).add(target)

    # Conjugate pairs in complete houses.
    for house_mask in topology.house_masks:
        for value in range(1, grid.max_elem + 1):
            cells = house_mask & topology.candidate_masks[value]
            if cells.bit_count() == 2:
                first, second = iter_cells(cells)
                add_link(strong, (first, value), (second, value))
                add_link(strong, (second, value), (first, value))

    # Bivalue cells.
    for cell, possible in enumerate(cands):
        if known[cell] == 0 and len(possible) == 2:
            first, second = sorted(possible)
            add_link(strong, (cell, first), (cell, second))
            add_link(strong, (cell, second), (cell, first))

    # Grouped strong links formed by two sectors of a complete house.
    for house_index, house_mask in enumerate(topology.house_masks):
        for value in range(1, grid.max_elem + 1):
            value_cells = house_mask & topology.candidate_masks[value]
            if value_cells.bit_count() < 3:
                continue
            for other_index, other_mask in enumerate(topology.house_masks):
                if other_index == house_index:
                    continue
                intersection = value_cells & other_mask
                remainder = value_cells & ~intersection
                if not intersection or not remainder:
                    continue
                if intersection.bit_count() > 3 or remainder.bit_count() > 3:
                    continue

                intersection_cells = tuple(iter_cells(intersection))
                remainder_cells = tuple(iter_cells(remainder))
                first_group: int | frozenset[int] = (
                    intersection_cells[0]
                    if len(intersection_cells) == 1
                    else frozenset(intersection_cells)
                )
                second_group: int | frozenset[int] = (
                    remainder_cells[0]
                    if len(remainder_cells) == 1
                    else frozenset(remainder_cells)
                )
                add_link(
                    strong,
                    (first_group, value),
                    (second_group, value),
                )
                add_link(
                    strong,
                    (second_group, value),
                    (first_group, value),
                )

    if not strong:
        return

    # Same-value weak links within complete houses.
    for house_mask in topology.house_masks:
        for value in range(1, grid.max_elem + 1):
            cells = tuple(
                iter_cells(house_mask & topology.candidate_masks[value])
            )
            for index, first in enumerate(cells):
                for second in cells[index + 1:]:
                    add_link(weak, (first, value), (second, value))
                    add_link(weak, (second, value), (first, value))

    # Different-value weak links in one cell.
    for cell, possible in enumerate(cands):
        if known[cell] > 0 or len(possible) < 2:
            continue
        values = sorted(possible)
        for index, first in enumerate(values):
            for second in values[index + 1:]:
                add_link(weak, (cell, first), (cell, second))
                add_link(weak, (cell, second), (cell, first))

    # A grouped node is weakly linked to every same-value candidate seeing all
    # of its cells. Integer masks avoid rebuilding peer intersections per edge.
    group_nodes = {
        node for node in strong if isinstance(node[0], frozenset)
    }
    for group_node in group_nodes:
        group_cells, value = group_node
        group_mask = cells_mask(group_cells)
        targets = (
            topology.visible_from_mask(group_mask)
            & topology.candidate_masks[value]
            & ~group_mask
        )
        for target in iter_cells(targets):
            add_link(weak, group_node, (target, value))
            add_link(weak, (target, value), group_node)

    node_masks: dict[Node, int] = {}
    visibility_masks: dict[Node, int] = {}

    def node_mask(node: Node) -> int:
        try:
            return node_masks[node]
        except KeyError:
            cells, _ = node
            result = (
                cells_mask(cells)
                if isinstance(cells, frozenset)
                else 1 << cells
            )
            node_masks[node] = result
            return result

    def visibility_mask(node: Node) -> int:
        try:
            return visibility_masks[node]
        except KeyError:
            result = topology.visible_from_mask(node_mask(node))
            visibility_masks[node] = result
            return result

    max_depth = 9
    for start_node in strong:
        start_mask = node_mask(start_node)
        start_value = start_node[1]
        visited = {(start_node, False)}
        queue: deque[tuple[Node, bool, int]] = deque()

        for neighbour in strong.get(start_node, ()):
            key = (neighbour, True)
            if key not in visited:
                visited.add(key)
                queue.append((neighbour, True, 1))

        while queue:
            current, next_is_weak, depth = queue.popleft()
            current_mask = node_mask(current)
            current_value = current[1]

            if (
                next_is_weak
                and depth >= 3
                and current_value == start_value
                and current_mask != start_mask
            ):
                targets = (
                    visibility_mask(start_node)
                    & visibility_mask(current)
                    & topology.candidate_masks[current_value]
                    & ~(start_mask | current_mask)
                )
                if targets:
                    target = next(iter_cells(targets))
                    _lg.on and _lg.logr(
                        "AIC",
                        f"{current_value} removed (chain len {depth}: "
                        f"{coord(tuple(iter_cells(start_mask)))}.."
                        f"{coord(tuple(iter_cells(current_mask)))})",
                        coord(target),
                    )
                    cands[target].discard(current_value)
                    if not cands[target]:
                        raise InvalidGrid()
                    return

            if depth >= max_depth:
                continue

            if next_is_weak:
                links = weak.get(current, ())
                next_parity = False
            else:
                links = strong.get(current, ())
                next_parity = True

            for neighbour in links:
                key = (neighbour, next_parity)
                if key not in visited:
                    visited.add(key)
                    queue.append((neighbour, next_parity, depth + 1))
