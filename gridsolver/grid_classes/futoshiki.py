from collections.abc import Iterable, Sequence

from gridsolver.abstract_grids.grid import (
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
)
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
        inner_grid_col=1,
    )

    def __init__(self, n: int = 5) -> None:
        super().__init__(n)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        """Add (smaller, greater) inequality pairs between adjacent cells.

        The renderer draws inequality glyphs between orthogonal neighbours
        only, so non-adjacent pairs are rejected here instead of crashing
        after a solve when the solution is printed.
        """
        kwargs_list = []
        for lt, gt in ineqs:
            lt_cell = self._get_index_from_key(lt)
            gt_cell = self._get_index_from_key(gt)
            rows = self.rows
            adjacent = (
                (abs(lt_cell - gt_cell) == 1 and lt_cell // rows == gt_cell // rows)
                or (abs(lt_cell - gt_cell) == rows and lt_cell % rows == gt_cell % rows)
            )
            if not adjacent:
                raise ValueError(
                    f"Futoshiki inequality cells {lt!r} and {gt!r} "
                    "must be orthogonally adjacent"
                )
            kwargs_list.append({"gt_cell": gt, "lt_cell": lt})
        self.ext_rules(IneqRule, kwargs_list, None)

    def load(
        self,
        values: str | Sequence[int] | Sequence[Iterable[int]],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        row_wise, space_sep = _validate_load_options(row_wise, space_sep)
        # Validate logical tokens rather than raw string length. Direct
        # multiline and whitespace-separated input is normalized first.
        if isinstance(values, str):
            values = (
                _load_preprocess_str_space_sep(values)
                if space_sep
                else _load_preprocess_str(values)
            )
        else:
            values = flatten(values)

        expected = 3 * self.rows * self.cols - self.cols - self.rows
        if len(values) != expected:
            raise ValueError(f"Expected {expected} values, got {len(values)}")

        grid_end = self.rows * self.cols
        horizontal_end = 2 * self.rows * self.cols - self.cols
        grid_values = values[:grid_end]
        horizontal = values[grid_end:horizontal_end]
        vertical = values[horizontal_end:]

        # row_wise only reorders the value section; the two inequality
        # sections have a fixed row-major layout, so a transposed payload
        # with inequalities would silently bind them to wrong cell pairs.
        if not row_wise and any(
            symbol != "-" for symbol in (*horizontal, *vertical)
        ):
            raise ValueError(
                "row_wise=False is only supported for payloads without "
                "inequality symbols; transposing the inequality sections "
                "is not implemented"
            )

        # Build every inequality before loading the first value. A malformed
        # symbol therefore leaves both values and rule sets unchanged.
        new_rules: list[IneqRule] = []
        cols_minus_one = self.cols - 1
        for index, symbol in enumerate(horizontal):
            row, col = divmod(index, cols_minus_one)
            if symbol == ">":
                new_rules.append(
                    IneqRule(self, gt_cell=(row, col), lt_cell=(row, col + 1))
                )
            elif symbol == "<":
                new_rules.append(
                    IneqRule(self, lt_cell=(row, col), gt_cell=(row, col + 1))
                )
            elif symbol != "-":
                raise ValueError(f"Cannot parse inequality symbol {symbol!r}")

        rows_minus_one = self.rows - 1
        for index, symbol in enumerate(vertical):
            col, row = divmod(index, rows_minus_one)
            if symbol == ">":
                new_rules.append(
                    IneqRule(self, gt_cell=(row, col), lt_cell=(row + 1, col))
                )
            elif symbol == "<":
                new_rules.append(
                    IneqRule(self, lt_cell=(row, col), gt_cell=(row + 1, col))
                )
            elif symbol != "-":
                raise ValueError(f"Cannot parse inequality symbol {symbol!r}")

        super().load(grid_values, row_wise=row_wise, space_sep=False)
        self.add_rules_checked(new_rules)
