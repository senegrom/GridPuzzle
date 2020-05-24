import itertools
import numbers
from array import ArrayType
from typing import *

from grid_classes.sudoku import Sudoku
from rules.sumrules import SumAndElementsAtMostOnce


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniquencess condition"""

    class SumCellPair(NamedTuple):
        mysum: int
        cells: ArrayType

        def __hash__(self):
            return hash((type(self), bytes(self.cells), self.val))

    def __init__(self, sum_cells: Iterable[SumCellPair] = None, rows_in_box: int = 3, cols_in_box: int = 3,
                 box_rows: int = 3,
                 box_cols: int = 3):
        Sudoku.__init__(self, rows_in_box, cols_in_box, box_rows, box_cols)
        if sum_cells is not None:
            self.ext_sum_cells(sum_cells)

    def ext_sum_cells(self, sum_cells: Iterable) -> None:
        """Add sum cells. Accepts a list of pairs."""
        first, *sum_cells = sum_cells
        sum_cells = itertools.chain([first], sum_cells)
        if isinstance(first[1][0], numbers.Integral):
            self.ext_rules(SumAndElementsAtMostOnce,
                           [{"mysum": mysum, "cells": KillerSudoku._pairs(cells)} for mysum, cells in sum_cells],
                           None)
        else:
            self.ext_rules(SumAndElementsAtMostOnce, [{"mysum": mysum, "cells": cells} for mysum, cells in sum_cells],
                           None)

    @classmethod
    def _pairs(cls, it: Iterable):
        it = iter(it)
        try:
            while True:
                a = next(it)
                b = next(it)
                yield a, b
        except StopIteration:
            pass

    def ext_sum_cells_from_str(self, sum_cells: str, dic: Mapping[str, int]) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the sums"""
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        lines = sum_cells.split("\n")
        final_dic: Dict[str, KillerSudoku.SumCellPair] = {}
        row = 0
        for line in lines:
            if not line or line.isspace():
                continue
            col = 0
            for char in line:
                if char.isspace():
                    continue
                if char not in final_dic:
                    final_dic.update({char: KillerSudoku.SumCellPair(mysum=dic[char], cells=[])})
                final_dic[char].cells.append((row, col))
                col += 1
            row += 1
        self.ext_sum_cells(final_dic.values())
