from grid_classes.classes import UniqueSquare
from rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


class Sudoku(UniqueSquare):
    def __init__(self, rows_in_box: int = 3, cols_in_box: int = 3, box_rows: int = 3, box_cols: int = 3):
        n: int = rows_in_box * box_rows
        assert n == cols_in_box * box_cols
        super().__init__(n)

        box_pattern_1 = [row + col * n for col in range(cols_in_box) for row in range(rows_in_box)]
        box_pattern_2 = [row * box_rows + col * box_cols * n for col in range(box_cols) for row in range(box_rows)]
        self.ext_rules(ElementsAtMostOnce, [{"cells": [x + box_pattern_2[r] for x in box_pattern_1]} for r in range(n)],
                       None)
        self.ext_rules(ElementsAtLeastOnce,
                       [{"cells": [x + box_pattern_2[r] for x in box_pattern_1]} for r in range(n)], None)
        self.format_args.sep_in_ho = 1
        self.format_args.sep_in_ve = 1
        self.format_args.inner_grid_row = rows_in_box
        self.format_args.inner_grid_col = cols_in_box
