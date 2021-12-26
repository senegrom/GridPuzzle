from itertools import chain
from numbers import Integral
from typing import Iterable, NamedTuple, Mapping, Dict, MutableSequence

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


class _SumCellPair(NamedTuple):
    mysum: int
    cells: MutableSequence


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniquencess condition"""

    def __init__(self, sum_cells: Iterable[_SumCellPair] = None, rows_in_box: int = 3, cols_in_box: int = 3,
                 box_rows: int = 3, box_cols: int = 3):
        super().__init__(rows_in_box, cols_in_box, box_rows, box_cols)
        if sum_cells is not None:
            self.ext_sum_cells(sum_cells)

    def ext_sum_cells(self, sum_cells: Iterable[_SumCellPair]) -> None:
        """Add sum cells. Accepts a list of pairs."""
        first, *sum_cells = sum_cells
        sum_cells = chain([first], sum_cells)
        if isinstance(first[1][0], Integral):
            self.ext_rules(SumAndElementsAtMostOnce,
                           [{"mysum": mysum, "cells": KillerSudoku._pairs(cells)} for mysum, cells in sum_cells],
                           None)
        else:
            self.ext_rules(SumAndElementsAtMostOnce, [{"mysum": mysum, "cells": cells} for mysum, cells in sum_cells],
                           None)

    @staticmethod
    def _pairs(it: Iterable):
        it = iter(it)
        try:
            while True:
                a = next(it)
                b = next(it)
                yield a, b
        except StopIteration:
            pass

    def load(self, sum_cells_and_dic: str, /, row_wise=True) -> None:
        """Input grid with single char per "group" as multiline string.
        Plus a dictionary for the sums seperated by colons with a single character for the cell values"""
        sum_cells_and_dic = self._load_preprocess_str(sum_cells_and_dic)
        sum_cells: str
        str_dic: str
        sum_cells, str_dic = sum_cells_and_dic.split(":")
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
            val = int(str_dic[start:idx])
            dic[char] = val
        self.load_with_dic(sum_cells, dic)

    def load_with_dic(self, sum_cells: str, dic: Mapping[str, int], row_wise=True) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the sums"""

        sum_cells = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        final_dic: Dict[str, _SumCellPair] = {}
        char_iter = iter(sum_cells)
        for c1 in range(self.cols if row_wise else self.rows):
            for c2 in range(self.rows if row_wise else self.cols):
                char = next(char_iter)
                entry = final_dic.setdefault(char, _SumCellPair(mysum=dic[char], cells=[]))
                entry.cells.append((c2, c1) if row_wise else (c1, c2))
        self.ext_sum_cells(final_dic.values())
