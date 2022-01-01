import gc
import itertools
from array import ArrayType
from typing import Tuple, Set, Sequence, List, Dict, FrozenSet, Optional, Callable

import gridsolver.solver.logger
from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs
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
    rulehelpers: List[Callable[['Grid'], None]] = []
    grid.has_been_filled = True

    any_unique = any(isinstance(rule, unique.ElementsAtMostOnce) for rule in grid.rules)
    any_sum = any(isinstance(rule, sumrules.SumRule) for rule in grid.rules)
    any_uniq_ns = any(
        isinstance(rule, sumrules.ElementsAtMostOnce) and not isinstance(rule, sumrules.SumAndElementsAtMostOnce) for
        rule in grid.rules)
    if any_unique:
        rulehelpers.append(rulehelper_uneq_atmostonce)
    if any_sum and any_uniq_ns:
        rulehelpers.append(rulehelper_sum_atmostonce)

    sols, _ = _solve_full(grid.deepcopy(), [], max_sols, rulehelpers)

    for idx, sol in enumerate(sols):
        _lg.logs(0, "Solution " + str(idx), header=True)
        _lg.logg(0, sol)

    if len(sols) == 0:
        _lg.logs(0, "No solution found.", header=True)

    return sols


def _solve_atomic(grid: Grid, upsteps: List[int] = None,
                  solve_iter_hooks: Sequence[Callable[['Grid'], None]] = None) -> SolveStatus:
    steps: int = 0
    old: Optional[Grid] = None

    while grid.is_valid:
        all_but_rule_equal = grid.all_but_rule_equal(old)
        if grid == old:
            for hook in solve_iter_hooks or []:
                hook(grid)
            if grid == old:
                break
        old = grid.deepcopy()
        _lg.logstep(len(upsteps), upsteps, str(steps))
        if not all_but_rule_equal:
            _lg.logg(_MAX_LVL, grid, print_candidates=True)
        else:
            # noinspection PyProtectedMember
            _lg.logs(_MAX_LVL, grid._str_header(detailed=True))
        steps = steps + 1
        _update_step(grid)

    status: SolveStatus
    if not grid.is_valid:
        status = SolveStatus.INVALID
    elif grid.is_solved:
        status = SolveStatus.SOLVED
    else:
        status = SolveStatus.NONE

    _lg.logs(_MAX_LVL, f"Done after {steps} steps: \t{status}")
    _lg.logg(_MAX_LVL, grid, print_candidates=True)
    return status


# rule updates

def _update_known_from_possible(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def _refresh_possible_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p &= {k}


def _update_from_rules(grid: Grid, possible: Tuple[Set[int]], known: ArrayType) -> None:
    for rule in grid.rules.copy():
        try:
            do_refresh, new_rules, new_gts = rule.apply(known, possible, grid.guarantees)
            if do_refresh:
                _refresh_possible_from_known(possible, known)
        except RuleAlwaysSatisfied:
            new_rules = []
            new_gts = None
            _refresh_possible_from_known(possible, known)
        if new_rules is not None:
            grid.deactivate_rule(rule)
            for new_rule in new_rules:
                grid.add_rule_checked(new_rule)
        if new_gts is not None:
            for gt in new_gts:
                grid.add_gtee_checked(gt)


def _filter_guarantees(grid: Grid, possible: Tuple[Set[int]], known: ArrayType) -> None:
    gt: Guarantee

    for val in range(1, grid.max_elem + 1):
        for gt1, gt2 in itertools.combinations((gt for gt in grid.guarantees if gt.val == val), 2):
            if gt1.cells <= gt2.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt2)
            elif gt2.cells <= gt1.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt1)

    for gt in grid.guarantees.copy():
        _update_from_guarantee(grid, gt, possible, known)


# todo combine guarantees like AtLeastOnce

