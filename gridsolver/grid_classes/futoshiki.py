from typing import Iterable, Union, Sequence

from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs
from gridsolver.abstract_grids.unique_square_grid import UniqueSquareGrid
from gridsolver.rules.uneq import IneqRule


class Futoshiki(UniqueSquareGrid):
    """A (normally 5x5) grid with unique row/column entries and inequality constraints."""

    format_args = PrettyPrintArgs(
        sep_in_ho=3,
        sep_in_ve=3,
        inner_grid_row=1,
        inner_grid_col=1
    )

    def __init__(self, n: int = 5):
        super().__init__(n)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        self.ext_rules(IneqRule, [{"gt_cell": gt, "lt_cell": lt} for lt, gt in ineqs], None)

    def load(self, values: Union[str, Sequence[int], Sequence[Iterable[int]]], /,
             row_wise=True, space_sep=False):
        assert len(values) == 3 * self.rows * self.cols - self.cols - self.rows, \
            f"len: {len(values)} != {3 * self.rows * self.cols - self.cols - self.rows}"
        part1 = values[:self.rows * self.cols]
        part2 = values[self.rows * self.cols:2 * self.rows * self.cols - self.cols]
        part3 = values[2 * self.rows * self.cols - self.cols:3 * self.rows * self.cols - self.cols - self.rows]
        super().load(part1, row_wise=row_wise, space_sep=space_sep)
        part2 = self._load_preprocess_sequence(part2, space_sep=space_sep,
                                               assert_length=self.rows * self.cols - self.cols)
        part3 = self._load_preprocess_sequence(part3, space_sep=space_sep,
                                               assert_length=self.rows * self.cols - self.rows)

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
            elif val == "-":
                # do nothing
                pass
            else:
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
            elif val == "-":
                # do nothing
                pass
            else:
                raise ValueError(f"Cannot parse inequality symbol {val}")
