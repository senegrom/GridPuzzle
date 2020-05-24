import gc
from itertools import islice
from typing import *

from grid_classes.classes import Grid, SolveStatus
from util import PrettyPrintArgs

GC_LEN_PARAM: int = 22


def solve_full(grid: Grid, print_info: int = 0, max_sols: int = -1,
               return_solutions: bool = True) -> Optional[Set[Grid]]:
    sols: Set[Grid]
    sols, _ = __solve_full(grid.deepcopy(), print_info, [], max_sols)

    for idx, sol in enumerate(sols):
        print("Solution " + str(idx))
        print(sol.to_str(PrettyPrintArgs(print_possible=False, args=grid.format_args)))

    if len(sols) == 0:
        print("No solution found.")

    return sols if return_solutions else None


def __solve_full(grid: Grid, print_info: int, steps: List[int], max_sols: int) -> (Set['Grid'], Set['Grid']):
    steps.append(0)
    print_all: bool = print_info < 0
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
        sols_x, wrongs_x = __solve_full(clone, print_info, steps, new_max)
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
