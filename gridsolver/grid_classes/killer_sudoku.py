from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import (
    _boolean_option,
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
    pairs,
)
from gridsolver.grid_classes.cage_loading import (
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

    def load_with_dic(
        self,
        sum_cells: str | Iterable[str],
        dic: Mapping[str, int],
        row_wise: bool = True,
    ) -> None:
        """Load a single-character cage layout plus a mapping of cage sums."""
        row_wise = _boolean_option("row_wise", row_wise)
        if self.has_been_filled:
            raise RuntimeError("Grid can only be filled once; or be used in individual access mode")

        labels = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)

        final_dic: dict[str, SumCellPair] = {}
        label_iter = iter(labels)
        for first in range(self.rows if row_wise else self.cols):
            for second in range(self.cols if row_wise else self.rows):
                label = next(label_iter)
                try:
                    cage_sum = dic[label]
                except KeyError as exc:
                    raise ValueError(
                        f"Missing Killer Sudoku cage definition for {label!r}"
                    ) from exc
                entry = final_dic.setdefault(
                    label,
                    SumCellPair(mysum=cage_sum, cells=[]),
                )
                entry.cells.append(
                    (first, second) if row_wise else (second, first)
                )

        unused_labels = set(dic).difference(final_dic)
        if unused_labels:
            rendered = ", ".join(sorted(repr(label) for label in unused_labels))
            raise ValueError(f"Unused Killer Sudoku cage definitions: {rendered}")

        # Build every rule before changing the grid, then commit the complete set.
        self.ext_sum_cells(final_dic.values())
        self.has_been_filled = True
