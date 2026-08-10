"""Hidato and Numbrix compact-grid implementations."""

from collections.abc import Iterable, Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.rules.topology import ConsecutiveAdjacencyRule
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


type BoardCell = tuple[int, int]


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

        blocked_cells = frozenset(blocked)
        for cell in blocked_cells:
            if (
                not isinstance(cell, tuple)
                or len(cell) != 2
                or any(
                    isinstance(value, bool) or not isinstance(value, Integral)
                    for value in cell
                )
            ):
                raise TypeError(f"Invalid blocked board cell {cell!r}")
            row, col = map(int, cell)
            if not (0 <= row < board_rows and 0 <= col < board_cols):
                raise ValueError(
                    f"Blocked cell {(row, col)} is outside "
                    f"a {board_rows}x{board_cols} board"
                )
        if blocked_cells and not self.allow_blocks:
            raise ValueError(f"{type(self).__name__} does not support blocked cells")

        keys = tuple(
            (row, col)
            for row in range(board_rows)
            for col in range(board_cols)
            if (row, col) not in blocked_cells
        )
        if not keys:
            raise ValueError("At least one playable path cell is required")
        super().__init__(keys, max_elem=len(keys))
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.blocked = blocked_cells

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
        rows = tuple(tuple(row) for row in board)
        if not rows or not rows[0]:
            raise ValueError("Path board must not be empty")
        width = len(rows[0])
        if any(len(row) != width for row in rows):
            raise ValueError("Path board rows must all have the same length")

        blocked: set[BoardCell] = set()
        givens: dict[BoardCell, int] = {}
        for row_index, row in enumerate(rows):
            for col_index, raw_value in enumerate(row):
                key = (row_index, col_index)
                if isinstance(raw_value, str) and raw_value.strip().upper() in {
                    "B",
                    "#",
                }:
                    blocked.add(key)
                    continue
                if raw_value is None or raw_value == "." or raw_value == 0 or raw_value == "0":
                    continue
                if isinstance(raw_value, bool) or not isinstance(raw_value, Integral):
                    try:
                        value = int(raw_value)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(
                            f"Cannot parse path value {raw_value!r} at {key}"
                        ) from exc
                else:
                    value = int(raw_value)
                if value <= 0:
                    raise ValueError(f"Path clues must be positive, got {value}")
                givens[key] = value

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
