import gc
import itertools

from grid_classes.classes import Grid, SolveStatus
from rules import unique, uneq, sumrules
from rules.rules import *
from util import PrettyPrintArgs

GC_LEN_PARAM: int = 22


def solve(grid: Grid, print_info: int = 0, max_sols: int = -1,
          return_solutions: bool = True) -> Optional[Set[Grid]]:
    sols: Set[Grid]
    rulehelpers: List[Callable[['Grid'], None]] = []
    any_unique = any(isinstance(rule, unique.ElementsAtMostOnce) for rule in grid.rules)
    any_sum = any(isinstance(rule, sumrules.SumAndElementsAtMostOnce) or isinstance(rule, sumrules.SumRule) for rule in
                  grid.rules)
    any_uniq_ns = any(
        isinstance(rule, sumrules.ElementsAtMostOnce) and not isinstance(rule, sumrules.SumAndElementsAtMostOnce) for
        rule in grid.rules)
    if any_unique:
        rulehelpers.append(rulehelper_uneq_atmostonce)
    if any_sum and any_uniq_ns:
        rulehelpers.append(rulehelper_sum_atmostonce)

    sols, _ = __solve_full(grid.deepcopy(), print_info, [], max_sols, rulehelpers)

    for idx, sol in enumerate(sols):
        print("Solution " + str(idx))
        print(sol.to_str(PrettyPrintArgs(print_possible=False, args=grid.format_args)))

    if len(sols) == 0:
        print("No solution found.")

    return sols if return_solutions else None


def __solve_atomic(grid: Grid, is_print: bool = False, upsteps: Sequence[int] = None,
                   solve_iter_hooks: Sequence[Callable[['Grid'], None]] = None) -> SolveStatus:
    grid.presolve_hook()
    if grid.presolved_not_yet_once:
        grid.presolve_hook_once()
        grid.presolved_not_yet_once = False

    steps: int = 0
    old: Optional[Grid] = None

    while True:
        if not grid.is_valid:
            break
        all_but_rule_equal = grid.all_but_rule_equal(old)
        if grid == old:
            for hook in solve_iter_hooks or []:
                hook(grid)
            if grid == old:
                break
        old = grid.deepcopy()
        if is_print:
            if not all_but_rule_equal:
                print(f"Step {upsteps} - {steps}")
                print(
                    grid.to_str(PrettyPrintArgs(print_possible=True, args=grid.format_args, detail_rule=True)))
            else:
                print(f"Step {upsteps} - {steps}")
                # noinspection PyProtectedMember
                print(grid._str_header(detailed=True))
        steps = steps + 1
        __update_step(grid)

    status: SolveStatus = SolveStatus.INVALID if not grid.is_valid else (
        SolveStatus.SOLVED if grid.is_solved else SolveStatus.NONE)

    if is_print:
        print(f"Done after {steps} steps: \t{status}")
        print(grid.to_str(PrettyPrintArgs(print_possible=True, args=grid.format_args)))
    return status


# rule updates

def __update_known_from_possible(setitem: Callable[[int, int], None], possible: Tuple[Set[int]],
                                 known: ArrayType) -> None:
    for i, p in enumerate(possible):
        if len(p) == 1 and known[i] == 0:
            setitem(i, next(iter(p)))


def __refresh_possible_from_known(possible: Tuple[Set[int]], known: ArrayType) -> None:
    for p, k in zip(possible, known):
        if k > 0 and len(p) > 1:
            p.intersection_update({k})


def __update_from_rules(grid: Grid, possible: Tuple[Set[int]], known: ArrayType) -> None:
    rule: Rule
    rules = grid.rules.copy()
    for rule in rules:
        try:
            do_refresh, new_rules, new_gts = rule.apply(known, possible, grid.guarantees)
            if do_refresh:
                __refresh_possible_from_known(possible, known)
        except RuleAlwaysSatisfied:
            new_rules = []
            new_gts = None
            __refresh_possible_from_known(possible, known)
        if new_rules is not None:
            grid.deactivate_rule(rule)
            for new_rule in new_rules:
                grid.add_rule_checked(new_rule)
        if new_gts is not None:
            for gt in new_gts:
                grid.add_gtee_checked(gt)


