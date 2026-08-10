"""Apply correctness, integration, and propagation hardening for new families."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_between(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    start_count = text.count(start_marker)
    end_count = text.count(end_marker)
    if start_count != 1 or end_count < 1:
        raise SystemExit(
            f"{label}: start={start_count}, end={end_count}"
        )
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(
        text[:start] + replacement + text[end:],
        encoding="utf-8",
    )


Path('gridsolver/rules/topology.py').write_text('''"""Reusable graph and cardinality constraints for non-Sudoku puzzle families."""

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
                "Every cell in a multi-cell consecutive path needs a neighbour"
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
''', encoding='utf-8')

Path('gridsolver/grid_classes/path_puzzles.py').write_text('''"""Hidato and Numbrix compact-grid implementations."""

from collections.abc import Iterable, Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.rules.topology import ConsecutiveAdjacencyRule
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


type BoardCell = tuple[int, int]


def _parse_path_clue(raw_value: object, key: BoardCell) -> int:
    if isinstance(raw_value, bool):
        raise TypeError(f"Path clue at {key} must be an integer")
    if isinstance(raw_value, Integral):
        value = int(raw_value)
    elif isinstance(raw_value, str):
        token = raw_value.strip()
        if not token or not token.isascii() or not token.isdigit():
            raise ValueError(
                f"Cannot parse path value {raw_value!r} at {key}"
            )
        value = int(token)
    else:
        raise TypeError(
            f"Path clue at {key} must be an integer or ASCII digit string"
        )
    if value <= 0:
        raise ValueError(f"Path clues must be positive, got {value} at {key}")
    return value


class _ConsecutivePathGrid(CompactGrid):
    diagonal_adjacency = False
    allow_blocks = False

    def __init__(
        self,
        board_rows: int,
        board_cols: int | None = None,
        *,
        blocked: Iterable[BoardCell] = (),
    ) -> None:
        if isinstance(board_rows, bool) or not isinstance(board_rows, Integral):
            raise TypeError("board_rows must be an integer")
        if board_cols is None:
            board_cols = board_rows
        if isinstance(board_cols, bool) or not isinstance(board_cols, Integral):
            raise TypeError("board_cols must be an integer")
        board_rows, board_cols = int(board_rows), int(board_cols)
        if board_rows <= 0 or board_cols <= 0:
            raise ValueError("Board dimensions must be positive")

        blocked_cells: set[BoardCell] = set()
        for raw_cell in blocked:
            if (
                not isinstance(raw_cell, tuple)
                or len(raw_cell) != 2
                or any(
                    isinstance(value, bool)
                    or not isinstance(value, Integral)
                    for value in raw_cell
                )
            ):
                raise TypeError(f"Invalid blocked board cell {raw_cell!r}")
            cell = tuple(map(int, raw_cell))
            if not (0 <= cell[0] < board_rows and 0 <= cell[1] < board_cols):
                raise ValueError(
                    f"Blocked cell {cell} is outside "
                    f"a {board_rows}x{board_cols} board"
                )
            blocked_cells.add(cell)
        if blocked_cells and not self.allow_blocks:
            raise ValueError(
                f"{type(self).__name__} does not support blocked cells"
            )

        blocked_frozen = frozenset(blocked_cells)
        keys = tuple(
            (row, col)
            for row in range(board_rows)
            for col in range(board_cols)
            if (row, col) not in blocked_frozen
        )
        if not keys:
            raise ValueError("At least one playable path cell is required")

        super().__init__(keys, max_elem=len(keys))
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.blocked = blocked_frozen

        offsets = (
            tuple(
                (row_delta, col_delta)
                for row_delta in (-1, 0, 1)
                for col_delta in (-1, 0, 1)
                if (row_delta, col_delta) != (0, 0)
            )
            if self.diagonal_adjacency
            else ((-1, 0), (0, -1), (0, 1), (1, 0))
        )
        adjacency: list[tuple[int, ...]] = []
        for row, col in self.cell_to_key:
            neighbours = []
            for row_delta, col_delta in offsets:
                neighbour = (row + row_delta, col + col_delta)
                cell = self.key_to_cell.get(neighbour)
                if cell is not None:
                    neighbours.append(cell)
            adjacency.append(tuple(sorted(neighbours)))
        self.adjacency = tuple(adjacency)

        cells = tuple(range(self.len))
        self.add_rules_checked(
            (
                ElementsAtMostOnce(self, cells=cells),
                ElementsAtLeastOnce(self, cells=cells),
                ConsecutiveAdjacencyRule(
                    self,
                    cells=cells,
                    adjacency=self.adjacency,
                ),
            )
        )

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.board_rows = self.board_rows
        result.board_cols = self.board_cols
        result.blocked = self.blocked
        result.adjacency = self.adjacency

    @classmethod
    def from_board(
        cls,
        board: Sequence[Sequence[object]],
    ) -> "_ConsecutivePathGrid":
        if isinstance(board, (str, bytes, bytearray)):
            raise TypeError("Path board must be a sequence of rows")
        try:
            rows = tuple(tuple(row) for row in board)
        except TypeError as exc:
            raise TypeError("Path board must be a sequence of rows") from exc
        if not rows or not rows[0]:
            raise ValueError("Path board must not be empty")
        width = len(rows[0])
        if any(len(row) != width for row in rows):
            raise ValueError("Path board rows must all have the same length")

        blocked: set[BoardCell] = set()
        givens: dict[BoardCell, int] = {}
        clue_cells: dict[int, BoardCell] = {}
        for row_index, row in enumerate(rows):
            for col_index, raw_value in enumerate(row):
                key = (row_index, col_index)
                if raw_value is None:
                    continue
                if isinstance(raw_value, str):
                    token = raw_value.strip()
                    if token.upper() in {"B", "#"}:
                        blocked.add(key)
                        continue
                    if token in {".", "0"}:
                        continue
                if (
                    not isinstance(raw_value, bool)
                    and isinstance(raw_value, Integral)
                    and int(raw_value) == 0
                ):
                    continue
                value = _parse_path_clue(raw_value, key)
                previous = clue_cells.get(value)
                if previous is not None:
                    raise ValueError(
                        f"Duplicate path clue {value} at {previous} and {key}"
                    )
                clue_cells[value] = key
                givens[key] = value

        playable = len(rows) * width - len(blocked)
        for key, value in givens.items():
            if value > playable:
                raise ValueError(
                    f"Path clue {value} at {key} exceeds "
                    f"the {playable}-cell path domain"
                )

        grid = cls(len(rows), width, blocked=blocked)
        grid.load_key_values(givens)
        return grid

    def format_solution(self, values: Sequence[int]) -> str:
        keyed = self.values_by_key(values)
        width = len(str(self.max_elem))
        lines = []
        for row in range(self.board_rows):
            rendered = []
            for col in range(self.board_cols):
                key = (row, col)
                if key in self.blocked:
                    rendered.append("#" * width)
                else:
                    rendered.append(f"{keyed[key]:>{width}}")
            lines.append(" ".join(rendered))
        return "\n".join(lines)


class Hidato(_ConsecutivePathGrid):
    """Consecutive-number path using orthogonal and diagonal neighbours."""

    diagonal_adjacency = True
    allow_blocks = True


class Numbrix(_ConsecutivePathGrid):
    """Consecutive-number path using orthogonal neighbours only."""

    diagonal_adjacency = False
    allow_blocks = False
''', encoding='utf-8')

Path('gridsolver/grid_classes/kakuro.py').write_text('''"""Kakuro compact white-cell grid."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


