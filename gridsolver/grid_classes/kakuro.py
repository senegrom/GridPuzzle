"""Kakuro compact white-cell grid."""

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

            # Infeasible targets are deliberately NOT rejected here: an
            # impossible run is an unsatisfiable puzzle, not malformed input,
            # and solves to zero solutions like any other contradiction.

            run_key = orientation, cells
            if run_key in seen_runs:
                raise ValueError("Duplicate Kakuro run")
            seen_runs.add(run_key)

            if orientation == "H":
                before = (cells[0][0], cells[0][1] - 1)
                after = (cells[-1][0], cells[-1][1] + 1)
            else:
                before = (cells[0][0] - 1, cells[0][1])
                after = (cells[-1][0] + 1, cells[-1][1])
            if before in self.white_cells or after in self.white_cells:
                raise ValueError(
                    "Kakuro runs must be maximal between black cells or board edges"
                )

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
