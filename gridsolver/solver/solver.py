import copy
import gc
import itertools
from array import ArrayType
from typing import Tuple, Set, Sequence, List, Dict, FrozenSet, Optional, Callable

import gridsolver.solver.logger
from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules import unique, uneq, sumrules
from gridsolver.rules.rules import Guarantee, RuleAlwaysSatisfied, InvalidGrid

GC_LEN_PARAM: int = 22
_lg = gridsolver.solver.logger.get_log(__name__, 0)
_MAX_LVL = gridsolver.solver.logger.MAX_LVL


def set_loglevel(lvl: int):
    _lg.set_lvl(lvl)


def solve(grid: Grid, log_level: int = None, max_sols: int = -1) -> Optional[Set[ImmutableGrid]]:
    if log_level is not None:
        set_loglevel(log_level)
    sols: Set[ImmutableGrid]
    rulehelpers: List[Callable[['AtomicSolver'], bool]] = []
    grid.has_been_filled = True

    any_unique = any(isinstance(rule, unique.ElementsAtMostOnce) for rule in grid.rules)
    any_sum_unique = any(isinstance(rule, sumrules.SumAndElementsAtMostOnce) for rule in grid.rules)
    any_uneq = any(isinstance(rule, uneq.UneqRule) for rule in grid.rules)
    if any_unique:
        rulehelpers.append(rulehelper_atmostonce)
    if any_uneq:
        rulehelpers.append(rulehelper_uneq)
    if any_sum_unique:
        rulehelpers.append(rulehelper_sum_atmostonce)

    sols, _ = _solve_full(grid.deepcopy(), [], max_sols, rulehelpers)

    for idx, sol in enumerate(sols):
        _lg.logs(0, "Solution " + str(idx), header=True)
        _lg.logg(0, sol)

    if len(sols) == 0:
        _lg.logs(0, "No solution found.", header=True)

    return sols


