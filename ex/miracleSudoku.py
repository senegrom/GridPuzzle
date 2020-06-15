from grid_classes.sudoku import Sudoku
from rules.uneq import UneqRule, DiffGe2Rule

n = 9
g = Sudoku()
g[4, 2] = 1
g[5, 6] = 2
g.ext_rules(UneqRule, [{"origin_cell": (r, c),
                        "rel_cells": [
                            (r - 1, c - 1), (r, c - 1), (r + 1, c - 1), (r - 1, c),
                            (r + 1, c), (r - 1, c + 1), (r, c + 1), (r + 1, c + 1),
                            (r - 2, c - 1), (r - 2, c + 1), (r + 2, c - 1), (r + 2, c + 1),
                            (r - 1, c - 2), (r - 1, c + 2), (r + 1, c - 2), (r + 1, c + 2)
                        ]} for r in range(n) for c in range(n)], None)
g.ext_rules(DiffGe2Rule, [{"origin_cell": (r, c),
                           "rel_cells": [(r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)]}
                          for r in range(n) for c in range(n)], None)
