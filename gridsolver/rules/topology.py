"""Reusable graph and cardinality constraints for non-Sudoku puzzle families."""

from collections import deque
from collections.abc import Iterable, Iterator, MutableSequence
from numbers import Integral

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import _tarjan_scc
from gridsolver.util import iter_bits


class ConsecutiveAdjacencyRule(Rule):
    """Require consecutive values to occupy adjacent cells.

    The N rule cells hold 1..N once each, so a solution is a Hamiltonian path
    of the adjacency graph. Every deduction below is a sound relaxation of
    that path:

    * Fixed clues ``k < m`` need a path of ``m-k`` steps, so their graph
      distance is at most ``m-k`` (with equal parity on bipartite graphs such
      as Numbrix's orthogonal grid).
    * Local support: ``1 < v < N`` at ``c`` needs two distinct neighbours
      offering ``v-1`` and ``v+1``, so a cell with one usable neighbour can
      only hold an end value.
    * Layered reachability between consecutive anchors (1, the fixed clues,
      N): ``v`` survives at ``c`` only on a walk that visits cells offering
      each intermediate value in turn. Such walks cannot cross a fixed clue,
      so this measures distance through the free cells, not the board, and a
      region of free cells can only take values of the gaps that touch it.
    * All different (Regin): the values are a bijection onto the cells, so a
      value may stay at a cell only if some perfect matching uses that pair.
      This catches pigeonhole dead ends the walks ignore: more values
      confined to a set of cells than it holds, including a region of free
      cells larger than the gaps reaching it can fill, or smaller than the
      gaps that can only go there (per colour on bipartite graphs, where the
      walks already fix each value's colour).
    """

    __slots__ = (
        "adjacency",
        "_adjacency_by_cell",
        "_distances",
        "_bipartite",
        "_neighbour_masks",
        "_offset_masks",
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
        paired = sorted(
            zip(self.cells, raw_adjacency, strict=True),
            key=lambda item: item[0],
        )
        self.cells = tuple(cell for cell, _ in paired)
        raw_adjacency = tuple(neighbours for _, neighbours in paired)
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

        # Bitset views of the same graph: bit c stands for cell c. Grouping
        # the edges by index offset lets one shift per offset expand a whole
        # set of cells at once (8 offsets for king moves, 4 for orthogonal).
        neighbour_masks = [0] * cell_count
        offsets: dict[int, int] = {}
        for cell, neighbours in by_cell.items():
            for neighbour in neighbours:
                neighbour_masks[cell] |= 1 << neighbour
                offset = neighbour - cell
                offsets[offset] = offsets.get(offset, 0) | 1 << cell
        self._neighbour_masks = tuple(neighbour_masks)
        self._offset_masks = (
            tuple(sorted(offsets.items())) if len(offsets) <= 16 else None
        )

    def _expand(self, mask: int) -> int:
        """Cells adjacent to at least one cell of ``mask``."""
        offset_masks = self._offset_masks
        result = 0
        if offset_masks is not None:
            for offset, sources in offset_masks:
                moved = mask & sources
                if moved:
                    result |= moved << offset if offset > 0 else moved >> -offset
            return result
        neighbour_masks = self._neighbour_masks
        for cell in iter_bits(mask):
            result |= neighbour_masks[cell]
        return result

    def _expand_counts(self, mask: int) -> tuple[int, int]:
        """Cells adjacent to at least one, and to at least two, cells of ``mask``."""
        once = twice = 0
        offset_masks = self._offset_masks
        if offset_masks is not None:
            for offset, sources in offset_masks:
                moved = mask & sources
                if moved:
                    moved = moved << offset if offset > 0 else moved >> -offset
                    twice |= once & moved
                    once |= moved
            return once, twice
        neighbour_masks = self._neighbour_masks
        for cell in iter_bits(mask):
            moved = neighbour_masks[cell]
            twice |= once & moved
            once |= moved
        return once, twice

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

    def _positions(self, candidates: tuple[set[int], ...]) -> list[int]:
        """Per value, the bitmask of rule cells still offering it."""
        positions = [0] * (self._max_elem + 2)
        for cell in self.cells:
            possible = candidates[cell]
            if not possible:
                raise InvalidGrid()
            bit = 1 << cell
            for value in possible:
                positions[value] |= bit
        if not all(positions[1:self._max_elem + 1]):
            raise InvalidGrid()
        return positions

    @staticmethod
    def _discard(
        candidates: tuple[set[int], ...],
        cells_mask: int,
        value: int,
    ) -> None:
        for cell in iter_bits(cells_mask):
            possible = candidates[cell]
            possible.discard(value)
            if not possible:
                raise InvalidGrid()

    def _prune_local_support(
        self,
        candidates: tuple[set[int], ...],
        positions: list[int],
    ) -> None:
        """Remove ``v`` where no two distinct neighbours offer ``v-1`` and ``v+1``.

        The path enters and leaves an inner value through two different
        neighbours; 1 and N need only a successor or a predecessor.
        """
        maximum = self._max_elem
        if maximum == 1:
            return
        counts = [self._expand_counts(positions[value]) for value in range(maximum + 2)]
        for value in range(1, maximum + 1):
            if value == 1:
                allowed = counts[2][0]
            elif value == maximum:
                allowed = counts[value - 1][0]
            else:
                before_once, before_twice = counts[value - 1]
                after_once, after_twice = counts[value + 1]
                allowed = before_once & after_once
                # Only one neighbour offers v-1, only one offers v+1, and some
                # neighbour offers both: then it is the same single cell.
                single = (before_once & ~before_twice) & (after_once & ~after_twice)
                if single & allowed:
                    both = self._expand(positions[value - 1] & positions[value + 1])
                    allowed &= ~(single & both)
            removed = positions[value] & ~allowed
            if removed:
                self._discard(candidates, removed, value)
                positions[value] &= allowed
                if not positions[value]:
                    raise InvalidGrid()

    def _prune_all_different(
        self,
        candidates: tuple[set[int], ...],
        positions: list[int],
    ) -> None:
        """Regin's filter for the bijection between the N values and N cells.

        The path places every value exactly once, so a value may stay at a
        cell only if some perfect matching of values to cells uses that pair.
        With one perfect matching in hand, an unused pair (v, c) belongs to
        another one exactly when v and the value matched to c lie in the same
        strongly connected component of "v can take the cell matched to w".
        This catches pigeonhole dead ends, such as more values confined to a
        few cells than those cells can hold, that the layered walks ignore.
        """
        maximum = self._max_elem
        match_cell = [-1] * (maximum + 1)  # value -> cell
        match_value: dict[int, int] = {}  # cell -> value
        matched = 0
        for value in range(1, maximum + 1):
            free = positions[value] & ~matched
            if free:
                cell = (free & -free).bit_length() - 1
                match_cell[value] = cell
                match_value[cell] = value
            else:
                cell = self._augment(value, positions, match_cell, match_value, matched)
                if cell < 0:
                    raise InvalidGrid()  # Hall violation: no perfect matching
            matched |= 1 << cell

        # Node v: value v. Edge v -> w: v may take the cell matched to w.
        successors: list[list[int]] = [[]]
        for value in range(1, maximum + 1):
            others = positions[value] & ~(1 << match_cell[value])
            successors.append([match_value[cell] for cell in iter_bits(others)])
        component = _tarjan_scc(successors)

        # The cells whose matched values share a component with v are exactly
        # the cells v may keep (its own matched cell included).
        component_cells: dict[int, int] = {}
        for value in range(1, maximum + 1):
            key = component[value]
            component_cells[key] = component_cells.get(key, 0) | 1 << match_cell[value]
        for value in range(1, maximum + 1):
            removed = positions[value] & ~component_cells[component[value]]
            if removed:
                self._discard(candidates, removed, value)
                positions[value] &= ~removed

    @staticmethod
    def _augment(
        start: int,
        positions: list[int],
        match_cell: list[int],
        match_value: dict[int, int],
        matched: int,
    ) -> int:
        """Give unmatched ``start`` a cell along a shortest alternating path.

        Every value on the path moves to the cell it reached, and ``start``
        takes the first one. Returns the free cell that became occupied, or
        -1 if no alternating path reaches a free cell.
        """
        reached_from: dict[int, int] = {}  # cell -> value that reached it
        visited = 0
        frontier = [start]
        while frontier:
            following: list[int] = []
            for value in frontier:
                reach = positions[value] & ~visited
                if not reach:
                    continue
                visited |= reach
                free = reach & ~matched
                if free:
                    occupied = cell = (free & -free).bit_length() - 1
                    while True:
                        previous = match_cell[value]
                        match_cell[value] = cell
                        match_value[cell] = value
                        if value == start:
                            return occupied
                        cell = previous
                        value = reached_from[cell]
                for cell in iter_bits(reach):
                    reached_from[cell] = value
                    following.append(match_value[cell])
            frontier = following
        return -1

    def _prune_layered_intervals(
        self,
        candidates: tuple[set[int], ...],
        fixed: dict[int, int],
        positions: list[int],
    ) -> None:
        """Keep only candidates lying on a supported value-layer path.

        This layered graph relaxes the all-different constraint, so anything
        removed here is impossible in every real Hamiltonian path solution.
        Layers between two anchors contain no fixed clue, so the walks run
        through free cells only.
        """
        maximum = self._max_elem
        anchors: dict[int, int] = {
            1: positions[1],
            maximum: positions[maximum],
        }
        anchors.update({value: 1 << cell for value, cell in fixed.items()})
        ordered = sorted(anchors.items())
        expand = self._expand

        for (lower, lower_cells), (upper, upper_cells) in zip(
            ordered,
            ordered[1:],
        ):
            if upper <= lower:
                continue

            forward = [lower_cells]
            reachable = lower_cells
            for value in range(lower + 1, upper + 1):
                reachable = positions[value] & expand(reachable)
                if value == upper:
                    reachable &= upper_cells
                if not reachable:
                    raise InvalidGrid()
                forward.append(reachable)

            supported = forward[-1]
            self._discard(candidates, positions[upper] & ~supported, upper)
            positions[upper] = supported

            for value in range(upper - 1, lower - 1, -1):
                supported = forward[value - lower] & expand(supported)
                if not supported:
                    raise InvalidGrid()
                self._discard(candidates, positions[value] & ~supported, value)
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

        # Consecutive clues suffice: distance obeys the triangle inequality and
        # parity adds up, so every other pair of clues then fits as well.
        fixed_items = tuple(sorted(fixed.items()))
        for (first_value, first_cell), (second_value, second_cell) in zip(
            fixed_items,
            fixed_items[1:],
        ):
            if not self._compatible_distance(
                first_cell,
                second_cell,
                second_value - first_value,
            ):
                raise InvalidGrid()

        maximum = self._max_elem
        # One pass per application: the rule's own removals mark its cells
        # dirty, so propagation applies it again until nothing changes.
        # (Looping here to a local fixpoint measured no fewer branch nodes.)
        positions = self._positions(candidates)
        self._prune_local_support(candidates, positions)
        self._prune_layered_intervals(candidates, fixed, positions)
        self._prune_all_different(candidates, positions)

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
        super().__init__(gsz, cells, None)
        # canonicalise AFTER coordinate normalization: sorting raw input
        # would give coordinate-form and integer-form constructions of the
        # same rule different identities (duplicate rule registrations)
        self.cells = tuple(sorted(self.cells))
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
        super().__init__(gsz, raw_cells, None)
        # canonicalise AFTER coordinate normalization (see
        # AllowedValueCountRule); endpoints stay aligned with their cells
        paired = sorted(zip(self.cells, raw_endpoints), key=lambda item: item[0])
        self.cells = tuple(cell for cell, _ in paired)

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

        # Iterative DFS avoids one Python frame per graph vertex. Each
        # simple cycle lies in one cyclic vertex-biconnected block; bridges
        # and acyclic components never appear in the returned blocks.
        for root in adjacency:
            if root in discovery:
                continue
            time += 1
            discovery[root] = time
            low[root] = time
            work: list[tuple[int, int | None, Iterator[tuple[int, int]]]] = [
                (root, None, iter(adjacency.get(root, ())))
            ]
            while work:
                vertex, parent_edge, neighbours = work[-1]
                advanced = False
                for neighbour, edge in neighbours:
                    if edge == parent_edge:
                        continue
                    if neighbour not in discovery:
                        edge_stack.append(edge)
                        time += 1
                        discovery[neighbour] = time
                        low[neighbour] = time
                        work.append(
                            (neighbour, edge, iter(adjacency.get(neighbour, ())))
                        )
                        advanced = True
                        break
                    if discovery[neighbour] < discovery[vertex]:
                        edge_stack.append(edge)
                        low[vertex] = min(low[vertex], discovery[neighbour])
                if advanced:
                    continue
                work.pop()
                if work:
                    parent_vertex = work[-1][0]
                    low[parent_vertex] = min(low[parent_vertex], low[vertex])
                    if low[vertex] >= discovery[parent_vertex]:
                        finish_block(parent_edge)
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

        # This single analysis subsumes connected-component and bridge
        # pruning: every solution is a cycle in one block containing ALL
        # selected edges. Removing a bridge/other component cannot change a
        # cyclic block, so earlier passes do not add any eliminations.
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
