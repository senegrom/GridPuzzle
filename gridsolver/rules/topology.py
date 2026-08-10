"""Reusable graph and cardinality constraints for non-Sudoku puzzle families."""

from collections.abc import Iterable, MutableSequence
from numbers import Integral

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied


class ConsecutiveAdjacencyRule(Rule):
    """Every consecutive value pair must occupy adjacent cells.

    The rule expects exactly one cell for each value in ``1..max_elem``; combine
    it with ``ElementsAtMostOnce`` and ``ElementsAtLeastOnce`` to obtain the
    standard Hidato/Numbrix permutation model.
    """

    __slots__ = ("adjacency",)

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
        normalized: list[frozenset[int]] = []
        for cell, neighbours in zip(self.cells, raw_adjacency):
            items: set[int] = set()
            for neighbour in neighbours:
                if isinstance(neighbour, bool) or not isinstance(neighbour, Integral):
                    raise TypeError("Adjacency cells must be integers")
                neighbour = int(neighbour)
                if neighbour not in cell_set:
                    raise ValueError(
                        f"Adjacency cell {neighbour} is outside the rule cell set"
                    )
                if neighbour == cell:
                    raise ValueError("A cell cannot be adjacent to itself")
                items.add(neighbour)
            normalized.append(frozenset(items))

        by_cell = dict(zip(self.cells, normalized))
        for cell, neighbours in by_cell.items():
            for neighbour in neighbours:
                if cell not in by_cell[neighbour]:
                    raise ValueError("Consecutive adjacency must be symmetric")
        self.adjacency = tuple(tuple(sorted(items)) for items in normalized)

    def apply(
        self,
        known: MutableSequence[int],
        candidates: tuple[set[int], ...],
        guarantees: Iterable[Guarantee] | None = None,
    ) -> tuple[bool, None, None]:
        maximum = self._max_elem
        for cell, neighbours in zip(self.cells, self.adjacency):
            possible = candidates[cell]
            if not possible:
                raise InvalidGrid()
            remove: list[int] = []
            for value in tuple(possible):
                if value > 1 and not any(
                    value - 1 in candidates[neighbour]
                    for neighbour in neighbours
                ):
                    remove.append(value)
                    continue
                if value < maximum and not any(
                    value + 1 in candidates[neighbour]
                    for neighbour in neighbours
                ):
                    remove.append(value)
            if remove:
                possible.difference_update(remove)
                if not possible:
                    raise InvalidGrid()

        if all(known[cell] > 0 for cell in self.cells):
            positions: dict[int, int] = {}
            for cell in self.cells:
                value = known[cell]
                if not 1 <= value <= maximum or value in positions:
                    raise InvalidGrid()
                positions[value] = cell
            if len(positions) != maximum:
                raise InvalidGrid()
            adjacency_by_cell = dict(zip(self.cells, self.adjacency))
            for value in range(1, maximum):
                if positions[value + 1] not in adjacency_by_cell[positions[value]]:
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
        possible_cells: list[int] = []
        for cell in self.cells:
            possible = candidates[cell]
            if not possible:
                raise InvalidGrid()
            value = known[cell]
            if value == self.value or (value == 0 and possible == {self.value}):
                fixed.append(cell)
                possible_cells.append(cell)
            elif value == 0 and self.value in possible:
                possible_cells.append(cell)

        minimum = len(fixed)
        maximum = len(possible_cells)
        viable = tuple(
            count
            for count in self.allowed_counts
            if minimum <= count <= maximum
        )
        if not viable:
            raise InvalidGrid()

        optional = [cell for cell in possible_cells if cell not in fixed]
        if minimum == max(viable):
            for cell in optional:
                candidates[cell].discard(self.value)
                if not candidates[cell]:
                    raise InvalidGrid()
        elif maximum == min(viable):
            for cell in optional:
                candidates[cell].intersection_update((self.value,))
                if not candidates[cell]:
                    raise InvalidGrid()

        fixed_count = 0
        membership_decided = True
        for cell in self.cells:
            possible = candidates[cell]
            if possible == {self.value} or known[cell] == self.value:
                fixed_count += 1
            elif self.value in possible and known[cell] == 0:
                membership_decided = False
        if membership_decided:
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

    __slots__ = ("endpoints", "selected_value")

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
        for first, second in (edge for _, edge in paired):
            if any(
                isinstance(vertex, bool) or not isinstance(vertex, Integral)
                for vertex in (first, second)
            ):
                raise TypeError("Loop vertices must be integers")
            first, second = int(first), int(second)
            if first < 0 or second < 0 or first == second:
                raise ValueError("Loop edges require two distinct non-negative vertices")
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

    def _components(
        self,
        selected: set[int],
    ) -> tuple[list[set[int]], dict[int, int], dict[int, list[int]]]:
        endpoints_by_cell = dict(zip(self.cells, self.endpoints))
        edges_by_vertex: dict[int, list[int]] = {}
        for cell in selected:
            for vertex in endpoints_by_cell[cell]:
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
                for vertex in endpoints_by_cell[cell]:
                    for neighbour in edges_by_vertex.get(vertex, ()):
                        if neighbour not in component:
                            component.add(neighbour)
                            remaining.discard(neighbour)
                            stack.append(neighbour)
            index = len(components)
            components.append(component)
            for cell in component:
                for vertex in endpoints_by_cell[cell]:
                    component_by_vertex[vertex] = index
        return components, component_by_vertex, edges_by_vertex

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

        components, component_by_vertex, edges_by_vertex = self._components(selected)
        endpoints_by_cell = dict(zip(self.cells, self.endpoints))
        closed_components: list[set[int]] = []
        for component in components:
            vertices = {
                vertex
                for cell in component
                for vertex in endpoints_by_cell[cell]
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
            for cell in possible - cycle:
                candidates[cell].discard(self.selected_value)
                if not candidates[cell]:
                    raise InvalidGrid()
        elif len(components) > 1:
            # With degree <= 2, an edge joining two vertices already in the same
            # selected component would close that component and strand every
            # other selected component as a second loop/path.
            for cell in possible - selected:
                first, second = endpoints_by_cell[cell]
                component = component_by_vertex.get(first)
                if (
                    component is not None
                    and component_by_vertex.get(second) == component
                ):
                    candidates[cell].discard(self.selected_value)
                    if not candidates[cell]:
                        raise InvalidGrid()

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
            final_components, _, final_edges_by_vertex = self._components(
                final_selected
            )
            if not final_selected or len(final_components) != 1:
                raise InvalidGrid()
            vertices = {
                vertex
                for cell in final_selected
                for vertex in endpoints_by_cell[cell]
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
