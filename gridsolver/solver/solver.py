import gc
import itertools
from typing import Set, List, Optional

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.solver_log import lg as _lg

GC_LEN_PARAM: int = 22


def set_loglevel(lvl: int):
    _lg.set_lvl(lvl)


def solve(grid: Grid, log_level: int = None, max_sols: int = -1) -> Optional[Set[ImmutableGrid]]:
    if log_level is not None:
        set_loglevel(log_level)
    sols: Set[ImmutableGrid]
    grid.has_been_filled = True

    sols, _ = _solve_full(grid.deepcopy(), [], max_sols, set())

    for idx, sol in enumerate(sols):
        _lg.logs(0, "Solution " + str(idx), header=True)
        _lg.logg(0, sol, format_args=grid.format_args, rules=grid.rules)

    if len(sols) == 0:
        _lg.logs(0, "No solution found.", header=True)

    return sols


def _solve_full(grid: Grid,
                steps: List[int],
                max_sols: int,
                hidden_pair_checked_gts: Set[Guarantee]
                ) -> (Set[ImmutableGrid], Set[ImmutableGrid]):
    steps.append(0)
    if len(steps) == len(grid) - GC_LEN_PARAM:
        gc.collect()

    solved: SolveStatus = AtomicSolver(grid, steps, hidden_pair_checked_gts).solve_atomic()
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

    def do_trial(test_val_cell):  # todo
        nonlocal sols

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
        sols_x, wrongs_x = _solve_full(clone, steps, new_max, grid.guarantees)
        steps[mylen - 1] = steps[mylen - 1] + 1
        sols.update(sols_x)
        wrongs.update(wrongs_x)
        if 0 < max_sols <= len(sols):
            _lg.logs(0, f"Step {steps} - Reached max_sols == {max_sols} ")
            sols = set(itertools.islice(iter(sols), max_sols))
            return True
        return False

    for test_val_cell in tests or test_gt.cells:
        done = do_trial(test_val_cell)
        if done:
            break

    steps.pop()
    return sols, wrongs
