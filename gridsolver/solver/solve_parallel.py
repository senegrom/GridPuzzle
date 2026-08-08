"""Parallel top-level backtracking trials over a Python 3.14 process pool.

The implementation does not rely on ``fork`` semantics: the worker entry point
is module-level and every payload is picklable, so Python 3.14's platform
start methods (forkserver on most POSIX systems and spawn on Windows/macOS)
are exercised by the regression suite.
"""

import concurrent.futures

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid


def _solution_key(solution: ImmutableGrid) -> tuple[int, int, int, tuple[int, ...]]:
    return solution.rows, solution.cols, solution.max_elem, tuple(solution)


def _cap_solutions(
    solutions: set[ImmutableGrid],
    max_sols: int,
) -> set[ImmutableGrid]:
    if max_sols > 0 and len(solutions) > max_sols:
        return set(sorted(solutions, key=_solution_key)[:max_sols])
    return solutions


def _solve_branch(payload: tuple[Grid, int, int, int]) -> set[ImmutableGrid]:
    grid, cell, value, max_sols = payload
    from gridsolver.solver import solver as _solver
    from gridsolver.solver.solver_log import lg as _lg

    _lg.set_lvl(0)
    grid[cell] = value
    return _solver._solve_full(grid, [0], max_sols, set())


def solve_parallel_trials(
    grid: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    processes: int,
) -> set[ImmutableGrid]:
    """Solve branches concurrently while consuming results in branch order.

    Futures still execute in parallel, but deterministic consumption means a
    positive ``max_sols`` returns the same branch-priority subset on repeated
    runs instead of depending on process completion timing.
    """
    grid._struct_cache.clear()
    ordered_branches = sorted(branches)
    solutions: set[ImmutableGrid] = set()

    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as pool:
        futures = [
            pool.submit(_solve_branch, (grid, cell, value, max_sols))
            for cell, value in ordered_branches
        ]
        for index, future in enumerate(futures):
            solutions.update(future.result())
            if 0 < max_sols <= len(solutions):
                for pending in futures[index + 1 :]:
                    pending.cancel()
                break

    return _cap_solutions(solutions, max_sols)