type BoardCell = tuple[int, int]


@dataclass(frozen=True, slots=True)
class KakuroRun:
    target: int
    cells: tuple[BoardCell, ...]


def _board_cell(raw_cell: object, description: str) -> BoardCell:
    if (
        isinstance(raw_cell, (str, bytes, bytearray))
        or not isinstance(raw_cell, Sequence)
        or len(raw_cell) != 2
        or any(
            isinstance(value, bool) or not isinstance(value, Integral)
            for value in raw_cell
        )
    ):
        raise TypeError(f"Invalid {description} {raw_cell!r}")
    row, col = map(int, raw_cell)
    return row, col


def _normalise_run_cells(
    raw_cells: Iterable[BoardCell],
) -> tuple[str, tuple[BoardCell, ...]]:
    if isinstance(raw_cells, (str, bytes, bytearray)):
        raise TypeError("Kakuro run cells must be coordinate pairs")
    try:
        cells = tuple(
            _board_cell(cell, "Kakuro run cell")
            for cell in raw_cells
        )
    except TypeError as exc:
        raise TypeError("Kakuro run cells must be coordinate pairs") from exc

    if len(cells) < 2:
        raise ValueError("Kakuro runs must contain at least two cells")
    if len(cells) > 9:
        raise ValueError("Kakuro runs cannot contain more than nine cells")
    if len(cells) != len(set(cells)):
        raise ValueError("Kakuro run cells must be unique")

    rows = {row for row, _ in cells}
    cols = {col for _, col in cells}
    if len(rows) == 1:
        orientation = "H"
        ordered = tuple(sorted(cells, key=lambda cell: cell[1]))
        positions = tuple(col for _, col in ordered)
    elif len(cols) == 1:
        orientation = "V"
        ordered = tuple(sorted(cells, key=lambda cell: cell[0]))
        positions = tuple(row for row, _ in ordered)
    else:
        raise ValueError(
            "Kakuro runs must be straight horizontal or vertical lines"
        )

    expected = tuple(range(positions[0], positions[0] + len(positions)))
    if positions != expected:
        raise ValueError("Kakuro run cells must be contiguous")
    return orientation, ordered


