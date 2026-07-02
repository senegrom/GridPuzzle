from gridsolver.abstract_grids.unique_square_grid import UniqueSquareGrid
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


class LatinSquare(UniqueSquareGrid):

    def __init__(self, n: int):
        super().__init__(n)


class DiagonalLatinSquare(LatinSquare):
    """Latin square whose two MAIN diagonals also contain every value once."""

    def __init__(self, n: int):
        super().__init__(n)

        diag1 = [n * x + x for x in range(n)]
        diag2 = [n * (x + 1) - 1 - x for x in range(n)]
        self.ext_rules(ElementsAtMostOnce, [{"cells": d} for d in (diag1, diag2)], None)
        self.ext_rules(ElementsAtLeastOnce, [{"cells": d} for d in (diag1, diag2)], None)


class PandiagonalLatinSquare(LatinSquare):
    """Latin square where all 2n broken (wrapped) diagonals contain every value
    once. Until June 2026 this class was (mis)named DiagonalLatinSquare; the
    example corpus under Examples/LatinSquares/Pandiagonals uses this one."""

    def __init__(self, n: int):
        super().__init__(n)

        diag1 = [[n * x + (x + i) % n for x in range(n)] for i in range(n)]
        diag2 = [[n * (x + 1) - 1 - (x + i) % n for x in range(n)] for i in range(n)]
        self.ext_rules(ElementsAtMostOnce, [{"cells": d} for d in diag1 + diag2], None)
        self.ext_rules(ElementsAtLeastOnce, [{"cells": d} for d in diag1 + diag2], None)
