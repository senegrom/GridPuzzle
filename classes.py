import copy
import gc
from enum import Enum
from functools import partial
from itertools import islice

import sortedcontainers

from rules import *

GC_LEN_PARAM: int = 22


class SolveStatus(Enum):
    NONE = 0
    SOLVED = 1
    INVALID = -1


class RuleContainer:

    def __init__(self):
        self.rules: sortedcontainers.SortedSet[Rule] = sortedcontainers.SortedSet(
            key=lambda rule: (rule.cells, type(rule).__name__))
        self._rules_ia: sortedcontainers.SortedSet[Rule] = sortedcontainers.SortedSet(
            key=lambda rule: (rule.cells, type(rule).__name__))
        self.guarantees: sortedcontainers.SortedSet[Guarantee] = sortedcontainers.SortedSet()
        self._guarantees_ia: sortedcontainers.SortedSet[Guarantee] = sortedcontainers.SortedSet()

    def __eq__(self, other: 'RuleContainer') -> bool:
        if not isinstance(other, type(self)):
            return False
        return self.rules == other.rules and self._rules_ia == other._rules_ia and \
               self.guarantees == other.guarantees and self._guarantees_ia == other._guarantees_ia

    def __ne__(self, other: 'RuleContainer') -> bool:
        return not self == other


