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
                 box_rows: int = 3,
                 box_cols: int = 3):
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

    def load(self, sum_cells: str, dic: Mapping[str, int]) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the sums"""
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        lines = sum_cells.split("\n")
        final_dic: Dict[str, _SumCellPair] = {}
        row = 0
        for line in lines:
            if not line or line.isspace():
                continue
            col = 0
            for char in line:
                if char.isspace():
                    continue
                entry = final_dic.setdefault(char, _SumCellPair(mysum=dic[char], cells=[]))
                entry.cells.append((row, col))
                col += 1
            row += 1
        self.ext_sum_cells(final_dic.values())
