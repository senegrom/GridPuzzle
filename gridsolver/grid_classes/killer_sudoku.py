from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import (
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
    pairs,
)
from gridsolver.grid_classes.cage_loading import (
    load_cage_layout,
    parse_killer_dictionary,
    split_cage_input,
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

    # Compatibility alias for extension code that used the historical private
    # helper. KenKen imports the shared implementation directly and no longer
    # loads the Killer Sudoku module merely to split text.
    _load_preprocess_colon_split = staticmethod(split_cage_input)

    def load(
        self,
        sum_cells_and_dic: str | Iterable[str],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        """Load a cage layout followed by a single-character sum dictionary."""
        row_wise, space_sep = _validate_load_options(row_wise, space_sep)
        sum_cells, dictionary_text = split_cage_input(sum_cells_and_dic)
        sum_cells = (
            _load_preprocess_str_space_sep(sum_cells)
            if space_sep
            else _load_preprocess_str(sum_cells)
        )
        dictionary_text = _load_preprocess_str(dictionary_text)
        definitions = parse_killer_dictionary(
            dictionary_text,
            sum_cells,
            self.max_elem,
        )
        self.load_with_dic(sum_cells, definitions, row_wise)

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