class Grid(Dict[Union[Tuple[int, int], int], int], Iterable[int], util.GridSizeContainer, RuleContainer):
    def __init__(self, rows: int, cols: Union[int, None] = None, max_elem: Union[int, None] = None):
        util.GridSizeContainer.__init__(self, rows, cols, max_elem)
        RuleContainer.__init__(self)
        self.__known: ArrayType = array('i', [0] * self.len)
        possible_gen: Generator[Set[int]] = (set(range(1, self.max_elem + 1)) for _ in range(self.len))
        self.__possible: Tuple[Set[int]] = tuple(possible_gen)
        self.__hash: Union[int, None] = None
        self.__has_been_filled = False
        self.format_args = util.PrettyPrintArgs()
        self.__presolved_not_yet_once: bool = True

    def __get_index_from_key(self, key: Union[Tuple[int, int], int, slice]) -> Union[int, slice]:
        if isinstance(key, int):
            return key
        if isinstance(key, numbers.Integral):
            return int(key)
        if isinstance(key, slice):
            return key
        if not isinstance(key, collections.Sequence):
            raise TypeError(f"Index {key!r} must be integral or integral tuple.")
        if len(key) == 1 and isinstance(key[0], numbers.Integral):
            return key[0]
        if len(key) == 2 and isinstance(key[0], numbers.Integral) and isinstance(key[1], numbers.Integral):
            return key[0] + key[1] * self.rows
        raise TypeError(f"Index {key!r} must be integral or integral tuple of length 1 or 2.")

    def __getitem__(self, key: Union[Tuple[int, int], int, slice]) -> int:
        return self.__known[self.__get_index_from_key(key)]

    def __setitem__(self, key: Union[Tuple[int, int], int], val: int) -> None:
        self.__has_been_filled = True
        self.__hash = None
        idx = self.__get_index_from_key(key)
        if isinstance(idx, slice):
            raise TypeError("Index slices not supported for setting.")
        self.__known[idx] = val
        p = self.__possible[idx]
        if val > 0:
            p.intersection_update({val})

    def __iter__(self) -> Iterator[int]:
        return iter(self.__known)

    def __str__(self) -> str:
        return self.to_str(util.PrettyPrintArgs(print_possible=False, args=self.format_args))

    def __repr__(self) -> str:
        return self.to_str(util.PrettyPrintArgs(print_possible=True, args=self.format_args))

    def to_str(self, args: util.PrettyPrintArgs = None) -> str:
        return self.__str_header(args.detail_rule) + "\n" + util.pretty_print(self.rows, self.cols, self.max_elem,
                                                                              self.__known, self.__possible, args)

    def __eq__(self, other: 'Grid') -> bool:
        if not isinstance(other, type(self)) or len(other) != len(self):
            return False
        return self.__known == other.__known and self.__possible == other.__possible and \
               RuleContainer.__eq__(self, other)

    def all_but_rule_equal(self, other: 'Grid') -> bool:
        if not isinstance(other, type(self)) or len(other) != len(self):
            return False
        return self.__known == other.__known and self.__possible == other.__possible

    def __ne__(self, other: 'Grid') -> bool:
        return not self == other

    def __hash__(self):
        if self.__hash is None:
            self.__hash = hash((bytes(self.__known), len(self.rules), len(self._rules_ia)))
        return self.__hash

    # noinspection PyArgumentList
    def __deepcopy__(self, memo: MutableMapping = None) -> 'Grid':
        if memo is None:
            memo = {}
        cls = type(self)
        result = cls.__new__(cls)
        memo[id(self)] = result
        setattr(result, "_GridSizeContainer__rows", self.rows)
        setattr(result, "_GridSizeContainer__cols", self.cols)
        setattr(result, "_GridSizeContainer__max_elem", self.max_elem)
        setattr(result, "_GridSizeContainer__len", self.len)
        setattr(result, "_Grid__known", copy.deepcopy(self.__known, memo=memo))
        setattr(result, "_Grid__possible", copy.deepcopy(self.__possible, memo=memo))
        setattr(result, "rules", copy.copy(self.rules))
        setattr(result, "_rules_ia", copy.copy(self._rules_ia))
        setattr(result, "guarantees", copy.copy(self.guarantees))
        setattr(result, "_guarantees_ia", copy.copy(self._guarantees_ia))
        setattr(result, "_Grid__hash", self.__hash)
        setattr(result, "_Grid__presolved_not_yet_once", self.__presolved_not_yet_once)
        setattr(result, "format_args", copy.copy(self.format_args))
        return result

    def deepcopy(self) -> 'Grid':
        return copy.deepcopy(self)

    @property
    def is_solved(self) -> bool:
        return all(0 < k in p for p, k in zip(self.__possible, self.__known))

    @property
    def is_valid(self) -> bool:
        return all(self.__possible)

    def get_possible(self, key: Union[Tuple[int, int], int]) -> Set[int]:
        return self.__possible[self.__get_index_from_key(key)]

    def get_least_possible_set(self) -> Tuple[int, Set[int]]:
        possible_where_len_gt1 = ((i, pp) for i, pp in enumerate(self.__possible) if len(pp) > 1)
        mysorted = min(possible_where_len_gt1, key=lambda x: len(x[1]))
        return mysorted

    def get_least_possible_guarantee(self) -> Optional[Guarantee]:
        if not self.guarantees:
            return None
        mysorted = min(self.guarantees, key=lambda gt: len(gt.cells))
        return mysorted

    def add_rule_checked(self, rule: Rule):
        if rule not in self._rules_ia:
            self.rules.add(rule)

    def deacitvate_rule(self, rule: Rule):
        self.rules.remove(rule)
        self._rules_ia.add(rule)

    def add_gtee_checked(self, gtee: Guarantee):
        if gtee not in self._guarantees_ia:
            self.guarantees.add(gtee)

    def deacitvate_gtee(self, gtee: Guarantee):
        self.guarantees.remove(gtee)
        self._guarantees_ia.add(gtee)

    def update_fill(self, new_known: Union[List[int], List[List[int]]], row_wise=False):
        assert not self.__has_been_filled, "Grid can only be filled once; or be used in individual access mode"
        new_known = util.flatten(new_known)
        assert len(new_known) == len(self.__known)
        if row_wise:
            for i, nk in enumerate(new_known):
                col = i % self.rows
                row = i // self.rows
                self[(row, col)] = nk
        else:
            for i, nk in enumerate(new_known):
                self[i] = nk
        self.__has_been_filled = True

    # rule updates

    def __update_known_from_possible(self) -> None:
        for i, p in enumerate(self.__possible):
            if len(p) == 1:
                self.__known[i] = next(iter(p))

    def __refresh_possible_from_known(self) -> None:
        for p, k in zip(self.__possible, self.__known):
            if k > 0 and len(p) > 1:
                p.intersection_update({k})

    def __update_from_rules(self) -> None:
        rule: Rule
        rules = self.rules.copy()
        for rule in rules:
            try:
                do_refresh, new_rules, new_gts = rule.apply(self.__known, self.__possible, self.guarantees)
                if do_refresh:
                    self.__refresh_possible_from_known()
            except RuleAlwaysSatisfied:
                new_rules = []
                new_gts = None
            if new_rules is not None:
                self.deacitvate_rule(rule)
                self.__refresh_possible_from_known()
                for new_rule in new_rules:
                    self.add_rule_checked(new_rule)
            if new_gts is not None:
                for gt in new_gts:
                    self.add_gtee_checked(gt)

    def __filter_guarantees(self) -> None:
        gt: Guarantee

        gts = [(gt.val, frozenset(gt.cells), gt) for gt in self.guarantees]
        for val in range(1, self.max_elem + 1):
            for (_, cells1, gt1), (_, cells2, gt2) in itertools.combinations((x for x in gts if x[0] == val), 2):
                if cells1.issubset(cells2) and gt1 in self.guarantees and gt2 in self.guarantees:
                    self.deacitvate_gtee(gt2)
                elif cells2.issubset(cells1) and gt1 in self.guarantees and gt2 in self.guarantees:
                    self.deacitvate_gtee(gt1)

        gts = self.guarantees.copy()
        for gt in gts:
            self.__update_from_guarantee(gt)

    def __update_from_guarantee(self, gt: Guarantee):
        first_idx = -1
        is_single = True
        for cell in gt.cells:
            if gt.val in self.__possible[cell]:
                if first_idx == -1:
                    first_idx = cell
                else:
                    is_single = False
            if gt.val == self.__known[cell]:
                self.deacitvate_gtee(gt)
                return

        if is_single:
            if first_idx == -1:
                self.__possible[gt.cells[0]].clear()
                raise InvalidGrid()
            pfi: Set[int] = self.__possible[first_idx]
            kfi = self.__known[first_idx]
            if kfi == 0 and gt.val in pfi:
                self[first_idx] = gt.val
                self.deacitvate_gtee(gt)
                return
            else:
                pfi.clear()
                raise InvalidGrid()

        if any(self.__known[cell] > 0 or gt.val not in self.__possible[cell] for cell in gt.cells):
            self.deacitvate_gtee(gt)

            new_cells = []
            for cell in gt.cells:
                if self.__known[cell] == 0 and gt.val in self.__possible[cell]:
                    new_cells.append(cell)

            if not new_cells:
                self.__possible[gt.cells[0]].clear()
                raise InvalidGrid()

            new_gt = Guarantee(val=gt.val, cells=array('i', new_cells))
            self.add_gtee_checked(new_gt)

    def update_step(self) -> None:
        self.__update_known_from_possible()
        try:
            self.__update_from_rules()
            self.__filter_guarantees()
        except InvalidGrid:
            pass

    def _presolve_hook_once(self):
        pass

    def _presolve_hook(self):
        pass

    def _solve_iter_hook(self):
        pass

    def __solve_iter_hook(self):
        most_one_rule_cells = (rule for rule in self.rules if isinstance(rule, ElementsAtMostOnce))

        for rule in most_one_rule_cells:
            cells: FrozenSet[int] = frozenset(rule.cells)
            if len(cells) > 1:
                for cell in cells:
                    new_rule = UneqRule(self, cell, cells - {cell})
                    self.add_rule_checked(new_rule)

        uneq_rule_cells = [rule for rule in self.rules if isinstance(rule, UneqRule)]

        for oc in range(self.len):
            uneq_rule_cells_oc = {(frozenset(rule.rel_cells), rule) for rule in uneq_rule_cells if
                                  rule.origin_cell == oc}
            if len(uneq_rule_cells_oc) > 1:
                uni = frozenset.union(*(cells for cells, rl in uneq_rule_cells_oc))

                for cells, rl in uneq_rule_cells_oc.copy():
                    if cells.issubset(uni) and uni != cells:
                        self.deacitvate_rule(rl)
                        uneq_rule_cells_oc.remove((cells, rl))

                if not uneq_rule_cells_oc:
                    new_rule = UneqRule(self, oc, uni)
                    self.add_rule_checked(new_rule)

    def __str_header(self, detailed=False):

        s = f"{self.__class__.__name__}({self.rows},{self.cols})" + \
            f" - [{len(self.rules)} rls, {len(self._rules_ia)} ria, {len(self.guarantees)} gts," \
            f" {len(self._guarantees_ia)} gia]"

        if detailed:
            grp1 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self.rules, key=lambda x: type(x).__name__), lambda x: type(x).__name__)}
            grp2 = {t: list(set(r.cells) for r in grp) for t, grp in
                    itertools.groupby(sorted(self._rules_ia, key=lambda x: type(x).__name__),
                                      lambda x: type(x).__name__)}
            s1 = '\n'.join(map(str, (f"  {len(grp):6} \t {key}" for key, grp in grp1.items())))
            s2 = '\n'.join(map(str, (f"  {len(grp):6} \t {key}" for key, grp in grp2.items())))
            s += f"\n{s1}\n  ───────\n{s2}"

        return s

    def solve(self, is_print: bool = False, upsteps: Sequence[int] = None) -> SolveStatus:
        self._presolve_hook()
        if self.__presolved_not_yet_once:
            self._presolve_hook_once()
            self.__presolved_not_yet_once = False

        steps: int = 0
        old: Optional[Grid] = None

        while True:
            if not self.is_valid:
                break
            all_but_rule_equal = self.all_but_rule_equal(old)
            if self == old:
                self.__solve_iter_hook()
                self._solve_iter_hook()
                if self == old:
                    break
            old = self.deepcopy()
            if is_print:
                if not all_but_rule_equal:
                    print(f"Step {upsteps} - {steps}")
                    print(
                        self.to_str(util.PrettyPrintArgs(print_possible=True, args=self.format_args, detail_rule=True)))
                else:
                    print(f"Step {upsteps} - {steps}")
                    print(self.__str_header(detailed=True))
            steps = steps + 1
            self.update_step()

        status: SolveStatus = SolveStatus.INVALID if not self.is_valid else (
            SolveStatus.SOLVED if self.is_solved else SolveStatus.NONE)

        if is_print:
            print(f"Done after {steps} steps: \t{status}")
            print(self.to_str(util.PrettyPrintArgs(print_possible=True, args=self.format_args)))
        return status

    def ext_rules(self, rule_cls: Type[Rule], kwargs_list: List[Dict[str, Any]] = None,
                  fun_it: Iterable[Callable[[Rule], Iterable]] = None) -> None:
        if kwargs_list is None and fun_it is None:
            new_rules = (rule_cls(self),)
        elif kwargs_list is not None and fun_it is None:
            new_rules = (rule_cls(self, **kwargs) for kwargs in kwargs_list)
        elif kwargs_list is None and fun_it is not None:
            new_rules = (rule_cls(self, cell_creator=fun) for fun in fun_it)
        else:
            new_rules = (rule_cls(self, cell_creator=fun, **kwargs) for kwargs in kwargs_list for fun in fun_it)

        for rule in new_rules:
            self.add_rule_checked(rule)

    @property
    def row_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        # noinspection PyTypeChecker
        return (partial(Rule.cells_as_row_or_column, idx=i, row_wise=True) for i in range(self.rows))

    @property
    def col_rule_applicators(self) -> Iterator[Callable[[Rule], Iterable]]:
        # noinspection PyTypeChecker
        return (partial(Rule.cells_as_row_or_column, idx=i, row_wise=False) for i in range(self.rows))