class Kakuro(CompactGrid):
    """Cross-sum puzzle using existing sum-plus-all-different constraints."""

    def __init__(
        self,
        board_rows: int,
        board_cols: int,
        white_cells: Iterable[BoardCell],
        runs: Iterable[KakuroRun | tuple[int, Iterable[BoardCell]]],
    ) -> None:
        if any(
            isinstance(value, bool) or not isinstance(value, Integral)
            for value in (board_rows, board_cols)
        ):
            raise TypeError("Kakuro dimensions must be integers")
        board_rows, board_cols = int(board_rows), int(board_cols)
        if board_rows <= 0 or board_cols <= 0:
            raise ValueError("Kakuro dimensions must be positive")

        if isinstance(white_cells, (str, bytes, bytearray)):
            raise TypeError("Kakuro white cells must be coordinate pairs")
        normalized_white: set[BoardCell] = set()
        for raw_cell in white_cells:
            cell = _board_cell(raw_cell, "Kakuro white cell")
            if not (0 <= cell[0] < board_rows and 0 <= cell[1] < board_cols):
                raise ValueError(
                    f"Kakuro white cell {cell} is outside "
                    f"a {board_rows}x{board_cols} board"
                )
            normalized_white.add(cell)
        if not normalized_white:
            raise ValueError("Kakuro requires at least one white cell")

        keys = tuple(sorted(normalized_white))
        super().__init__(keys, max_elem=9)
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.white_cells = frozenset(normalized_white)

        normalized_runs: list[KakuroRun] = []
        coverage = {
            cell: {"H": 0, "V": 0}
            for cell in self.white_cells
        }
        rules: list[SumAndElementsAtMostOnce] = []
        seen_runs: set[tuple[str, tuple[BoardCell, ...]]] = set()

        if isinstance(runs, (str, bytes, bytearray)):
            raise TypeError("Kakuro runs must be run definitions")
        for raw_run in runs:
            if isinstance(raw_run, KakuroRun):
                target = raw_run.target
                raw_cells = raw_run.cells
            else:
                try:
                    target, raw_cells = raw_run
                except (TypeError, ValueError) as exc:
                    raise TypeError(
                        "Kakuro runs must be KakuroRun or (target, cells) pairs"
                    ) from exc

            if isinstance(target, bool) or not isinstance(target, Integral):
                raise TypeError("Kakuro run targets must be integers")
            target = int(target)

            orientation, cells = _normalise_run_cells(raw_cells)
            if any(cell not in self.white_cells for cell in cells):
                raise ValueError("Kakuro runs may contain only white cells")

            length = len(cells)
            minimum = length * (length + 1) // 2
            maximum = length * (19 - length) // 2
            if not minimum <= target <= maximum:
                raise ValueError(
                    f"Kakuro target {target} is impossible for a "
                    f"{length}-cell distinct-digit run; expected "
                    f"{minimum}..{maximum}"
                )

            run_key = orientation, cells
            if run_key in seen_runs:
                raise ValueError("Duplicate Kakuro run")
            seen_runs.add(run_key)
            for cell in cells:
                coverage[cell][orientation] += 1

            run = KakuroRun(target=target, cells=cells)
            normalized_runs.append(run)
            rules.append(
                SumAndElementsAtMostOnce(
                    self,
                    cells=[self.compact_cell(cell) for cell in cells],
                    mysum=target,
                )
            )

        invalid = {
            cell: counts
            for cell, counts in coverage.items()
            if counts != {"H": 1, "V": 1}
        }
        if invalid:
            rendered = ", ".join(
                f"{cell}:H{counts['H']}/V{counts['V']}"
                for cell, counts in sorted(invalid.items())
            )
            raise ValueError(
                "Every Kakuro white cell must belong to exactly one "
                f"horizontal and one vertical run; invalid coverage: {rendered}"
            )

        self.runs = tuple(normalized_runs)
        self.add_rules_checked(rules)

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.board_rows = self.board_rows
        result.board_cols = self.board_cols
        result.white_cells = self.white_cells
        result.runs = self.runs

    def format_solution(self, values: Sequence[int]) -> str:
        keyed = self.values_by_key(values)
        lines = []
        for row in range(self.board_rows):
            rendered = []
            for col in range(self.board_cols):
                cell = (row, col)
                rendered.append(str(keyed[cell]) if cell in keyed else "#")
            lines.append(" ".join(rendered))
        return "\n".join(lines)
''', encoding='utf-8')

Path('gridsolver/grid_classes/slitherlink.py').write_text('''"""Slitherlink edge-grid implementation."""

from collections.abc import Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.rules.topology import AllowedValueCountRule, SingleLoopRule


type EdgeKey = tuple[str, int, int]


