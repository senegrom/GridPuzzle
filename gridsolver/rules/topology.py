"""Reusable graph and cardinality constraints for non-Sudoku puzzle families."""

from collections import deque
from collections.abc import Iterable, MutableSequence
from numbers import Integral

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied


class ConsecutiveAdjacencyRule(Rule):
    """Require consecutive values to occupy adjacent cells.

    In addition to local predecessor/successor support, the rule uses graph
    distances from fixed clues. A candidate ``v`` at cell ``c`` is impossible
    when a fixed clue ``k`` is farther than ``abs(v-k)`` steps away. On
    bipartite graphs (including Numbrix's orthogonal grid), path-length parity
    is also enforced.
    """

    __slots__ = (
        "adjacency",
        "_adjacency_by_cell",
        "_distances",
        "_bipartite",
    )

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[int],
        adjacency: Iterable[Iterable[int]],
    ) -> None:
        raw_cells = tuple(cells)
        raw_adjacency = tuple(tuple(neighbours) for neighbours in adjacency)
        if len(raw_cells) != len(raw_adjacency):
            raise ValueError("Adjacency must contain one entry per rule cell")

        super().__init__(gsz, raw_cells, None)
        if self.len_cells != self._max_elem:
            raise ValueError(
                "Consecutive adjacency requires one cell for every domain value"
            )

        cell_set = frozenset(self.cells)
        normalized: list[tuple[int, ...]] = []
        for cell, neighbours in zip(self.cells, raw_adjacency):
            items: set[int] = set()
            for neighbour in neighbours:
                if isinstance(neighbour, bool) or not isinstance(
                    neighbour,
                    Integral,
                ):
                    raise TypeError("Adjacency cells must be integers")
                neighbour = int(neighbour)
                if neighbour not in cell_set:
                    raise ValueError(
                        f"Adjacency cell {neighbour} is outside the rule cell set"
                    )
                if neighbour == cell:
                    raise ValueError("A cell cannot be adjacent to itself")
                items.add(neighbour)
            normalized.append(tuple(sorted(items)))

        by_cell = dict(zip(self.cells, normalized))
        for cell, neighbours in by_cell.items():
            for neighbour in neighbours:
                if cell not in by_cell[neighbour]:
                    raise ValueError("Consecutive adjacency must be symmetric")

        if self.len_cells > 1 and any(not neighbours for neighbours in normalized):
            raise ValueError(
                "Consecutive-path adjacency graph must be connected; every path cell needs a neighbour"
            )

        cell_count = self._rows * self._cols
        adjacency_by_cell: list[tuple[int, ...]] = [()] * cell_count
        for cell, neighbours in by_cell.items():
            adjacency_by_cell[cell] = neighbours
        self.adjacency = tuple(normalized)
        self._adjacency_by_cell = tuple(adjacency_by_cell)

        colours: dict[int, int] = {}
        bipartite = True
        if self.cells:
            start = self.cells[0]
            colours[start] = 0
            queue = deque((start,))
            while queue:
                cell = queue.popleft()
                for neighbour in by_cell[cell]:
                    if neighbour not in colours:
                        colours[neighbour] = 1 - colours[cell]
                        queue.append(neighbour)
                    elif colours[neighbour] == colours[cell]:
                        bipartite = False
        if len(colours) != self.len_cells:
            raise ValueError("Consecutive-path adjacency graph must be connected")
        self._bipartite = bipartite

        distance_rows: list[tuple[int, ...]] = [()] * cell_count
        for source in self.cells:
            distances = [-1] * cell_count
            distances[source] = 0
            queue = deque((source,))
            while queue:
                cell = queue.popleft()
                next_distance = distances[cell] + 1
                for neighbour in by_cell[cell]:
                    if distances[neighbour] < 0:
                        distances[neighbour] = next_distance
                        queue.append(neighbour)
            distance_rows[source] = tuple(distances)
        self._distances = tuple(distance_rows)

    def _compatible_distance(
        self,
        first_cell: int,
        second_cell: int,
        steps: int,
    ) -> bool:
        distance = self._distances[first_cell][second_cell]
        if distance < 0 or distance > steps:
            return False
        return not self._bipartite or (distance - steps) % 2 == 0

    def _prune_layered_intervals(
        self,
        candidates: tuple[set[int], ...],
        fixed: dict[int, int],
    ) -> None:
        """Keep only candidates lying on a supported value-layer path.

        This layered graph relaxes the all-different constraint, so anything
        removed here is impossible in every real Hamiltonian path solution.
        """
        maximum = self._max_elem
        positions = {
            value: {
                cell
                for cell in self.cells
                if value in candidates[cell]
            }
            for value in range(1, maximum + 1)
        }
        if any(not cells for cells in positions.values()):
            raise InvalidGrid()

        anchors: dict[int, set[int]] = {
            1: set(positions[1]),
            maximum: set(positions[maximum]),
        }
        anchors.update({value: {cell} for value, cell in fixed.items()})
        ordered = sorted(anchors.items())

        for (lower, lower_cells), (upper, upper_cells) in zip(
            ordered,
            ordered[1:],
        ):
            if upper <= lower:
                continue

            forward: dict[int, set[int]] = {lower: set(lower_cells)}
            for value in range(lower + 1, upper + 1):
                previous = forward[value - 1]
                reachable = {
                    cell
                    for cell in positions[value]
                    if any(
                        neighbour in previous
                        for neighbour in self._adjacency_by_cell[cell]
                    )
                }
                if value == upper:
                    reachable &= upper_cells
                if not reachable:
                    raise InvalidGrid()
                forward[value] = reachable

            supported = forward[upper]
            for cell in positions[upper] - supported:
                candidates[cell].discard(upper)
                if not candidates[cell]:
                    raise InvalidGrid()
            positions[upper] = supported

            for value in range(upper - 1, lower - 1, -1):
                next_supported = supported
                supported = {
                    cell
                    for cell in forward[value]
                    if any(
                        neighbour in next_supported
                        for neighbour in self._adjacency_by_cell[cell]
                    )
                }
                if not supported:
                    raise InvalidGrid()
                for cell in positions[value] - supported:
                    candidates[cell].discard(value)
                    if not candidates[cell]:
                        raise InvalidGrid()
                positions[value] = supported

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        fixed: dict[int, int] = {}
        for cell in self.cells:
            value = known[cell]
            if value <= 0:
                continue
            if not 1 <= value <= self._max_elem:
                raise InvalidGrid()
            previous = fixed.get(value)
            if previous is not None and previous != cell:
                raise InvalidGrid()
            fixed[value] = cell

        fixed_items = tuple(sorted(fixed.items()))
        for index, (first_value, first_cell) in enumerate(fixed_items):
            for second_value, second_cell in fixed_items[index + 1 :]:
                if not self._compatible_distance(
                    first_cell,
                    second_cell,
                    second_value - first_value,
                ):
                    raise InvalidGrid()

        maximum = self._max_elem
        for cell in self.cells:
            possible = candidates[cell]
            if not possible:
                raise InvalidGrid()
            neighbours = self._adjacency_by_cell[cell]
            remove: set[int] = set()
            for value in tuple(possible):
                if value > 1 and not any(
                    value - 1 in candidates[neighbour]
                    for neighbour in neighbours
                ):
                    remove.add(value)
                    continue
                if value < maximum and not any(
                    value + 1 in candidates[neighbour]
                    for neighbour in neighbours
                ):
                    remove.add(value)
                    continue
                for fixed_value, fixed_cell in fixed_items:
                    if not self._compatible_distance(
                        cell,
                        fixed_cell,
                        abs(value - fixed_value),
                    ):
                        remove.add(value)
                        break
            if remove:
                possible.difference_update(remove)
                if not possible:
                    raise InvalidGrid()

        self._prune_layered_intervals(candidates, fixed)

        if len(fixed) == maximum:
            for value in range(1, maximum):
                if fixed[value + 1] not in self._adjacency_by_cell[fixed[value]]:
                    raise InvalidGrid()
            raise RuleAlwaysSatisfied()

        return False, None, None

    def __hash__(self) -> int:
        return hash((super().__hash__(), self.adjacency))

    def __eq__(self, other: object) -> bool:
        return super().__eq__(other) and self.adjacency == other.adjacency