class Solver:
    def __init__(self, grid: Grid, is_print: int = 0, max_sols: int = -1):
        self.__grid: Grid = grid
        self.__print: int = is_print
        self.__max_sols: int = max_sols
        self.__solutions: Optional[Set[Grid]] = None

        assert self.__max_sols == -1 or self.__max_sols > 0, "max_sols must be positive or -1"

    def solve_full(self, store_solutions: bool = False, return_solutions: bool = True) -> Optional[Set[Grid]]:
        if self.__solutions is not None:
            return self.__solutions if return_solutions else None

        sols: Set[Grid]
        sols, _ = self.__solve_full(self.__grid, [], self.__max_sols)

        for idx, sol in enumerate(sols):
            print("Solution " + str(idx))
            print(sol.to_str(util.PrettyPrintArgs(print_possible=False, args=self.__grid.format_args)))

        if len(sols) == 0:
            print("No solution found.")

        if store_solutions:
            self.__solutions = sols

        return sols if return_solutions else None

    def __solve_full(self, grid: Grid, steps: List[int], max_sols: int) -> (Set['Grid'], Set['Grid']):
        steps.append(0)
        print_all: bool = self.__print < 0
        mylen = len(steps)
        if mylen == grid.len - GC_LEN_PARAM:
            gc.collect()
        solved: SolveStatus = grid.solve(print_all, steps)
        if solved == SolveStatus.SOLVED:
            steps.pop()
            return {grid}, set()
        if solved == SolveStatus.INVALID:
            steps.pop()
            return set(), {grid}

        test_i, p = grid.get_least_possible_set()
        test_gt = grid.get_least_possible_guarantee()
        tests = list(p)

        # todo: this could yield same solution twice for multiple elements in same guarantee
        is_test_gt = not test_gt and len(test_gt.cells) < len(tests)
        if is_test_gt:
            tests = None

        sols: Set[Grid] = set()
        wrongs: Set[Grid] = set()
        for test_val_cell in tests or test_gt.cells:
            if print_all or mylen <= self.__print:
                if is_test_gt:
                    print(
                        f"Step {steps} - Testing gt [{test_val_cell % grid.rows},{test_val_cell // grid.rows}] " +
                        f"== {test_gt.val} with {len(sols)} previous solutions")
                else:
                    print(
                        f"Step {steps} - Testing [{test_i % grid.rows},{test_i // grid.rows}] " +
                        f"== {test_val_cell} with {len(sols)} previous solutions")
            clone: Grid = grid.deepcopy()

            if is_test_gt:
                clone[test_val_cell] = test_gt.val
            else:
                clone[test_i] = test_val_cell

            sols_x: Set[Grid]
            wrongs_x: Set[Grid]
            new_max: int = -1 if max_sols == -1 else max_sols - len(sols)
            sols_x, wrongs_x = self.__solve_full(clone, steps, new_max)
            steps[mylen - 1] = steps[mylen - 1] + 1
            sols.update(sols_x)
            wrongs.update(wrongs_x)
            if 0 < max_sols <= len(sols):
                if print_all:
                    print(f"Step {steps} - Reached max_sols == {max_sols} ")
                sols = set(islice(iter(sols), max_sols))
                break

        steps.pop()
        return sols, wrongs


