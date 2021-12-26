from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.unique import ElementsAtMostOnce, ElementsAtLeastOnce


class UniqueSquareGrid(Grid):
    """Square grid with uniqueness contraints for rows and columns"""

    def __init__(self, n: int):
        super().__init__(n)

        self.ext_rules(ElementsAtMostOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtMostOnce, None, self.col_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.col_rule_applicators)
