import itertools
import numbers
from collections import namedtuple
from typing import *

from grid_classes.sudoku import Sudoku
from rules.sum import SumAndElementsAtMostOnce
from rules.unique import ElementsAtMostOnce


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniquencess condition"""

    SumCellPair: Type[tuple] = namedtuple("SumCellPair", ["mysum", "cells"])

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

    # noinspection PyArgumentList,PyUnresolvedReferences
    def ext_sum_cells_from_str(self, sum_cells: str, dic: Mapping[str, int]) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the sums"""
        if not isinstance(dic, collections.Mapping):
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

    def _solve_iter_hook(self):
        most_one_rule_cells = [frozenset(rule.cells) for rule in self.rules if
                               isinstance(rule, ElementsAtMostOnce) and not isinstance(rule, SumAndElementsAtMostOnce)]

        sum_once_rules = [rule for rule in self.rules if isinstance(rule, SumAndElementsAtMostOnce)]

        set_dic: Dict[SumAndElementsAtMostOnce, FrozenSet[int]] = {}
        rule_cntn_dic: Dict[FrozenSet[int], List[SumAndElementsAtMostOnce]] = {}

        for rule_most_cells in most_one_rule_cells:
            rule_cntn_dic[rule_most_cells] = []

        for rule_sum in sum_once_rules:
            cells = frozenset(rule_sum.cells)
            set_dic[rule_sum] = cells
            for rule_most_cells in most_one_rule_cells:
                if cells.issubset(rule_most_cells):
                    rule_cntn_dic[rule_most_cells].append(rule_sum)

        for rule_most_cells in most_one_rule_cells:
            for rule1, rule2 in itertools.combinations(rule_cntn_dic[rule_most_cells], 2):
                cells1 = set_dic[rule1]
                cells2 = set_dic[rule2]

                if cells1 & cells2:
                    continue

                union_cells = cells1 | cells2
                luc = len(union_cells)
                if luc != len(rule_most_cells):
                    new_rule = SumAndElementsAtMostOnce(gsz=self, cells=union_cells, mysum=rule1.sum + rule2.sum)
                    self.add_rule_checked(new_rule)

        for rule_most_cells in most_one_rule_cells:
            for rule in rule_cntn_dic[rule_most_cells]:
                cells = set_dic[rule]
                lc = len(cells)
                if lc != len(rule_most_cells) and self.max_elem == len(rule_most_cells):
                    new_sum = int(self.max_elem * (self.max_elem + 1) / 2) - rule.sum
                    new_rule = SumAndElementsAtMostOnce(gsz=self, cells=rule_most_cells - cells, mysum=new_sum)
                    self.add_rule_checked(new_rule)