class UniqueSquare(Grid):
    """Square grid with uniqueness contraints for rows and columns"""

    def __init__(self, n: int):
        Grid.__init__(self, n)

        self.ext_rules(ElementsAtMostOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtMostOnce, None, self.col_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.row_rule_applicators)
        self.ext_rules(ElementsAtLeastOnce, None, self.col_rule_applicators)


class Sudoku(UniqueSquare):
    def __init__(self, rows_in_box: int = 3, cols_in_box: int = 3, box_rows: int = 3, box_cols: int = 3):
        n: int = rows_in_box * box_rows
        assert n == cols_in_box * box_cols
        UniqueSquare.__init__(self, n)

        box_pattern_1 = [row + col * n for col in range(cols_in_box) for row in range(rows_in_box)]
        box_pattern_2 = [row * box_rows + col * box_cols * n for col in range(box_cols) for row in range(box_rows)]
        self.ext_rules(ElementsAtMostOnce, [{"cells": [x + box_pattern_2[r] for x in box_pattern_1]} for r in range(n)],
                       None)
        self.ext_rules(ElementsAtLeastOnce,
                       [{"cells": [x + box_pattern_2[r] for x in box_pattern_1]} for r in range(n)], None)
        self.format_args.sep_in_ho = 1
        self.format_args.sep_in_ve = 1
        self.format_args.inner_grid_row = rows_in_box
        self.format_args.inner_grid_col = cols_in_box


