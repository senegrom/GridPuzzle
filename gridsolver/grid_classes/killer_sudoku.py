from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import _load_preprocess_str, _load_preprocess_str_space_sep, pairs
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

        for rule in rules:
            self.add_rule_checked(rule)

    @staticmethod
    def _load_preprocess_colon_split(
        sum_cells_and_dic: str | Iterable[str],
    ) -> tuple[str, str]:
        if isinstance(sum_cells_and_dic, str):
            text = sum_cells_and_dic
        elif isinstance(sum_cells_and_dic, Iterable):
            # Materialise once so one-shot iterables are not consumed by a
            # separate membership check. Newlines are stripped later by the
            # normal puzzle preprocessors.
            text = "\n".join(str(part) for part in sum_cells_and_dic)
        else:
            raise TypeError(
                f"Input type {type(sum_cells_and_dic).__name__} is not supported"
            )

        if ":" not in text:
            raise ValueError("Puzzle string contains no : separator")
        # Split only the layout separator. KenKen also permits ':' as a
        # division operator in the dictionary section.
        layout, dictionary_text = text.split(":", 1)
        return layout, dictionary_text

    def load(
        self,
        sum_cells_and_dic: str | Iterable[str],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        """Load a cage layout followed by a single-character sum dictionary."""
        sum_cells, dictionary_text = self._load_preprocess_colon_split(
            sum_cells_and_dic
        )
        sum_cells = (
            _load_preprocess_str_space_sep(sum_cells)
            if space_sep
            else _load_preprocess_str(sum_cells)
        )
        dictionary_text = _load_preprocess_str(dictionary_text)

        index = 0
        definitions: dict[str, int] = {}
        while index < len(dictionary_text):
            label = dictionary_text[index]
            index += 1
            start = index
            while index < len(dictionary_text) and dictionary_text[index].isnumeric():
                index += 1
            if index == start:
                raise ValueError("KillerSudoku string format invalid")
            if label in definitions:
                raise ValueError(
                    f"Duplicate Killer Sudoku cage definition for {label!r}"
                )
            definitions[label] = int(dictionary_text[start:index])

        self.load_with_dic(sum_cells, definitions, row_wise)

    def load_with_dic(
        self,
        sum_cells: str | Iterable[str],
        dic: Mapping[str, int],
        row_wise: bool = True,
    ) -> None:
        """Load a single-character cage layout plus a mapping of cage sums."""
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

        # Build every rule before changing the grid, then commit the complete set.
        self.ext_sum_cells(final_dic.values())
        self.has_been_filled = True
