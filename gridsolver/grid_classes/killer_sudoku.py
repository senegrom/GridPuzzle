from numbers import Integral
from typing import Iterable, NamedTuple, Mapping, Dict, Union, List, Tuple

from gridsolver.abstract_grids.grid import _load_preprocess_str_space_sep, _load_preprocess_str, pairs
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


class SumCellPair(NamedTuple):
    mysum: int
    cells: List


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniqueness condition."""

    def __init__(self, sum_cells: Iterable[SumCellPair] = None, rows_in_box: int = 3, cols_in_box: int = 3,
                 box_rows: int = 3, box_cols: int = 3):
        super().__init__(rows_in_box, cols_in_box, box_rows, box_cols)
        if sum_cells is not None:
            self.ext_sum_cells(sum_cells)

    def ext_sum_cells(self, sum_cells: Iterable[
        SumCellPair | Tuple[int, List[Integral | Tuple[Integral, Integral]]]]) -> None:
        """Add cages, accepting coordinate pairs or flat row/column pairs per cage."""
        for mysum, cells in sum_cells:
            cells = list(cells)
            if not cells:
                raise ValueError("Killer Sudoku cages must contain at least one cell")
            if isinstance(cells[0], Integral):
                if len(cells) % 2:
                    raise ValueError("Flat cage coordinates must contain complete row/column pairs")
                cells = pairs(cells)
            self.add_rule_checked(SumAndElementsAtMostOnce(gsz=self, cells=cells, mysum=mysum))

    @staticmethod
    def _load_preprocess_colon_split(sum_cells_and_dic: Union[str, Iterable[str]]):
        if isinstance(sum_cells_and_dic, str):
            text = sum_cells_and_dic
        elif isinstance(sum_cells_and_dic, Iterable):
            # Materialise once so one-shot iterables are not consumed by a
            # separate membership check. Newlines are stripped later by the
            # normal puzzle preprocessors.
            text = "\n".join(str(part) for part in sum_cells_and_dic)
        else:
            raise TypeError(f"Input type {type(sum_cells_and_dic).__name__} is not supported")

        if ":" not in text:
            raise ValueError("Puzzle string contains no : separator")
        # Split only the layout separator. KenKen also permits ':' as a
        # division operator in the dictionary section.
        return text.split(":", 1)

    def load(self, sum_cells_and_dic: Union[str, Iterable[str]], /, row_wise=True, space_sep=False) -> None:
        """Load a cage layout followed by a single-character sum dictionary."""
        sum_cells, str_dic = self._load_preprocess_colon_split(sum_cells_and_dic)
        if space_sep:
            sum_cells = _load_preprocess_str_space_sep(sum_cells)
        else:
            sum_cells = _load_preprocess_str(sum_cells)
        str_dic = _load_preprocess_str(str_dic)
        idx = 0
        dic = {}
        while idx < len(str_dic):
            char = str_dic[idx]
            idx += 1
            start = idx
            while idx < len(str_dic) and str_dic[idx].isnumeric():
                idx += 1
            if idx == start:
                raise ValueError("KillerSudoku string format invalid.")
            dic[char] = int(str_dic[start:idx])
        self.load_with_dic(sum_cells, dic, row_wise)

    def load_with_dic(self, sum_cells: Union[str, Iterable[str]], dic: Mapping[str, int], row_wise=True) -> None:
        """Load a single-character cage layout plus a mapping of cage sums."""
        if self.has_been_filled:
            raise RuntimeError("Grid can only be filled once; or be used in individual access mode")
        sum_cells = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        final_dic: Dict[str, SumCellPair] = {}
        char_iter = iter(sum_cells)
        for c1 in range(self.rows if row_wise else self.cols):
            for c2 in range(self.cols if row_wise else self.rows):
                char = next(char_iter)
                try:
                    cage_sum = dic[char]
                except KeyError as exc:
                    raise ValueError(f"Missing Killer Sudoku cage definition for {char!r}") from exc
                entry = final_dic.setdefault(char, SumCellPair(mysum=cage_sum, cells=[]))
                entry.cells.append((c1, c2) if row_wise else (c2, c1))
        self.ext_sum_cells(final_dic.values())
