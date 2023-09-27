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
    """UniqueSquareGrid with additional areas that have a arithmetic operation condition"""

    def __init__(self, target_cells: Iterable[_CellTuple] = None, n: int = 6):
        super().__init__(n)
        if target_cells is not None:
            self.ext_target_cells(target_cells)

    def make_rule(self, t: _CellTuple):
        cells = t.cells if not isinstance(t.cells[0], Integral) else pairs(t.cells)
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
                raise Exception(f"Not supported operator {t.operator}")

    def ext_target_cells(self, target_cells: Iterable[_CellTuple]) -> None:
        """Add target cells. Accepts a list of pairs."""
        for t in target_cells:
            self.add_rule_checked(self.make_rule(t))

    def load(self, sum_cells_and_dic: Union[str, Iterable[str]], /, row_wise=True, space_sep=False) -> None:
        """Input grid with single char per "group" as multiline string.
        Plus a dictionary for the sums seperated by colons with a single character for the cell values"""
        if ":" not in sum_cells_and_dic:
            raise ValueError("Kenken string contains no : separator.")

        target_cells, str_dic = KillerSudoku._load_preprocess_colon_split(sum_cells_and_dic)
        if space_sep:
            sum_cells = _load_preprocess_str_space_sep(target_cells)
        else:
            sum_cells = _load_preprocess_str(target_cells)
        str_dic = _load_preprocess_str(str_dic)
        str_dic: str
        idx = 0
        dic = {}
        while idx < len(str_dic):
            char = str_dic[idx]
            op = str_dic[idx + 1]
            idx += 2
            start = idx
            while idx < len(str_dic) and str_dic[idx].isnumeric():
                idx += 1
            if idx == start:
                raise ValueError("Kenken string format invalid.")
            val = int(str_dic[start:idx])
            dic[char] = (op, val)
        self.load_with_dic(sum_cells, dic)

    def load_with_dic(self, sum_cells: Union[str, Iterable[str]], dic: Mapping[str, Tuple[str, int]],
                      row_wise=True) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the targets and ops"""

        assert not self.has_been_filled, "Grid can only be filled once; or be used in individual access mode"
        sum_cells = self._load_preprocess_sequence(sum_cells)
        if not isinstance(dic, Mapping):
            dic = dict(dic)
        final_dic: Dict[str, _CellTuple] = {}
        char_iter = iter(sum_cells)
        for c1 in range(self.cols if row_wise else self.rows):
            for c2 in range(self.rows if row_wise else self.cols):
                char = next(char_iter)
                entry = final_dic.setdefault(char, _CellTuple(mytarget=dic[char][1], cells=[], operator=dic[char][0]))
                entry.cells.append((c2, c1) if row_wise else (c1, c2))
        self.ext_target_cells(final_dic.values())