class Futoshiki(UniqueSquare):
    """A (normally 5x5) grid with unique row/column entries and inequality constraints."""

    def __init__(self, n: int, ineqs: Iterable):
        UniqueSquare.__init__(self, n)
        self.ext_ineqs(ineqs)

    def ext_ineqs(self, ineqs: Iterable) -> None:
        self.ext_rules(IneqRule, [{"gt_cell": gt, "lt_cell": lt} for lt, gt in ineqs], None)


class KillerSudoku(Sudoku):
    """Sudoku with additional areas that have a sum and uniquencess condition"""

    SumCellPair: Type[tuple] = collections.namedtuple("SumCellPair", ["mysum", "cells"])

    def __init__(self, sum_cells: Iterable[SumCellPair] = None, rows_in_box: int = 3, cols_in_box: int = 3,
                 box_rows: int = 3,
                 box_cols: int = 3):
        Sudoku.__init__(self, rows_in_box, cols_in_box, box_rows, box_cols)
        if sum_cells is not None:
            self.ext_sum_cells(sum_cells)

    def ext_sum_cells(self, sum_cells: Iterable) -> None:
        """Add sum cells. Accepts a list of pairs."""
        first, *sum_cells = sum_cells
        sum_cells = itertools.chain([first], sum_cells)
        if isinstance(first[1][0], numbers.Integral):
            self.ext_rules(SumAndElementsAtMostOnce,
                           [{"mysum": mysum, "cells": KillerSudoku._pairs(cells)} for mysum, cells in sum_cells],
                           None)
        else:
            self.ext_rules(SumAndElementsAtMostOnce, [{"mysum": mysum, "cells": cells} for mysum, cells in sum_cells],
                           None)

    @classmethod
    def _pairs(cls, it: Iterable):
        it = iter(it)
        try:
            while True:
                a = next(it)
                b = next(it)
                yield a, b
        except StopIteration:
            pass

    # noinspection PyArgumentList,PyUnresolvedReferences
    def ext_sum_cells_from_str(self, sum_cells: str, dic: Mapping[str, int]) -> None:
        """Input grid with single char per "group" as multiline string. Plus a dictionary for the sums"""
        if not isinstance(dic, collections.Mapping):
            dic = dict(dic)
        lines = sum_cells.split("\n")
        final_dic: Dict[str, KillerSudoku.SumCellPair] = {}
        row = 0
        for line in lines:
            if not line or line.isspace():
                continue
            col = 0
            for char in line:
                if char.isspace():
                    continue
                if char not in final_dic:
                    final_dic.update({char: KillerSudoku.SumCellPair(mysum=dic[char], cells=[])})
                final_dic[char].cells.append((row, col))
                col += 1
            row += 1
        self.ext_sum_cells(final_dic.values())

    def _solve_iter_hook(self):
        most_one_rule_cells = [frozenset(rule.cells) for rule in self.rules if
                               isinstance(rule, ElementsAtMostOnce) and not isinstance(rule, SumAndElementsAtMostOnce)]

        sum_once_rules = [rule for rule in self.rules if isinstance(rule, SumAndElementsAtMostOnce)]

        set_dic: Dict[Rule, FrozenSet[int]] = {}
        rule_cntn_dic: Dict[FrozenSet[int], List[SumAndElementsAtMostOnce]] = {}

        for rule_most_cells in most_one_rule_cells:
            rule_cntn_dic[rule_most_cells] = []

        for rule_sum in sum_once_rules:
            cells = frozenset(rule_sum.cells)
            set_dic[rule_sum] = cells
            for rule_most_cells in most_one_rule_cells:
                if cells.issubset(rule_most_cells):
                    rule_cntn_dic[rule_most_cells].append(rule_sum)

        for rule_most_cells in most_one_rule_cells:
            for rule1, rule2 in itertools.combinations(rule_cntn_dic[rule_most_cells], 2):
                cells1 = set_dic[rule1]
                cells2 = set_dic[rule2]

                if cells1 & cells2:
                    continue

                union_cells = cells1 | cells2
                luc = len(union_cells)
                if luc != len(rule_most_cells):
                    new_rule = SumAndElementsAtMostOnce(gsz=self, cells=union_cells, mysum=rule1.sum + rule2.sum)
                    self.add_rule_checked(new_rule)

        for rule_most_cells in most_one_rule_cells:
            for rule in rule_cntn_dic[rule_most_cells]:
                cells = set_dic[rule]
                lc = len(cells)
                if lc != len(rule_most_cells) and self.max_elem == len(rule_most_cells):
                    new_sum = int(self.max_elem * (self.max_elem + 1) / 2) - rule.sum
                    new_rule = SumAndElementsAtMostOnce(gsz=self, cells=rule_most_cells - cells, mysum=new_sum)
                    self.add_rule_checked(new_rule)
