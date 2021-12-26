from typing import Iterable

from gridsolver.grid_classes.grid import UniqueSquare
from gridsolver.rules.uneq import IneqRule


class Futoshiki(UniqueSquare):
    """A (normally 5x5) grid with unique row/column entries and inequality constraints."""

    def __init__(self, n: int = 5):
        super().__init__(n)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        self.ext_rules(IneqRule, [{"gt_cell": gt, "lt_cell": lt} for lt, gt in ineqs], None)