def _parse_slitherlink_clue(
    raw_clue: object,
    location: tuple[int, int],
) -> int | None:
    if raw_clue is None:
        return None
    if isinstance(raw_clue, str):
        token = raw_clue.strip()
        if token == ".":
            return None
        if not token or not token.isascii() or not token.isdigit():
            raise ValueError(
                f"Cannot parse Slitherlink clue {raw_clue!r} at {location}"
            )
        clue = int(token)
    elif isinstance(raw_clue, bool) or not isinstance(raw_clue, Integral):
        raise TypeError(
            f"Slitherlink clue at {location} must be an integer, '.', or None"
        )
    else:
        clue = int(raw_clue)

    if not 0 <= clue <= 4:
        raise ValueError(
            f"Slitherlink clue {clue} at {location} is outside 0..4"
        )
    return clue


class Slitherlink(CompactGrid):
    """Binary edge puzzle whose selected edges form one loop.

    Compact values use ``1`` for an absent edge and ``2`` for a selected edge,
    preserving the solver's positive-value invariant.
    """

    OFF = 1
    ON = 2

    def __init__(self, clues: Sequence[Sequence[object]]) -> None:
        if isinstance(clues, (str, bytes, bytearray)):
            raise TypeError("Slitherlink clues must be a sequence of rows")
        try:
            rows = tuple(tuple(row) for row in clues)
        except TypeError as exc:
            raise TypeError(
                "Slitherlink clues must be a sequence of rows"
            ) from exc
        if not rows or not rows[0]:
            raise ValueError("Slitherlink clue grid must not be empty")
        board_cols = len(rows[0])
        if any(len(row) != board_cols for row in rows):
            raise ValueError("Slitherlink clue rows must have equal length")
        board_rows = len(rows)

        normalized_clues = tuple(
            tuple(
                _parse_slitherlink_clue(raw_clue, (row_index, col_index))
                for col_index, raw_clue in enumerate(row)
            )
            for row_index, row in enumerate(rows)
        )

        edge_keys: list[EdgeKey] = []
        endpoints: list[tuple[int, int]] = []
        vertex_cols = board_cols + 1
        for row in range(board_rows + 1):
            for col in range(board_cols):
                edge_keys.append(("H", row, col))
                endpoints.append(
                    (
                        row * vertex_cols + col,
                        row * vertex_cols + col + 1,
                    )
                )
        for row in range(board_rows):
            for col in range(board_cols + 1):
                edge_keys.append(("V", row, col))
                endpoints.append(
                    (
                        row * vertex_cols + col,
                        (row + 1) * vertex_cols + col,
                    )
                )

        super().__init__(edge_keys, max_elem=2)
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.clues = normalized_clues
        self.edge_endpoints = tuple(endpoints)

        rules: list[AllowedValueCountRule | SingleLoopRule] = []
        for row in range(board_rows):
            for col in range(board_cols):
                clue = self.clues[row][col]
                if clue is None:
                    continue
                face_edges = (
                    self.compact_cell(("H", row, col)),
                    self.compact_cell(("H", row + 1, col)),
                    self.compact_cell(("V", row, col)),
                    self.compact_cell(("V", row, col + 1)),
                )
                rules.append(
                    AllowedValueCountRule(
                        self,
                        cells=face_edges,
                        value=self.ON,
                        allowed_counts=(clue,),
                    )
                )

        incident: dict[int, list[int]] = {
            vertex: []
            for vertex in range((board_rows + 1) * (board_cols + 1))
        }
        for cell, (first, second) in enumerate(self.edge_endpoints):
            incident[first].append(cell)
            incident[second].append(cell)
        for edges in incident.values():
            rules.append(
                AllowedValueCountRule(
                    self,
                    cells=edges,
                    value=self.ON,
                    allowed_counts=(0, 2),
                )
            )
        rules.append(
            SingleLoopRule(
                self,
                cells=range(self.len),
                endpoints=self.edge_endpoints,
                selected_value=self.ON,
            )
        )
        self.add_rules_checked(rules)

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.board_rows = self.board_rows
        result.board_cols = self.board_cols
        result.clues = self.clues
        result.edge_endpoints = self.edge_endpoints

    @classmethod
    def from_tatham(
        cls,
        rows: int,
        cols: int,
        encoding: str,
    ) -> "Slitherlink":
        if any(
            isinstance(value, bool) or not isinstance(value, Integral)
            for value in (rows, cols)
        ):
            raise TypeError("Tatham dimensions must be integers")
        rows, cols = int(rows), int(cols)
        if rows <= 0 or cols <= 0:
            raise ValueError("Tatham dimensions must be positive")
        if not isinstance(encoding, str):
            raise TypeError("Tatham encoding must be text")
        encoding = encoding.strip()
        if not encoding:
            raise ValueError("Tatham encoding must not be empty")

        decoded: list[int | None] = []
        for character in encoding:
            if "0" <= character <= "4":
                decoded.append(int(character))
            elif "a" <= character <= "z":
                decoded.extend([None] * (ord(character) - ord("a") + 1))
            elif "A" <= character <= "Z":
                decoded.extend([None] * (ord(character) - ord("A") + 27))
            else:
                raise ValueError(
                    f"Unsupported character {character!r} in Tatham encoding"
                )
        expected = rows * cols
        if len(decoded) != expected:
            raise ValueError(
                f"Tatham encoding expands to {len(decoded)} clues, "
                f"expected {expected}"
            )
        return cls(
            tuple(
                tuple(decoded[index : index + cols])
                for index in range(0, expected, cols)
            )
        )

    def selected_edges(self, values: Sequence[int]) -> frozenset[EdgeKey]:
        keyed = self.values_by_key(values)
        return frozenset(
            edge
            for edge, value in keyed.items()
            if value == self.ON
        )

    def format_solution(self, values: Sequence[int]) -> str:
        keyed = self.values_by_key(values)

        def selected(edge: EdgeKey) -> bool:
            return keyed[edge] == self.ON

        lines: list[str] = []
        for row in range(self.board_rows + 1):
            horizontal = []
            for col in range(self.board_cols):
                horizontal.append("+")
                horizontal.append(
                    "---" if selected(("H", row, col)) else "   "
                )
            horizontal.append("+")
            lines.append("".join(horizontal))

            if row == self.board_rows:
                continue
            interior = []
            for col in range(self.board_cols):
                interior.append(
                    "|" if selected(("V", row, col)) else " "
                )
                clue = self.clues[row][col]
                interior.append(f" {clue if clue is not None else ' '} ")
            interior.append(
                "|" if selected(("V", row, self.board_cols)) else " "
            )
            lines.append("".join(interior))
        return "\n".join(lines)