class AllowedValueCountRule(Rule):
    """Restrict how many cells may contain one distinguished value."""

    __slots__ = ("value", "allowed_counts")

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[int],
        value: int,
        allowed_counts: Iterable[int],
    ) -> None:
        cells = tuple(sorted(cells))
        super().__init__(gsz, cells, None)
        if isinstance(value, bool) or not isinstance(value, Integral):
            raise TypeError("Counted value must be an integer")
        value = int(value)
        if not 1 <= value <= self._max_elem:
            raise ValueError(
                f"Counted value {value} is outside 1..{self._max_elem}"
            )

        counts: set[int] = set()
        for count in allowed_counts:
            if isinstance(count, bool) or not isinstance(count, Integral):
                raise TypeError("Allowed counts must be integers")
            count = int(count)
            if not 0 <= count <= self.len_cells:
                raise ValueError(
                    f"Allowed count {count} is outside 0..{self.len_cells}"
                )
            counts.add(count)
        if not counts:
            raise ValueError("At least one count must be allowed")

        self.value = value
        self.allowed_counts = tuple(sorted(counts))

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        fixed: list[int] = []
        optional: list[int] = []
        for cell in self.cells:
            possible = candidates[cell]
            if not possible:
                raise InvalidGrid()
            value = known[cell]
            if value == self.value or (
                value == 0 and possible == {self.value}
            ):
                fixed.append(cell)
            elif value == 0 and self.value in possible:
                optional.append(cell)

        minimum = len(fixed)
        maximum = minimum + len(optional)
        viable = tuple(
            count
            for count in self.allowed_counts
            if minimum <= count <= maximum
        )
        if not viable:
            raise InvalidGrid()

        if optional:
            can_select_one = any(
                minimum + 1 <= count <= maximum
                for count in viable
            )
            can_skip_one = any(
                minimum <= count <= maximum - 1
                for count in viable
            )
            if not can_select_one:
                for cell in optional:
                    candidates[cell].discard(self.value)
                    if not candidates[cell]:
                        raise InvalidGrid()
            elif not can_skip_one:
                for cell in optional:
                    candidates[cell].intersection_update((self.value,))
                    if not candidates[cell]:
                        raise InvalidGrid()

        fixed_count = 0
        undecided = False
        for cell in self.cells:
            possible = candidates[cell]
            if known[cell] == self.value or possible == {self.value}:
                fixed_count += 1
            elif known[cell] == 0 and self.value in possible:
                undecided = True
        if not undecided:
            if fixed_count not in self.allowed_counts:
                raise InvalidGrid()
            raise RuleAlwaysSatisfied()

        return False, None, None

    def __hash__(self) -> int:
        return hash(
            (super().__hash__(), self.value, self.allowed_counts)
        )

    def __eq__(self, other: object) -> bool:
        return (
            super().__eq__(other)
            and self.value == other.value
            and self.allowed_counts == other.allowed_counts
        )


