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

        normalized_white: set[BoardCell] = set()
        for raw_cell in white_cells:
            if (
                not isinstance(raw_cell, tuple)
                or len(raw_cell) != 2
                or any(
                    isinstance(value, bool) or not isinstance(value, Integral)
                    for value in raw_cell
                )
            ):
                raise TypeError(f"Invalid Kakuro white cell {raw_cell!r}")
            cell = tuple(map(int, raw_cell))
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
        coverage = {cell: 0 for cell in self.white_cells}
        rules: list[SumAndElementsAtMostOnce] = []
        seen_runs: set[frozenset[BoardCell]] = set()
        for raw_run in runs:
            if isinstance(raw_run, KakuroRun):
                target = raw_run.target
                cells = raw_run.cells
            else:
                try:
                    target, raw_cells = raw_run
                except (TypeError, ValueError) as exc:
                    raise TypeError(
                        "Kakuro runs must be KakuroRun or (target, cells) pairs"
                    ) from exc
                cells = tuple(raw_cells)
            if isinstance(target, bool) or not isinstance(target, Integral):
                raise TypeError("Kakuro run targets must be integers")
            target = int(target)
            if target <= 0:
                raise ValueError("Kakuro run targets must be positive")
            cells = tuple(cells)
            if not cells:
                raise ValueError("Kakuro runs must contain at least one cell")
            if len(cells) > 9:
                raise ValueError("Kakuro runs cannot contain more than nine cells")
            if len(cells) != len(set(cells)):
                raise ValueError("Kakuro run cells must be unique")
            if any(cell not in self.white_cells for cell in cells):
                raise ValueError("Kakuro runs may contain only white cells")
            run_key = frozenset(cells)
            if run_key in seen_runs:
                raise ValueError("Duplicate Kakuro run")
            seen_runs.add(run_key)
            for cell in cells:
                coverage[cell] += 1

            run = KakuroRun(target=target, cells=tuple(cells))
            normalized_runs.append(run)
            rules.append(
                SumAndElementsAtMostOnce(
                    self,
                    cells=[self.compact_cell(cell) for cell in cells],
                    mysum=target,
                )
            )

        missing = [cell for cell, count in coverage.items() if count != 2]
        if missing:
            raise ValueError(
                "Every Kakuro white cell must belong to exactly one horizontal "
                f"and one vertical run; invalid cells: {missing}"
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