class AtomicSolver:
    def __init__(self, grid: Grid, upsteps: List[int] = None,
                 solve_iter_hooks: Sequence[Callable[['AtomicSolver'], bool]] = None):
        self.grid = grid
        self.upsteps = upsteps
        self.solve_iter_hooks = solve_iter_hooks if solve_iter_hooks is not None else []

    # noinspection PyProtectedMember
    def solve_atomic(self) -> SolveStatus:
        _lg.logs(_MAX_LVL, f"Solving rule-based")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        steps: int = 0
        old: Optional[Grid] = None

        while self.grid.is_valid:
            do_refresh = False
            all_but_rule_equal = self.grid.all_but_rule_equal(old)
            if all_but_rule_equal and self.grid == old:
                for hook in self.solve_iter_hooks or []:
                    do_refresh |= hook(self)
                if do_refresh:
                    _update_candidates_from_known(self.grid._candidates, self.grid._known)
                if self.grid == old:
                    break
            old = self.grid.deepcopy()
            _lg.logstep(_MAX_LVL, self.upsteps, str(steps))
            if not all_but_rule_equal:
                _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
            else:
                # noinspection PyProtectedMember
                _lg.logs(_MAX_LVL, self.grid._str_header(detailed=True))
            steps = steps + 1
            self._update_step()

        status: SolveStatus
        if not self.grid.is_valid:
            status = SolveStatus.INVALID
        elif self.grid.is_solved:
            status = SolveStatus.SOLVED
        else:
            status = SolveStatus.NONE

        _lg.logs(_MAX_LVL, f"Done after {steps} steps: \t{status}")
        _lg.logg(_MAX_LVL, self.grid, print_candidates=True)
        return status

    # noinspection PyProtectedMember
    def _update_step(self) -> None:
        _update_known_from_candidates(self.grid.__setitem__, self.grid._candidates, self.grid._known)
        try:
            self._update_from_rules()
            self._filter_guarantees()
        except InvalidGrid:
            pass

    # rule updates
    # noinspection PyProtectedMember
    def _update_from_rules(self) -> None:
        for rule in self.grid.rules.copy():
            try:
                do_refresh, new_rules, new_gts = rule.apply(
                    self.grid._known, self.grid._candidates, self.grid.guarantees)
                if do_refresh:
                    _update_candidates_from_known(self.grid._candidates, self.grid._known)
            except RuleAlwaysSatisfied:
                new_rules = []
                new_gts = None
                _update_candidates_from_known(self.grid._candidates, self.grid._known)
            if new_rules is not None:
                self.grid.deactivate_rule(rule)
                for new_rule in new_rules:
                    self.grid.add_rule_checked(new_rule)
            if new_gts is not None:
                for gt in new_gts:
                    self.grid.add_gtee_checked(gt)

    def _filter_guarantees(self) -> None:
        gt: Guarantee

        for val in range(1, self.grid.max_elem + 1):
            for gt1, gt2 in itertools.combinations((gt for gt in self.grid.guarantees if gt.val == val), 2):
                if gt1.cells <= gt2.cells and gt1 in self.grid.guarantees and gt2 in self.grid.guarantees:
                    self.grid.deactivate_gtee(gt2)
                elif gt2.cells <= gt1.cells and gt1 in self.grid.guarantees and gt2 in self.grid.guarantees:
                    self.grid.deactivate_gtee(gt1)

        for gt in self.grid.guarantees.copy():
            self._update_from_guarantee(gt)

    # todo combine guarantees like AtLeastOnce

    # noinspection PyProtectedMember
    def _update_from_guarantee(self, gt: Guarantee):
        first_idx = -1
        is_single = True
        for cell in gt.cells:
            if gt.val in self.grid._candidates[cell]:
                if first_idx == -1:
                    first_idx = cell
                else:
                    is_single = False
            if gt.val == self.grid._known[cell]:
                self.grid.deactivate_gtee(gt)
                return

        if is_single:
            if first_idx == -1:
                self.grid._candidates[next(iter(gt.cells))].clear()
                raise InvalidGrid()
            pfi: Set[int] = self.grid._candidates[first_idx]
            kfi = self.grid._known[first_idx]
            if kfi == 0 and gt.val in pfi:
                self.grid._known[first_idx] = gt.val
                self.grid.deactivate_gtee(gt)
                return
            else:
                pfi.clear()
                raise InvalidGrid()

        if any(self.grid._known[cell] > 0 or gt.val not in self.grid._candidates[cell] for cell in gt.cells):
            self.grid.deactivate_gtee(gt)

            new_cells = frozenset(cell for cell in gt.cells if self.grid._known[cell] == 0 and
                                  gt.val in self.grid._candidates[cell])

            if not new_cells:
                self.grid._candidates[next(iter(gt.cells))].clear()
                raise InvalidGrid()

            new_gt = Guarantee(val=gt.val, cells=new_cells, rows=self.grid.rows, cols=self.grid.cols)
            self.grid.add_gtee_checked(new_gt)


