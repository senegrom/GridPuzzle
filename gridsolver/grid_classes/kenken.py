from collections.abc import Iterable, Mapping
from numbers import Integral
from typing import NamedTuple

from gridsolver.abstract_grids.grid import (
    _boolean_option,
    _load_preprocess_str,
    _load_preprocess_str_space_sep,
    _validate_load_options,
    pairs,
)
from gridsolver.grid_classes.cage_loading import (
    parse_kenken_dictionary,
    split_cage_input,
)
from gridsolver.grid_classes.sudoku import UniqueSquareGrid
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

    def load_with_dic(
        self,
        sum_cells: str | Iterable[str],
        dic: Mapping[str, tuple[str, int]],
        row_wise: bool = True,
    ) -> None:
        """Load a single-character cage layout plus target/operator mappings."""
        row_wise = _boolean_option("row_wise", row_wise)
        if self.has_been_filled:
            raise RuntimeError("Grid can only be filled once; or be used in individual access mode")

        labels = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)

        final_dic: dict[str, _CellTuple] = {}
        label_iter = iter(labels)
        for first in range(self.rows if row_wise else self.cols):
            for second in range(self.cols if row_wise else self.rows):
                label = next(label_iter)
                try:
                    operator, target = dic[label]
                except KeyError as exc:
                    raise ValueError(f"Missing KenKen cage definition for {label!r}") from exc
                entry = final_dic.setdefault(
                    label,
                    _CellTuple(mytarget=target, cells=[], operator=operator),
                )
                entry.cells.append(
                    (first, second) if row_wise else (second, first)
                )

        unused_labels = set(dic).difference(final_dic)
        if unused_labels:
            rendered = ", ".join(sorted(repr(label) for label in unused_labels))
            raise ValueError(f"Unused KenKen cage definitions: {rendered}")

        # Build every rule before changing the grid, then commit the complete set.
        self.ext_target_cells(final_dic.values())
        self.has_been_filled = True