''', encoding='utf-8')

Path('tests/test_new_puzzle_families.py').write_text('''from itertools import permutations, product
from pathlib import Path

import pytest

from gridsolver.abstract_grids.csp_rules_loading import (
    create_from_csp_rules,
    create_from_csp_rules_file,
    is_csp_rules_text,
)
from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str
from gridsolver.grid_classes.kakuro import Kakuro
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.rules.rules import InvalidGrid
from gridsolver.rules.topology import (
    ConsecutiveAdjacencyRule,
    SingleLoopRule,
)
from gridsolver.solver import atomic_solver, solver


_REPO_ROOT = Path(__file__).resolve().parents[1]


def _path_oracle(
    rows: int,
    cols: int,
    *,
    diagonal: bool,
    givens: dict[tuple[int, int], int],
    blocked: frozenset[tuple[int, int]] = frozenset(),
) -> set[tuple[int, ...]]:
    keys = tuple(
        (row, col)
        for row in range(rows)
        for col in range(cols)
        if (row, col) not in blocked
    )
    result: set[tuple[int, ...]] = set()
    for values in permutations(range(1, len(keys) + 1)):
        by_cell = dict(zip(keys, values))
        if any(by_cell[cell] != value for cell, value in givens.items()):
            continue
        positions = {value: cell for cell, value in by_cell.items()}
        valid = True
        for value in range(1, len(keys)):
            first = positions[value]
            second = positions[value + 1]
            row_distance = abs(first[0] - second[0])
            col_distance = abs(first[1] - second[1])
            adjacent = (
                max(row_distance, col_distance) == 1
                if diagonal
                else row_distance + col_distance == 1
            )
            if not adjacent:
                valid = False
                break
        if valid:
            result.add(values)
    return result


def _kakuro_2x2() -> Kakuro:
    white = tuple(product(range(2), repeat=2))
    runs = (
        (3, ((0, 0), (0, 1))),
        (3, ((1, 0), (1, 1))),
        (3, ((0, 0), (1, 0))),
        (3, ((0, 1), (1, 1))),
    )
    grid = Kakuro(2, 2, white, runs)
    grid.load_key_values({(0, 0): 1})
    return grid


def _kakuro_oracle(grid: Kakuro) -> set[tuple[int, ...]]:
    result: set[tuple[int, ...]] = set()
    for values in product(range(1, 10), repeat=grid.len):
        keyed = grid.values_by_key(values)
        if keyed[(0, 0)] != 1:
            continue
        if all(
            sum(keyed[cell] for cell in run.cells) == run.target
            and len({keyed[cell] for cell in run.cells}) == len(run.cells)
            for run in grid.runs
        ):
            result.add(values)
    return result


def _slitherlink_oracle(grid: Slitherlink) -> set[tuple[int, ...]]:
    result: set[tuple[int, ...]] = set()
    for values in product((grid.OFF, grid.ON), repeat=grid.len):
        keyed = grid.values_by_key(values)
        selected_cells = {
            cell
            for cell, value in enumerate(values)
            if value == grid.ON
        }
        if not selected_cells:
            continue

        clue_ok = True
        for row in range(grid.board_rows):
            for col in range(grid.board_cols):
                clue = grid.clues[row][col]
                if clue is None:
                    continue
                edges = (
                    ("H", row, col),
                    ("H", row + 1, col),
                    ("V", row, col),
                    ("V", row, col + 1),
                )
                if sum(keyed[edge] == grid.ON for edge in edges) != clue:
                    clue_ok = False
                    break
            if not clue_ok:
                break
        if not clue_ok:
            continue

        edges_by_vertex: dict[int, list[int]] = {}
        for cell in selected_cells:
            for vertex in grid.edge_endpoints[cell]:
                edges_by_vertex.setdefault(vertex, []).append(cell)
        if any(len(edges) != 2 for edges in edges_by_vertex.values()):
            continue

        remaining = set(selected_cells)
        stack = [remaining.pop()]
        seen = set(stack)
        while stack:
            cell = stack.pop()
            for vertex in grid.edge_endpoints[cell]:
                for neighbour in edges_by_vertex[vertex]:
                    if neighbour not in seen:
                        seen.add(neighbour)
                        remaining.discard(neighbour)
                        stack.append(neighbour)
        if not remaining:
            result.add(values)
    return result


