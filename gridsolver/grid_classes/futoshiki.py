from typing import Iterable

from gridsolver.grid_classes.classes import UniqueSquare
from gridsolver.rules.uneq import IneqRule


class Futoshiki(UniqueSquare):
    """A (normally 5x5) grid with unique row/column entries and inequality constraints."""

    def __init__(self, n: int, ineqs: Iterable):
        super().__init__(n)
        self.ext_ineqs(ineqs)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        self.ext_rules(IneqRule, [{"gt_cell": gt, "lt_cell": lt} for lt, gt in ineqs], None)
