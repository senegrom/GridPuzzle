from numbers import Integral
from typing import Iterable, NamedTuple, Mapping, Dict, Union, Tuple, List

from gridsolver.abstract_grids.grid import _load_preprocess_str_space_sep, _load_preprocess_str, pairs
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import UniqueSquareGrid
from gridsolver.rules.sumrules import SumRule, DiffRule, ProdRule, DivRule


class _CellTuple(NamedTuple):
    mytarget: int
    cells: List
    operator: str


class Kenken(UniqueSquareGrid):
    """UniqueSquareGrid with arithmetic cage constraints."""

    def __init__(self, target_cells: Iterable[_CellTuple] = None, n: int = 6):
        super().__init__(n)
        if target_cells is not None:
            self.ext_target_cells(target_cells)

    def make_rule(self, t: _CellTuple):
        cells = list(t.cells)
        if not cells:
            raise ValueError("KenKen cages must contain at least one cell")
        if isinstance(cells[0], Integral):
            if len(cells) % 2:
                raise ValueError("Flat cage coordinates must contain complete row/column pairs")
            cells = pairs(cells)

        match t.operator:
            case "+":
                return SumRule(gsz=self, cells=cells, mysum=t.mytarget)
            case "-":
                return DiffRule(gsz=self, cells=cells, target=t.mytarget)
            case "/" | ":":
                return DivRule(gsz=self, cells=cells, target=t.mytarget)
            case "*":
                return ProdRule(gsz=self, cells=cells, target=t.mytarget)
            case _:
                raise ValueError(f"Not supported operator {t.operator}")

    def ext_target_cells(self, target_cells: Iterable[_CellTuple]) -> None:
        """Add arithmetic cages."""
        for target_cell in target_cells:
            self.add_rule_checked(self.make_rule(target_cell))

    def load(self, sum_cells_and_dic: Union[str, Iterable[str]], /, row_wise=True, space_sep=False) -> None:
        """Load a cage layout followed by a compact operator/target dictionary."""
        target_cells, str_dic = KillerSudoku._load_preprocess_colon_split(sum_cells_and_dic)
        if space_sep:
            sum_cells = _load_preprocess_str_space_sep(target_cells)
        else:
            sum_cells = _load_preprocess_str(target_cells)
        str_dic = _load_preprocess_str(str_dic)
        idx = 0
        dic = {}
        while idx < len(str_dic):
            if idx + 1 >= len(str_dic):
                raise ValueError("Kenken string format invalid.")
            char = str_dic[idx]
            op = str_dic[idx + 1]
            idx += 2
            start = idx
            while idx < len(str_dic) and str_dic[idx].isnumeric():
                idx += 1
            if idx == start:
                raise ValueError("Kenken string format invalid.")
            dic[char] = (op, int(str_dic[start:idx]))
        self.load_with_dic(sum_cells, dic, row_wise)

    def load_with_dic(self, sum_cells: Union[str, Iterable[str]], dic: Mapping[str, Tuple[str, int]],
                      row_wise=True) -> None:
        """Load a single-character cage layout plus target/operator mappings."""
        assert not self.has_been_filled, "Grid can only be filled once; or be used in individual access mode"
        sum_cells = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        final_dic: Dict[str, _CellTuple] = {}
        char_iter = iter(sum_cells)
        for c1 in range(self.rows if row_wise else self.cols):
            for c2 in range(self.cols if row_wise else self.rows):
                char = next(char_iter)
                entry = final_dic.setdefault(char, _CellTuple(mytarget=dic[char][1], cells=[], operator=dic[char][0]))
                entry.cells.append((c1, c2) if row_wise else (c2, c1))
        self.ext_target_cells(final_dic.values())