def test_numbrix_matches_independent_2x2_oracle():
    grid = Numbrix.from_board(((1, 0), (4, 0)))

    expected = _path_oracle(
        2,
        2,
        diagonal=False,
        givens={(0, 0): 1, (1, 0): 4},
    )
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert expected == {(1, 2, 4, 3)}
    assert actual == expected


def test_hidato_uses_diagonal_adjacency_but_numbrix_does_not():
    board = ((1, 0), (0, 2))

    assert solver.solve(Hidato.from_board(board))
    assert not solver.solve(Numbrix.from_board(board))


def test_path_inputs_reject_duplicates_non_integral_and_disconnected_boards():
    with pytest.raises(ValueError, match="Duplicate path clue"):
        Hidato.from_board(((1, 1), (0, 0)))
    with pytest.raises(TypeError, match="integer"):
        Hidato.from_board(((1.5,),))
    with pytest.raises(ValueError, match="connected"):
        Hidato.from_board(
            (
                (1, "B", "B"),
                ("B", "B", "B"),
                ("B", "B", 2),
            )
        )


def test_numbrix_distance_parity_rejects_impossible_fixed_clues():
    grid = Numbrix.from_board(
        (
            (1, 0, 0),
            (0, 0, 0),
            (4, 0, 0),
        )
    )
    rule = next(
        rule
        for rule in grid.rules
        if isinstance(rule, ConsecutiveAdjacencyRule)
    )

    with pytest.raises(InvalidGrid):
        rule.apply(grid._known, grid._candidates)


def test_kakuro_matches_independent_small_oracle():
    grid = _kakuro_2x2()

    expected = _kakuro_oracle(grid)
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert expected == {(1, 2, 2, 1)}
    assert actual == expected


@pytest.mark.parametrize(
    ("runs", "message"),
    (
        (
            (
                (3, ((0, 0), (1, 1))),
                (3, ((0, 0), (1, 0))),
                (3, ((0, 1), (1, 1))),
            ),
            "straight",
        ),
        (
            (
                (2, ((0, 0), (0, 1))),
                (3, ((1, 0), (1, 1))),
                (3, ((0, 0), (1, 0))),
                (3, ((0, 1), (1, 1))),
            ),
            "impossible",
        ),
    ),
)
def test_kakuro_rejects_invalid_run_geometry_and_targets(runs, message):
    with pytest.raises(ValueError, match=message):
        Kakuro(
            2,
            2,
            tuple(product(range(2), repeat=2)),
            runs,
        )


def test_kakuro_requires_one_run_of_each_orientation_per_cell():
    white = tuple(product(range(2), range(3)))
    runs = (
        (3, ((0, 0), (0, 1))),
        (5, ((0, 1), (0, 2))),
        (6, ((1, 0), (1, 1), (1, 2))),
        (3, ((0, 0), (1, 0))),
        (4, ((0, 1), (1, 1))),
        (5, ((0, 2), (1, 2))),
    )

    with pytest.raises(ValueError, match="exactly one horizontal"):
        Kakuro(2, 3, white, runs)


def test_slitherlink_matches_independent_1x2_oracle():
    grid = Slitherlink(((None, None),))

    expected = _slitherlink_oracle(grid)
    actual = {tuple(solution) for solution in solver.solve(grid)}

    assert len(expected) == 3
    assert actual == expected


def test_slitherlink_clue_four_has_the_perimeter_loop():
    grid = Slitherlink(((4,),))

    solutions = solver.solve(grid)

    assert len(solutions) == 1
    solution = next(iter(solutions))
    assert grid.selected_edges(solution) == frozenset(grid.cell_to_key)


def test_slitherlink_strict_clue_parsing_and_tatham_decoding():
    with pytest.raises(TypeError, match="must be an integer"):
        Slitherlink(((2.5,),))
    decoded = Slitherlink.from_tatham(1, 3, "1a2")
    assert decoded.clues == ((1, None, 2),)


def test_single_loop_removes_edges_that_cannot_belong_to_any_cycle():
    grid = Grid(1, 4, max_elem=2)
    rule = SingleLoopRule(
        grid,
        cells=range(4),
        endpoints=((0, 1), (1, 2), (2, 0), (2, 3)),
    )

    rule.apply(grid._known, grid._candidates)

    assert grid._candidates[3] == {1}
    assert all(2 in grid._candidates[cell] for cell in range(3))