def _update_known_from_candidates(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                  known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def _update_candidates_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p &= {k}


def _solve_full(grid: Grid,
                steps: List[int],
                max_sols: int,
                solve_iter_hooks: Sequence[Callable[[AtomicSolver], bool]] = None
                ) -> (Set[ImmutableGrid], Set[ImmutableGrid]):
    steps.append(0)
    if len(steps) == len(grid) - GC_LEN_PARAM:
        gc.collect()

    solved: SolveStatus = AtomicSolver(grid, steps, solve_iter_hooks).solve_atomic()
    if solved == SolveStatus.SOLVED:
        steps.pop()
        return {ImmutableGrid(grid.known, grid.rows, grid.cols, grid.max_elem, type(grid).__name__)}, set()
    if solved == SolveStatus.INVALID:
        steps.pop()
        return set(), {ImmutableGrid(grid.known, grid.rows, grid.cols, grid.max_elem, type(grid).__name__)}

    test_i, p = grid.get_smallest_candidate_set_gt1()
    test_gt = grid.get_smallest_guarantee()
    tests = list(p)

    is_test_gt = test_gt and len(test_gt.cells) < len(tests)
    if is_test_gt:
        tests = None

    sols: Set[ImmutableGrid] = set()
    wrongs: Set[ImmutableGrid] = set()
    for test_val_cell in tests or test_gt.cells:
        mylen = len(steps)
        if is_test_gt:
            _lg.logstep(mylen, steps,
                        f"Trial (guarantee) [{test_val_cell % grid.rows},{test_val_cell // grid.rows}] " +
                        f"== {test_gt.val} with {len(sols)} previous solutions")
        else:
            _lg.logstep(mylen, steps,
                        f"Trial [{test_i % grid.rows},{test_i // grid.rows}] " +
                        f"== {test_val_cell} with {len(sols)} previous solutions")
        clone: Grid = grid.deepcopy()

        if is_test_gt:
            clone[test_val_cell] = test_gt.val
        else:
            clone[test_i] = test_val_cell

        sols_x: Set[ImmutableGrid]
        wrongs_x: Set[ImmutableGrid]
        new_max: int = -1 if max_sols == -1 else max_sols - len(sols)
        sols_x, wrongs_x = _solve_full(clone, steps, new_max, solve_iter_hooks)
        steps[mylen - 1] = steps[mylen - 1] + 1
        sols.update(sols_x)
        wrongs.update(wrongs_x)
        if 0 < max_sols <= len(sols):
            _lg.logs(0, f"Step {steps} - Reached max_sols == {max_sols} ")
            sols = set(itertools.islice(iter(sols), max_sols))
            break

    steps.pop()
    return sols, wrongs


# noinspection PyProtectedMember
def rulehelper_atmostonce(ats: AtomicSolver) -> bool:
    most_one_rules = [rule for rule in ats.grid.rules if isinstance(rule, unique.ElementsAtMostOnce)]

    for rule in most_one_rules:
        cells = frozenset(rule.cells)
        if len(cells) > 1:
            for cell in cells:
                new_rule = uneq.UneqRule(ats.grid, cell, cells - {cell})
                ats.grid.add_rule_checked(new_rule)
    return False


def rulehelper_uneq(ats: AtomicSolver) -> bool:
    uneq_rules = [rule for rule in ats.grid.rules if isinstance(rule, uneq.UneqRule)]

    for oc in range(ats.grid.len):
        uneq_rule_cells_oc = {(frozenset(rule.rel_cells), rule) for rule in uneq_rules if
                              rule.origin_cell == oc}
        if len(uneq_rule_cells_oc) > 1:
            uni = frozenset.union(*(cells for cells, _ in uneq_rule_cells_oc))

            for cells, rl in uneq_rule_cells_oc.copy():
                if cells < uni:
                    ats.grid.deactivate_rule(rl)
                    uneq_rule_cells_oc.remove((cells, rl))

            if not uneq_rule_cells_oc:
                new_rule = uneq.UneqRule(ats.grid, oc, uni)
                ats.grid.add_rule_checked(new_rule)
    return False


def rulehelper_sum_atmostonce(ats: AtomicSolver) -> bool:
    most_one_rule_cells = [frozenset(rule.cells) for rule in ats.grid.rules if
                           isinstance(rule, unique.ElementsAtMostOnce)
                           and not isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

    sum_once_rules = [rule for rule in ats.grid.rules if isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

    set_dic: Dict[sumrules.SumAndElementsAtMostOnce, FrozenSet[int]] = {}
    rule_cntn_dic: Dict[FrozenSet[int], List[sumrules.SumAndElementsAtMostOnce]] = {key: [] for key in
                                                                                    most_one_rule_cells}

    for rule_sum in sum_once_rules:
        cells = frozenset(rule_sum.cells)
        set_dic[rule_sum] = cells
        for rule_most_cells in most_one_rule_cells:
            if cells <= rule_most_cells:
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
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=ats.grid, cells=union_cells,
                                                             mysum=rule1.sum + rule2.sum)
                ats.grid.add_rule_checked(new_rule)

    for rule_most_cells in most_one_rule_cells:
        lrmc = len(rule_most_cells)
        for rule in rule_cntn_dic[rule_most_cells]:
            cells = set_dic[rule]
            lc = len(cells)
            if lc != len(rule_most_cells) and ats.grid.max_elem == lrmc:
                new_sum = int(ats.grid.max_elem * (ats.grid.max_elem + 1) / 2) - rule.sum
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=ats.grid, cells=rule_most_cells - cells, mysum=new_sum)
                ats.grid.add_rule_checked(new_rule)
    return False