def __filter_guarantees(grid: Grid, possible: Tuple[Set[int]], known: ArrayType) -> None:
    gt: Guarantee

    gts = [(gt.val, frozenset(gt.cells), gt) for gt in grid.guarantees]
    for val in range(1, grid.max_elem + 1):
        for (_, cells1, gt1), (_, cells2, gt2) in itertools.combinations((x for x in gts if x[0] == val), 2):
            if cells1.issubset(cells2) and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt2)
            elif cells2.issubset(cells1) and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt1)

    gts = grid.guarantees.copy()
    for gt in gts:
        __update_from_guarantee(grid, gt, possible, known)


def __update_from_guarantee(grid: Grid, gt: Guarantee, possible: Tuple[Set[int]], known: ArrayType):
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
            possible[gt.cells[0]].clear()
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

        new_cells = []
        for cell in gt.cells:
            if known[cell] == 0 and gt.val in possible[cell]:
                new_cells.append(cell)

        if not new_cells:
            possible[gt.cells[0]].clear()
            raise InvalidGrid()

        new_gt = Guarantee(val=gt.val, cells=array('i', new_cells))
        grid.add_gtee_checked(new_gt)


# noinspection PyProtectedMember
def __update_step(grid: Grid) -> None:
    __update_known_from_possible(grid.__setitem__, grid._possible, grid._known)
    try:
        __update_from_rules(grid, grid._possible, grid._known)
        __filter_guarantees(grid, grid._possible, grid._known)
    except InvalidGrid:
        pass


def __solve_full(grid: Grid, print_info: int, steps: List[int], max_sols: int,
                 solve_iter_hooks: Sequence[Callable[['Grid'], None]] = None) -> (Set[Grid], Set[Grid]):
    steps.append(0)
    print_all: bool = print_info < 0
    mylen = len(steps)
    if mylen == grid.len - GC_LEN_PARAM:
        gc.collect()
    solved: SolveStatus = __solve_atomic(grid, print_all, steps, solve_iter_hooks)
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
        if print_all or mylen <= print_info:
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
        sols_x, wrongs_x = __solve_full(clone, print_info, steps, new_max)
        steps[mylen - 1] = steps[mylen - 1] + 1
        sols.update(sols_x)
        wrongs.update(wrongs_x)
        if 0 < max_sols <= len(sols):
            if print_all:
                print(f"Step {steps} - Reached max_sols == {max_sols} ")
            sols = set(itertools.islice(iter(sols), max_sols))
            break

    steps.pop()
    return sols, wrongs


def rulehelper_uneq_atmostonce(grid: Grid) -> None:
    most_one_rule_cells = (rule for rule in grid.rules if isinstance(rule, unique.ElementsAtMostOnce))

    for rule in most_one_rule_cells:
        cells: FrozenSet[int] = frozenset(rule.cells)
        if len(cells) > 1:
            for cell in cells:
                new_rule = uneq.UneqRule(grid, cell, cells - {cell})
                grid.add_rule_checked(new_rule)

    uneq_rule_cells = [rule for rule in grid.rules if isinstance(rule, uneq.UneqRule)]

    for oc in range(grid.len):
        uneq_rule_cells_oc = {(frozenset(rule.rel_cells), rule) for rule in uneq_rule_cells if
                              rule.origin_cell == oc}
        if len(uneq_rule_cells_oc) > 1:
            uni = frozenset.union(*(cells for cells, rl in uneq_rule_cells_oc))

            for cells, rl in uneq_rule_cells_oc.copy():
                if cells.issubset(uni) and uni != cells:
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
    rule_cntn_dic: Dict[FrozenSet[int], List[sumrules.SumAndElementsAtMostOnce]] = {}

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
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=union_cells, mysum=rule1.sum + rule2.sum)
                grid.add_rule_checked(new_rule)

    for rule_most_cells in most_one_rule_cells:
        for rule in rule_cntn_dic[rule_most_cells]:
            cells = set_dic[rule]
            lc = len(cells)
            if lc != len(rule_most_cells) and grid.max_elem == len(rule_most_cells):
                new_sum = int(grid.max_elem * (grid.max_elem + 1) / 2) - rule.sum
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=rule_most_cells - cells, mysum=new_sum)
                grid.add_rule_checked(new_rule)
