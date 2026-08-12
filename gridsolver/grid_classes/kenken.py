from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import (
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
    pairs,
)
from gridsolver.abstract_grids.unique_square_grid import UniqueSquareGrid
from gridsolver.grid_classes.cage_loading import (
    load_cage_layout,
    parse_kenken_dictionary,
    split_cage_input,
)
from gridsolver.rules.rules import Rule
from gridsolver.rules.sumrules import DiffRule, DivRule, ProdRule, SumRule


class _CellTuple(NamedTuple):
    mytarget: int
    cells: list
    operator: str


class Kenken(UniqueSquareGrid):
    """UniqueSquareGrid with arithmetic cage constraints."""

    def __init__(self, target_cells: Iterable[_CellTuple] | None = None, n: int = 6) -> None:
        super().__init__(n)
        if target_cells is not None:
            self.ext_target_cells(target_cells)

    def make_rule(self, target_cell: _CellTuple) -> Rule:
        cells = list(target_cell.cells)
        if not cells:
            raise ValueError("KenKen cages must contain at least one cell")
        if isinstance(cells[0], Integral):
            if len(cells) % 2:
                raise ValueError("Flat cage coordinates must contain complete row/column pairs")
            cells = list(pairs(cells))

        match target_cell.operator:
            case "+":
                return SumRule(gsz=self, cells=cells, mysum=target_cell.mytarget)
            case "-":
                return DiffRule(gsz=self, cells=cells, target=target_cell.mytarget)
            case "/" | ":":
                return DivRule(gsz=self, cells=cells, target=target_cell.mytarget)
            case "*":
                return ProdRule(gsz=self, cells=cells, target=target_cell.mytarget)
            case _:
                raise ValueError(f"Not supported operator {target_cell.operator!r}")

    def ext_target_cells(self, target_cells: Iterable[_CellTuple]) -> None:
        """Add arithmetic cages atomically."""
        rules = [self.make_rule(target_cell) for target_cell in target_cells]
        self.add_rules_checked(rules)

    def load(
        self,
        sum_cells_and_dic: str | Iterable[str],
        /,
        row_wise: bool = True,
        space_sep: bool = False,
    ) -> None:
        """Load a cage layout followed by a compact operator/target dictionary."""
        row_wise, space_sep = _validate_load_options(row_wise, space_sep)
        target_cells, dictionary_text = split_cage_input(sum_cells_and_dic)
        sum_cells = (
            _load_preprocess_str_space_sep(target_cells)
            if space_sep
            else _load_preprocess_str(target_cells)
        )
        dictionary_text = _load_preprocess_str(dictionary_text)
        definitions = parse_kenken_dictionary(
            dictionary_text,
            sum_cells,
            self.max_elem,
        )
        self.load_with_dic(sum_cells, definitions, row_wise)

    @staticmethod
    def _make_cage_entry(definition: tuple[str, int]) -> _CellTuple:
        operator, target = definition
        return _CellTuple(mytarget=target, cells=[], operator=operator)

    def load_with_dic(
        self,
        sum_cells: str | Iterable[str],
        dic: Mapping[str, tuple[str, int]],
        row_wise: bool = True,
    ) -> None:
        """Load a single-character cage layout plus target/operator mappings."""
        load_cage_layout(
            self,
            sum_cells,
            dic,
            row_wise,
            family="KenKen",
            make_entry=self._make_cage_entry,
            commit=self.ext_target_cells,
        )