def _update_from_guarantee(grid: Grid, gt: Guarantee, possible: Tuple[Set[int]], known: ArrayType):
    first_idx = -1
    is_single = True
    for cell in gt.cells:
        if gt.val in possible[cell]:
            if first_idx == -1:
                first_idx = cell
            else:
                is_single = False
        if gt.val == known[cell]:
            grid.deactivate_gtee(gt)
            return

    if is_single:
        if first_idx == -1:
            possible[next(iter(gt.cells))].clear()
            raise InvalidGrid()
        pfi: Set[int] = possible[first_idx]
        kfi = known[first_idx]
        if kfi == 0 and gt.val in pfi:
            grid[first_idx] = gt.val
            grid.deactivate_gtee(gt)
            return
        else:
            pfi.clear()
            raise InvalidGrid()

    if any(known[cell] > 0 or gt.val not in possible[cell] for cell in gt.cells):
        grid.deactivate_gtee(gt)

        new_cells = frozenset(cell for cell in gt.cells if known[cell] == 0 and gt.val in possible[cell])

        if not new_cells:
            possible[next(iter(gt.cells))].clear()
            raise InvalidGrid()

        new_gt = Guarantee(val=gt.val, cells=new_cells, rows=grid.rows, cols=grid.cols)
        grid.add_gtee_checked(new_gt)


# noinspection PyProtectedMember
def _update_step(grid: Grid) -> None:
    _update_known_from_possible(grid.__setitem__, grid._candidates, grid._known)
    try:
        _update_from_rules(grid, grid._candidates, grid._known)
        _filter_guarantees(grid, grid._candidates, grid._known)
    except InvalidGrid:
        pass


def _solve_full(grid: Grid, steps: List[int], max_sols: int, solve_iter_hooks: Sequence[Callable[['Grid'], None]] = None
                ) -> (Set[ImmutableGrid], Set[ImmutableGrid]):
    steps.append(0)
    if len(steps) == len(grid) - GC_LEN_PARAM:
        gc.collect()

    solved: SolveStatus = _solve_atomic(grid, steps, solve_iter_hooks)
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
        sols_x, wrongs_x = _solve_full(clone, steps, new_max)
        steps[mylen - 1] = steps[mylen - 1] + 1
        sols.update(sols_x)
        wrongs.update(wrongs_x)
        if 0 < max_sols <= len(sols):
            _lg.logs(0, f"Step {steps} - Reached max_sols == {max_sols} ")
            sols = set(itertools.islice(iter(sols), max_sols))
            break

    steps.pop()
    return sols, wrongs


def rulehelper_uneq_atmostonce(grid: Grid) -> None:
    most_one_rule_cells = [rule for rule in grid.rules if isinstance(rule, unique.ElementsAtMostOnce)]

    for rule in most_one_rule_cells:
        cells: FrozenSet[int] = frozenset(rule.cells)
        if len(cells) > 1:
            for cell in cells:
                new_rule = uneq.UneqRule(grid, cell, cells - {cell})
                grid.add_rule_checked(new_rule)

    uneq_rule_cells = [rule for rule in grid.rules if isinstance(rule, uneq.UneqRule)]

    for oc in range(len(grid)):
        uneq_rule_cells_oc = {(frozenset(rule.rel_cells), rule) for rule in uneq_rule_cells if
                              rule.origin_cell == oc}
        if len(uneq_rule_cells_oc) > 1:
            uni = frozenset.union(*(cells for cells, rl in uneq_rule_cells_oc))

            for cells, rl in uneq_rule_cells_oc.copy():
                if cells < uni:
                    grid.deactivate_rule(rl)
                    uneq_rule_cells_oc.remove((cells, rl))

            if not uneq_rule_cells_oc:
                new_rule = uneq.UneqRule(grid, oc, uni)
                grid.add_rule_checked(new_rule)


def rulehelper_sum_atmostonce(grid: Grid) -> None:
    most_one_rule_cells = [frozenset(rule.cells) for rule in grid.rules if
                           isinstance(rule, unique.ElementsAtMostOnce) and
                           not isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

    sum_once_rules = [rule for rule in grid.rules if isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

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
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=union_cells, mysum=rule1.sum + rule2.sum)
                grid.add_rule_checked(new_rule)

    for rule_most_cells in most_one_rule_cells:
        lrmc = len(rule_most_cells)
        for rule in rule_cntn_dic[rule_most_cells]:
            cells = set_dic[rule]
            lc = len(cells)
            if lc != len(rule_most_cells) and grid.max_elem == lrmc:
                new_sum = int(grid.max_elem * (grid.max_elem + 1) / 2) - rule.sum
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=rule_most_cells - cells, mysum=new_sum)
                grid.add_rule_checked(new_rule)