class SingleLoopRule(Rule):
    """Selected graph edges must form exactly one non-empty simple cycle."""

    __slots__ = ("endpoints", "selected_value", "_endpoints_by_cell")

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[int],
        endpoints: Iterable[tuple[int, int]],
        selected_value: int = 2,
    ) -> None:
        raw_cells = tuple(cells)
        raw_endpoints = tuple(endpoints)
        if len(raw_cells) != len(raw_endpoints):
            raise ValueError("Every loop edge needs one endpoint pair")
        paired = sorted(zip(raw_cells, raw_endpoints), key=lambda item: item[0])
        super().__init__(gsz, (cell for cell, _ in paired), None)

        normalized: list[tuple[int, int]] = []
        for edge in (edge for _, edge in paired):
            if (
                not isinstance(edge, tuple)
                or len(edge) != 2
                or any(
                    isinstance(vertex, bool)
                    or not isinstance(vertex, Integral)
                    for vertex in edge
                )
            ):
                raise TypeError(
                    "Loop endpoint entries must be pairs of integers"
                )
            first, second = map(int, edge)
            if first < 0 or second < 0 or first == second:
                raise ValueError(
                    "Loop edges require two distinct non-negative vertices"
                )
            normalized.append(tuple(sorted((first, second))))
        if len(normalized) != len(set(normalized)):
            raise ValueError("Loop edges must be unique")

        if isinstance(selected_value, bool) or not isinstance(
            selected_value,
            Integral,
        ):
            raise TypeError("Selected edge value must be an integer")
        selected_value = int(selected_value)
        if not 1 <= selected_value <= self._max_elem:
            raise ValueError(
                f"Selected edge value {selected_value} is outside "
                f"1..{self._max_elem}"
            )

        self.endpoints = tuple(normalized)
        self.selected_value = selected_value
        self._endpoints_by_cell = dict(zip(self.cells, self.endpoints))

    def _selected_components(
        self,
        selected: set[int],
    ) -> tuple[list[set[int]], dict[int, int], dict[int, list[int]]]:
        edges_by_vertex: dict[int, list[int]] = {}
        for cell in selected:
            for vertex in self._endpoints_by_cell[cell]:
                edges_by_vertex.setdefault(vertex, []).append(cell)
        if any(len(edges) > 2 for edges in edges_by_vertex.values()):
            raise InvalidGrid()

        components: list[set[int]] = []
        component_by_vertex: dict[int, int] = {}
        remaining = set(selected)
        while remaining:
            seed = remaining.pop()
            component = {seed}
            stack = [seed]
            while stack:
                cell = stack.pop()
                for vertex in self._endpoints_by_cell[cell]:
                    for neighbour in edges_by_vertex.get(vertex, ()):
                        if neighbour not in component:
                            component.add(neighbour)
                            remaining.discard(neighbour)
                            stack.append(neighbour)
            index = len(components)
            components.append(component)
            for cell in component:
                for vertex in self._endpoints_by_cell[cell]:
                    component_by_vertex[vertex] = index
        return components, component_by_vertex, edges_by_vertex

    def _potential_components(
        self,
        possible: set[int],
    ) -> tuple[
        dict[int, int],
        dict[int, set[int]],
        dict[int, set[int]],
    ]:
        parent: dict[int, int] = {}

        def find(vertex: int) -> int:
            parent.setdefault(vertex, vertex)
            while parent[vertex] != vertex:
                parent[vertex] = parent[parent[vertex]]
                vertex = parent[vertex]
            return vertex

        def union(first: int, second: int) -> None:
            first_root = find(first)
            second_root = find(second)
            if first_root != second_root:
                parent[second_root] = first_root

        for cell in possible:
            first, second = self._endpoints_by_cell[cell]
            union(first, second)

        edges_by_root: dict[int, set[int]] = {}
        vertices_by_root: dict[int, set[int]] = {}
        root_by_cell: dict[int, int] = {}
        for cell in possible:
            first, second = self._endpoints_by_cell[cell]
            root = find(first)
            root_by_cell[cell] = root
            edges_by_root.setdefault(root, set()).add(cell)
            vertices_by_root.setdefault(root, set()).update((first, second))
        return root_by_cell, edges_by_root, vertices_by_root

    def _bridge_edges(self, possible: set[int]) -> set[int]:
        adjacency: dict[int, list[tuple[int, int]]] = {}
        for cell in possible:
            first, second = self._endpoints_by_cell[cell]
            adjacency.setdefault(first, []).append((second, cell))
            adjacency.setdefault(second, []).append((first, cell))

        discovery: dict[int, int] = {}
        low: dict[int, int] = {}
        bridges: set[int] = set()
        time = 0

        def visit(vertex: int, parent_edge: int | None) -> None:
            nonlocal time
            time += 1
            discovery[vertex] = time
            low[vertex] = time
            for neighbour, edge in adjacency.get(vertex, ()):
                if edge == parent_edge:
                    continue
                if neighbour not in discovery:
                    visit(neighbour, edge)
                    low[vertex] = min(low[vertex], low[neighbour])
                    if low[neighbour] > discovery[vertex]:
                        bridges.add(edge)
                else:
                    low[vertex] = min(low[vertex], discovery[neighbour])

        for vertex in adjacency:
            if vertex not in discovery:
                visit(vertex, None)
        return bridges

    def _cyclic_blocks(self, possible: set[int]) -> tuple[frozenset[int], ...]:
        """Return vertex-biconnected edge blocks that contain a cycle."""
        adjacency: dict[int, list[tuple[int, int]]] = {}
        for cell in possible:
            first, second = self._endpoints_by_cell[cell]
            adjacency.setdefault(first, []).append((second, cell))
            adjacency.setdefault(second, []).append((first, cell))

        discovery: dict[int, int] = {}
        low: dict[int, int] = {}
        edge_stack: list[int] = []
        blocks: list[frozenset[int]] = []
        time = 0

        def finish_block(stop_edge: int) -> None:
            block: set[int] = set()
            while edge_stack:
                edge = edge_stack.pop()
                block.add(edge)
                if edge == stop_edge:
                    break
            if not block:
                return
            vertices = {
                vertex
                for edge in block
                for vertex in self._endpoints_by_cell[edge]
            }
            if len(block) >= len(vertices):
                blocks.append(frozenset(block))

        def visit(vertex: int, parent_edge: int | None) -> None:
            nonlocal time
            time += 1
            discovery[vertex] = time
            low[vertex] = time
            for neighbour, edge in adjacency.get(vertex, ()):
                if edge == parent_edge:
                    continue
                if neighbour not in discovery:
                    edge_stack.append(edge)
                    visit(neighbour, edge)
                    low[vertex] = min(low[vertex], low[neighbour])
                    if low[neighbour] >= discovery[vertex]:
                        finish_block(edge)
                elif discovery[neighbour] < discovery[vertex]:
                    edge_stack.append(edge)
                    low[vertex] = min(low[vertex], discovery[neighbour])

        for vertex in adjacency:
            if vertex not in discovery:
                visit(vertex, None)
                if edge_stack:
                    finish_block(edge_stack[0])
        return tuple(blocks)

    def _remove_selected_value(
        self,
        candidates: tuple[set[int], ...],
        cells: Iterable[int],
    ) -> None:
        for cell in cells:
            candidates[cell].discard(self.selected_value)
            if not candidates[cell]:
                raise InvalidGrid()

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        selected: set[int] = set()
        possible: set[int] = set()
        for cell in self.cells:
            cell_candidates = candidates[cell]
            if not cell_candidates:
                raise InvalidGrid()
            value = known[cell]
            if value == self.selected_value or (
                value == 0 and cell_candidates == {self.selected_value}
            ):
                selected.add(cell)
                possible.add(cell)
            elif value == 0 and self.selected_value in cell_candidates:
                possible.add(cell)

        components, component_by_vertex, edges_by_vertex = (
            self._selected_components(selected)
        )
        closed_components: list[set[int]] = []
        for component in components:
            vertices = {
                vertex
                for cell in component
                for vertex in self._endpoints_by_cell[cell]
            }
            if vertices and all(
                len(edges_by_vertex[vertex]) == 2
                for vertex in vertices
            ):
                closed_components.append(component)

        if len(closed_components) > 1:
            raise InvalidGrid()
        if closed_components:
            cycle = closed_components[0]
            if selected != cycle:
                raise InvalidGrid()
            self._remove_selected_value(candidates, possible - cycle)
        elif len(components) > 1:
            for cell in possible - selected:
                first, second = self._endpoints_by_cell[cell]
                component = component_by_vertex.get(first)
                if (
                    component is not None
                    and component_by_vertex.get(second) == component
                ):
                    candidates[cell].discard(self.selected_value)
                    if not candidates[cell]:
                        raise InvalidGrid()

        possible = {
            cell
            for cell in self.cells
            if self.selected_value in candidates[cell]
        }
        if not possible:
            raise InvalidGrid()

        root_by_cell, edges_by_root, vertices_by_root = (
            self._potential_components(possible)
        )
        cycle_roots = {
            root
            for root, edges in edges_by_root.items()
            if len(edges) >= len(vertices_by_root[root])
        }
        selected_roots = {root_by_cell[cell] for cell in selected}
        if len(selected_roots) > 1:
            raise InvalidGrid()
        if selected_roots:
            viable_roots = selected_roots & cycle_roots
            if not viable_roots:
                raise InvalidGrid()
        else:
            viable_roots = cycle_roots
            if not viable_roots:
                raise InvalidGrid()

        self._remove_selected_value(
            candidates,
            (
                cell
                for cell in possible - selected
                if root_by_cell[cell] not in viable_roots
            ),
        )

        possible = {
            cell
            for cell in self.cells
            if self.selected_value in candidates[cell]
        }
        bridges = self._bridge_edges(possible)
        if selected & bridges:
            raise InvalidGrid()
        self._remove_selected_value(candidates, bridges - selected)

        possible = {
            cell
            for cell in self.cells
            if self.selected_value in candidates[cell]
        }
        blocks = self._cyclic_blocks(possible)
        viable_blocks = (
            tuple(block for block in blocks if selected <= block)
            if selected
            else blocks
        )
        if not viable_blocks:
            raise InvalidGrid()
        viable_edges = set().union(*viable_blocks)
        self._remove_selected_value(candidates, possible - viable_edges)

        membership_decided = all(
            self.selected_value not in candidates[cell]
            or candidates[cell] == {self.selected_value}
            or known[cell] > 0
            for cell in self.cells
        )
        if membership_decided:
            final_selected = {
                cell
                for cell in self.cells
                if known[cell] == self.selected_value
                or candidates[cell] == {self.selected_value}
            }
            final_components, _, final_edges_by_vertex = (
                self._selected_components(final_selected)
            )
            if not final_selected or len(final_components) != 1:
                raise InvalidGrid()
            vertices = {
                vertex
                for cell in final_selected
                for vertex in self._endpoints_by_cell[cell]
            }
            if not all(
                len(final_edges_by_vertex[vertex]) == 2
                for vertex in vertices
            ):
                raise InvalidGrid()
            raise RuleAlwaysSatisfied()

        return False, None, None

    def __hash__(self) -> int:
        return hash(
            (super().__hash__(), self.endpoints, self.selected_value)
        )

    def __eq__(self, other: object) -> bool:
        return (
            super().__eq__(other)
            and self.endpoints == other.endpoints
            and self.selected_value == other.selected_value
        )
