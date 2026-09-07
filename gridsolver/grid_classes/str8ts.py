"""Str8ts puzzle grid: row/column uniqueness plus consecutive streets."""

from collections.abc import Iterable, Sequence
from numbers import Integral

from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.grid_classes.compact_grid import CompactGrid, _rectangular_rows
from gridsolver.rules.straights import ConsecutiveSetRule
from gridsolver.rules.unique import ElementsAtMostOnce


type BoardCell = tuple[int, int]


def _cell(raw: object, rows: int, cols: int, description: str) -> BoardCell:
    if (
        isinstance(raw, (str, bytes, bytearray))
        or not isinstance(raw, Sequence)
        or len(raw) != 2
        or any(isinstance(v, bool) or not isinstance(v, Integral) for v in raw)
    ):
        raise TypeError(f"Invalid {description} {raw!r}")
    row, col = map(int, raw)
    if not (0 <= row < rows and 0 <= col < cols):
        raise ValueError(f"{description} {(row, col)} is outside a {rows}x{cols} board")
    return row, col


def _cells(
    raw: Iterable[BoardCell], rows: int, cols: int, description: str
) -> frozenset[BoardCell]:
    if isinstance(raw, (str, bytes, bytearray)):
        raise TypeError(f"{description} must be coordinate pairs")
    singular = description[:-1] if description.endswith("s") else description
    return frozenset(_cell(item, rows, cols, singular) for item in raw)


class Str8ts(CompactGrid):
    """Square Str8ts board with optional numbered black cells.

    White cells form horizontal/vertical streets. Every street contains a
    consecutive set in arbitrary order. All numbered cells, including clues
    printed on black cells, remain unique within their row and column.
    """

    technique_profile = TechniqueProfile.RULES_ONLY

    def __init__(
        self,
        board_rows: int = 9,
        board_cols: int | None = None,
        *,
        black: Iterable[BoardCell] = (),
        numbered_black: Iterable[BoardCell] = (),
    ) -> None:
        for name, value in (
            ("board_rows", board_rows),
            ("board_cols", board_cols if board_cols is not None else board_rows),
        ):
            if isinstance(value, bool) or not isinstance(value, Integral):
                raise TypeError(f"{name} must be an integer")
        board_rows = int(board_rows)
        board_cols = board_rows if board_cols is None else int(board_cols)
        if board_rows != board_cols or not 2 <= board_rows <= 9:
            raise ValueError("Str8ts requires a square board from 2x2 through 9x9")

        black_cells = _cells(black, board_rows, board_cols, "black cells")
        numbered = _cells(
            numbered_black, board_rows, board_cols, "numbered black cells"
        )
        if not numbered <= black_cells:
            raise ValueError("Numbered black cells must also be black cells")

        all_cells = frozenset(
            (row, col)
            for row in range(board_rows)
            for col in range(board_cols)
        )
        white = all_cells - black_cells
        if not white:
            raise ValueError("Str8ts requires at least one white cell")
        active = tuple(sorted(white | numbered))
        super().__init__(active, max_elem=board_rows)
        self.board_rows = board_rows
        self.board_cols = board_cols
        self.black = black_cells
        self.numbered_black = numbered
        self.white_cells = white

        rules = []
        for row in range(board_rows):
            group = [self.compact_cell(cell) for cell in active if cell[0] == row]
            if len(group) > 1:
                rules.append(ElementsAtMostOnce(self, cells=group))
        for col in range(board_cols):
            group = [self.compact_cell(cell) for cell in active if cell[1] == col]
            if len(group) > 1:
                rules.append(ElementsAtMostOnce(self, cells=group))

        streets: list[tuple[BoardCell, ...]] = []
        for row in range(board_rows):
            run: list[BoardCell] = []
            for col in range(board_cols + 1):
                cell = (row, col)
                if col < board_cols and cell in white:
                    run.append(cell)
                else:
                    if len(run) > 1:
                        street = tuple(run)
                        streets.append(street)
                        rules.append(
                            ConsecutiveSetRule(
                                self, [self.compact_cell(x) for x in street]
                            )
                        )
                    run = []
        for col in range(board_cols):
            run = []
            for row in range(board_rows + 1):
                cell = (row, col)
                if row < board_rows and cell in white:
                    run.append(cell)
                else:
                    if len(run) > 1:
                        street = tuple(run)
                        streets.append(street)
                        rules.append(
                            ConsecutiveSetRule(
                                self, [self.compact_cell(x) for x in street]
                            )
                        )
                    run = []
        self.streets = tuple(streets)
        self.add_rules_checked(rules)

    def _copy_extra_state_to(self, result: Grid) -> None:
        super()._copy_extra_state_to(result)
        result.board_rows = self.board_rows
        result.board_cols = self.board_cols
        result.black = self.black
        result.numbered_black = self.numbered_black
        result.white_cells = self.white_cells
        result.streets = self.streets

    @classmethod
    def from_board(
        cls,
        board: Sequence[Sequence[object]],
        *,
        black: Iterable[BoardCell] = (),
    ) -> "Str8ts":
        rows = _rectangular_rows(board, "Str8ts board")
        n = len(rows)
        if len(rows[0]) != n:
            raise ValueError("Str8ts requires a square board")
        explicit_black = set(_cells(black, n, n, "black cells"))
        givens: dict[BoardCell, int] = {}
        for row, values in enumerate(rows):
            for col, raw in enumerate(values):
                key = (row, col)
                if raw is None:
                    continue
                if isinstance(raw, str):
                    token = raw.strip()
                    if token.upper() in {"#", "B"}:
                        explicit_black.add(key)
                        continue
                    if token in {"", ".", "0"}:
                        continue
                    if not token.isascii() or not token.isdigit():
                        raise ValueError(
                            f"Cannot parse Str8ts value {raw!r} at {key}"
                        )
                    value = int(token)
                elif isinstance(raw, bool) or not isinstance(raw, Integral):
                    raise TypeError(
                        f"Str8ts value at {key} must be an integer, blank, or #"
                    )
                else:
                    value = int(raw)
                    if value == 0:
                        continue
                if not 1 <= value <= n:
                    raise ValueError(
                        f"Str8ts value {value} at {key} is outside 1..{n}"
                    )
                givens[key] = value
        numbered = set(givens) & explicit_black
        grid = cls(n, n, black=explicit_black, numbered_black=numbered)
        grid.load_key_values(givens)
        return grid

    def format_solution(self, values: Sequence[int]) -> str:
        keyed = self.values_by_key(values)
        lines = []
        for row in range(self.board_rows):
            rendered = []
            for col in range(self.board_cols):
                key = (row, col)
                if key in self.black and key not in keyed:
                    rendered.append("#")
                elif key in self.black:
                    rendered.append(f"[{keyed[key]}]")
                else:
                    rendered.append(str(keyed[key]))
            lines.append(" ".join(rendered))
        return "\n".join(lines)