def test_single_loop_rejects_two_selected_cycles():
    grid = Grid(1, 6, max_elem=2)
    for candidates in grid._candidates:
        candidates.intersection_update((2,))
    rule = SingleLoopRule(
        grid,
        cells=range(6),
        endpoints=(
            (0, 1),
            (1, 2),
            (2, 0),
            (3, 4),
            (4, 5),
            (5, 3),
        ),
    )

    with pytest.raises(InvalidGrid):
        rule.apply(grid._known, grid._candidates)


def test_compact_grids_do_not_enter_sudoku_power_techniques(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Sudoku-only technique ran on a compact grid")

    monkeypatch.setattr(atomic_solver, "locked_candidate", unexpected)
    grid = Numbrix.from_board(((0, 0), (0, 0)))

    assert solver.solve(grid, max_sols=1)


def test_compact_solution_logging_uses_the_puzzle_renderer(monkeypatch):
    grid = Numbrix.from_board(((1, 0), (4, 0)))
    solution = next(iter(solver.solve(grid)))
    messages: list[str] = []

    monkeypatch.setattr(
        solver._lg,
        "logs",
        lambda level, message, **kwargs: messages.append(message),
    )
    monkeypatch.setattr(
        solver._lg,
        "logg",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("rectangular logger should not render CompactGrid")
        ),
    )

    solver._log_solution(grid, solution)

    assert messages == [grid.format_solution(solution)]


def test_normal_file_loader_detects_csp_rules_clp(tmp_path):
    path = tmp_path / "one.clp"
    path.write_text(
        "(solve\n1 1\n4\n)\n",
        encoding="utf-8",
    )

    grid = create_from_file(path)

    assert isinstance(grid, Slitherlink)
    assert grid.clues == ((4,),)


def test_normal_string_loader_detects_csp_rules_form():
    text = "(solve Numbrix topological 2 4 1 . 4 .)"

    assert is_csp_rules_text(text)
    grid = create_from_str(text)

    assert isinstance(grid, Numbrix)


@pytest.mark.parametrize(
    ("relative_path", "expected_type"),
    (
        (
            "Examples/Hidato/Mebane/Mebane-III.1-S.clp",
            Hidato,
        ),
        (
            "Examples/Numbrix/Parade/2012-10-21-Expert-S2.clp",
            Numbrix,
        ),
        (
            "Examples/Kakuro/ATK/10x10-E81712.clp",
            Kakuro,
        ),
        (
            "Examples/Slitherlink/Tatham/H7x7-L10-W5.clp",
            Slitherlink,
        ),
    ),
)
def test_representative_retained_corpora_parse(relative_path, expected_type):
    grid = create_from_csp_rules_file(_REPO_ROOT / relative_path)

    assert isinstance(grid, expected_type)


def test_csp_rules_parser_rejects_malformed_forms():
    with pytest.raises(ValueError, match="no solve form"):
        create_from_csp_rules("not a puzzle")
    with pytest.raises(ValueError, match="not closed"):
        create_from_csp_rules("(solve 1 1 .")
