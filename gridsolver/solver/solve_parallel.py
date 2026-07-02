"""Parallel top-level backtracking trials over a process pool.

Opt-in via solve(grid, processes=N): after one in-process atomic pass, the
first-level trial branches (independent by construction) are distributed to
worker processes; each worker runs the ordinary sequential _solve_full on its
branch and ships back its solution set. Near-linear speedup for
enumeration-heavy workloads (blank grids, multi-solution counts); pointless
for puzzles the atomic solver finishes alone.

max_sols semantics: workers each cap at the remaining budget; pending futures
are cancelled once the budget is met, but already-running branches finish, so
the wall-clock win on capped searches is smaller.
"""
import concurrent.futures
from typing import List, Optional, Set, Tuple

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid


def _solve_branch(payload: Tuple[Grid, int, int, int]) -> Set[ImmutableGrid]:
    grid, cell, value, max_sols = payload
    from gridsolver.solver import solver as _solver
    from gridsolver.solver.solver_log import lg as _lg
    _lg.set_lvl(0)  # worker processes stay quiet
    grid[cell] = value
    return _solver._solve_full(grid, [0], max_sols, set())


def solve_parallel_trials(grid: Grid, branches: List[Tuple[int, int]], max_sols: int,
                          processes: int) -> Optional[Set[ImmutableGrid]]:
    """Distribute (cell, value) trial branches; returns the union of branch
    solutions (capped at max_sols if positive)."""
    grid._struct_cache.clear()  # keep pickles lean
    sols: Set[ImmutableGrid] = set()
    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as pool:
        futures = [pool.submit(_solve_branch, (grid, cell, value, max_sols))
                   for cell, value in branches]
        for fut in concurrent.futures.as_completed(futures):
            sols.update(fut.result())
            if 0 < max_sols <= len(sols):
                for other in futures:
                    other.cancel()
                break
    if 0 < max_sols < len(sols):
        import itertools
        sols = set(itertools.islice(iter(sols), max_sols))
    return sols
