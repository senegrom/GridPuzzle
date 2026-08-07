from typing import Iterable, Union, Sequence

from gridsolver.abstract_grids.grid import _load_preprocess_str, _load_preprocess_str_space_sep
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs
from gridsolver.abstract_grids.unique_square_grid import UniqueSquareGrid
from gridsolver.rules.uneq import IneqRule
from gridsolver.util import flatten


class Futoshiki(UniqueSquareGrid):
    """A (normally 5x5) grid with unique row/column entries and inequality constraints."""

    format_args = PrettyPrintArgs(
        sep_in_ho=4,
        sep_in_ve=4,
        inner_grid_row=1,
        inner_grid_col=1
    )

    def __init__(self, n: int = 5):
        super().__init__(n)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        self.ext_rules(IneqRule, [{"gt_cell": gt, "lt_cell": lt} for lt, gt in ineqs], None)

    def load(self, values: Union[str, Sequence[int], Sequence[Iterable[int]]], /,
             row_wise=True, space_sep=False):
        # Validate the logical tokens, not the raw string length.  Direct
        # multiline and whitespace-separated input previously failed before
        # the normal Grid preprocessing had a chance to remove whitespace.
        if isinstance(values, str):
            values = _load_preprocess_str_space_sep(values) if space_sep else _load_preprocess_str(values)
        else:
            values = flatten(values)

        expected = 3 * self.rows * self.cols - self.cols - self.rows
        if len(values) != expected:
            raise ValueError(f"len: {len(values)} != {expected}")

        grid_end = self.rows * self.cols
        horizontal_end = 2 * self.rows * self.cols - self.cols
        part1 = values[:grid_end]
        part2 = values[grid_end:horizontal_end]
        part3 = values[horizontal_end:]

        super().load(part1, row_wise=row_wise, space_sep=False)

        for i, val in enumerate(part2):
            cm1 = self.cols - 1
            if val == ">":
                r = i // cm1
                c = i % cm1
                self.add_rule_checked(IneqRule(self, gt_cell=(r, c), lt_cell=(r, c + 1)))
            elif val == "<":
                r = i // cm1
                c = i % cm1
                self.add_rule_checked(IneqRule(self, lt_cell=(r, c), gt_cell=(r, c + 1)))
            elif val != "-":
                raise ValueError(f"Cannot parse inequality symbol {val}")

        for i, val in enumerate(part3):
            rm1 = self.rows - 1
            if val == ">":
                c = i // rm1
                r = i % rm1
                self.add_rule_checked(IneqRule(self, gt_cell=(r, c), lt_cell=(r + 1, c)))
            elif val == "<":
                c = i // rm1
                r = i % rm1
                self.add_rule_checked(IneqRule(self, lt_cell=(r, c), gt_cell=(r + 1, c)))
            elif val != "-":
                raise ValueError(f"Cannot parse inequality symbol {val}")
