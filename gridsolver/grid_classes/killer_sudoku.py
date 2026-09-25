from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import pairs
from gridsolver.grid_classes.cage_loading import (
    load_cage_layout,
    load_compact_cages,
    parse_killer_dictionary,
)
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


class SumCellPair(NamedTuple):
    mysum: int
    cells: list


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniqueness condition."""

    def __init__(
        self,
        sum_cells: Iterable[SumCellPair] | None = None,
        rows_in_box: int = 3,
        cols_in_box: int = 3,
        box_rows: int = 3,
        box_cols: int = 3,
    ) -> None:
        super().__init__(rows_in_box, cols_in_box, box_rows, box_cols)
        if sum_cells is not None:
            self.ext_sum_cells(sum_cells)

    def ext_sum_cells(self, sum_cells: Iterable[SumCellPair]) -> None:
        """Add cages atomically, accepting coordinate pairs or flat pairs."""
        rules: list[SumAndElementsAtMostOnce] = []
        for cage_sum, raw_cells in sum_cells:
            cells = list(raw_cells)
            if not cells:
                raise ValueError("Killer Sudoku cages must contain at least one cell")
            if isinstance(cells[0], Integral):
                if len(cells) % 2:
                    raise ValueError("Flat cage coordinates must contain complete row/column pairs")
                cells = list(pairs(cells))
            rules.append(
                SumAndElementsAtMostOnce(gsz=self, cells=cells, mysum=cage_sum)
            )

        self.add_rules_checked(rules)

    def load(
        self,
        sum_cells_and_dic: str | Iterable[str],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        """Load a cage layout followed by a single-character sum dictionary."""
        load_compact_cages(
            self,
            sum_cells_and_dic,
            row_wise,
            space_sep,
            parse_dictionary=parse_killer_dictionary,
        )

    @staticmethod
    def _make_cage_entry(cage_sum: int) -> SumCellPair:
        return SumCellPair(mysum=cage_sum, cells=[])

    def load_with_dic(
        self,
        sum_cells: str | Iterable[str],
        dic: Mapping[str, int],
        row_wise: bool = True,
    ) -> None:
        """Load a single-character cage layout plus a mapping of cage sums."""
        load_cage_layout(
            self,
            sum_cells,
            dic,
            row_wise,
            family="Killer Sudoku",
            make_entry=self._make_cage_entry,
            commit=self.ext_sum_cells,
        )