''', encoding='utf-8')

CSP = Path("gridsolver/abstract_grids/csp_rules_loading.py")
replace_once(CSP, '_SOLVE_START = re.compile(r"\\((solve(?:-tatham)?)\\b", re.IGNORECASE)\n\n\n', '_SOLVE_START = re.compile(r"\\((solve(?:-tatham)?)\\b", re.IGNORECASE)\n\n\ndef is_csp_rules_text(text: object) -> bool:\n    """Return whether text contains a supported CSP-Rules solve form."""\n    return isinstance(text, str) and _SOLVE_START.search(text) is not None\n\n\n', 'CSP solve-form detection helper')

LOADING = Path("gridsolver/abstract_grids/grid_loading.py")
replace_between(LOADING, 'def create_from_file(\n', 'def create_from_str(\n', 'def create_from_file(\n    path: Path | str,\n    /,\n    row_wise: bool = True,\n    space_sep: bool = False,\n) -> Grid:\n    """Load a normal class-prefixed puzzle or a CSP-Rules solve file."""\n    row_wise, space_sep = _validate_load_options(row_wise, space_sep)\n    path = path if isinstance(path, Path) else Path(path)\n    text = path.read_text(encoding="utf-8")\n\n    from gridsolver.abstract_grids.csp_rules_loading import (\n        create_from_csp_rules,\n        is_csp_rules_text,\n    )\n\n    if path.suffix.lower() == ".clp" or is_csp_rules_text(text):\n        return create_from_csp_rules(text)\n\n    lines = (line.strip() for line in text.splitlines())\n    payload = "\\n".join(\n        line\n        for line in lines\n        if line and not line.startswith("#")\n    )\n    return create_from_str(\n        payload,\n        row_wise=row_wise,\n        space_sep=space_sep,\n    )\n\n\n', 'normal file loader integration')

replace_between(LOADING, 'def create_from_str(\n', 'def create_from_str_and_class(\n', 'def create_from_str(\n    values: str,\n    /,\n    row_wise: bool = True,\n    space_sep: bool = False,\n) -> Grid:\n    """Load a class-prefixed puzzle or a CSP-Rules solve form."""\n    row_wise, space_sep = _validate_load_options(row_wise, space_sep)\n    if not isinstance(values, str):\n        raise TypeError(\n            f"Puzzle input must be str, got {type(values).__name__}"\n        )\n\n    from gridsolver.abstract_grids.csp_rules_loading import (\n        create_from_csp_rules,\n        is_csp_rules_text,\n    )\n\n    if is_csp_rules_text(values):\n        return create_from_csp_rules(values)\n\n    class_name, separator, payload = values.partition("::")\n    if not separator:\n        raise ValueError("Puzzle string contains no :: class separator")\n    return create_from_str_and_class(\n        payload,\n        class_name,\n        row_wise=row_wise,\n        space_sep=space_sep,\n    )\n\n\n', 'normal string loader integration')

ATOMIC = Path("gridsolver/solver/atomic_solver.py")
replace_once(ATOMIC, '    def _solve_power_actions(self) -> Iterator[str]:\n        grid = self.grid\n        # Expensive zero-hit tiers are skipped inside forcing-chain branches but\n', '    def _solve_power_actions(self) -> Iterator[str]:\n        grid = self.grid\n        # Compact and graph-variable puzzle families deliberately rely on their\n        # own rules plus complete backtracking. Sudoku-specific pattern methods\n        # assume house geometry that those grids do not have.\n        if not getattr(grid, "supports_advanced_techniques", True):\n            return\n\n        # Expensive zero-hit tiers are skipped inside forcing-chain branches but\n', 'advanced-technique capability check')

SOLVER = Path("gridsolver/solver/solver.py")
replace_once(SOLVER, 'def _cap_solutions(\n    solutions: set[ImmutableGrid],\n    max_sols: int,\n) -> set[ImmutableGrid]:\n    if max_sols > 0 and len(solutions) > max_sols:\n        return set(sorted(solutions, key=_solution_key)[:max_sols])\n    return solutions\n\n\n', 'def _cap_solutions(\n    solutions: set[ImmutableGrid],\n    max_sols: int,\n) -> set[ImmutableGrid]:\n    if max_sols > 0 and len(solutions) > max_sols:\n        return set(sorted(solutions, key=_solution_key)[:max_sols])\n    return solutions\n\n\ndef _log_solution(grid: Grid, solution: ImmutableGrid) -> None:\n    """Render a solution using puzzle geometry when the grid provides it."""\n    formatter = getattr(grid, "format_solution", None)\n    if callable(formatter):\n        _lg.logs(0, formatter(solution))\n        return\n    _lg.logg(\n        0,\n        solution,\n        format_args=grid.format_args,\n        rules=grid.rules,\n    )\n\n\n', 'solution renderer helper')

replace_once(SOLVER, '            _lg.logg(\n                0,\n                solution,\n                format_args=grid.format_args,\n                rules=grid.rules,\n            )\n', '            _log_solution(grid, solution)\n', 'solution renderer dispatch')

CI = Path(".github/workflows/ci.yml")
ci_text = CI.read_text(encoding="utf-8")
marker = "          tests/test_parser_fuzzing.py\n"
if ci_text.count(marker) != 2:
    raise SystemExit(
        f"CI new-family marker: expected 2, found {ci_text.count(marker)}"
    )
CI.write_text(
    ci_text.replace(
        marker,
        marker + "          tests/test_new_puzzle_families.py\n",
    ),
    encoding="utf-8",
)

README = Path("README.md")
readme = README.read_text(encoding="utf-8")
readme = readme.replace(
    "Constraint-propagation solver for Sudoku, Futoshiki, Killer Sudoku, "
    "KenKen, and Latin Squares.",
    "Constraint-propagation solver for Sudoku, Futoshiki, Killer Sudoku, "
    "KenKen, Latin Squares, Hidato, Numbrix, Kakuro, and Slitherlink.",
)
old = (
    "The Hidato, Kakuro, Numbrix, and Slitherlink corpora under `Examples/` "
    "are intentionally retained as source material for future puzzle-family "
    "implementations. The current runtime does not load those formats yet."
)
new = (
    "Hidato, Numbrix, Kakuro, and Slitherlink are supported through their "
    "retained CSP-Rules `.clp` corpora. `gridpuzzle --file puzzle.clp` "
    "auto-detects those formats. Their models use compact keyed variables so "
    "blocked cells and graph edges are not represented as fake board values."
)
if old not in readme:
    raise SystemExit("README future-family paragraph marker changed")
README.write_text(readme.replace(old, new), encoding="utf-8")
