"""Hidato and Numbrix compact-grid implementations."""

from collections.abc import Iterable, Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.grid_classes.compact_grid import CompactGrid, _rectangular_rows
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
        rows = _rectangular_rows(board, "Path board")
        width = len(rows[0])

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
    technique_profile = TechniqueProfile.RULES_ONLY
