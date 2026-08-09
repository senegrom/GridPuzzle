"""Parallel top-level backtracking trials over a Python 3.14 process pool.

The implementation does not rely on ``fork`` semantics: the worker entry point
is module-level and every payload is picklable, so Python 3.14's platform
start methods are exercised by the regression suite.
"""

import concurrent.futures
from collections import deque

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.solver.atomic_solver import (
    PowerStats,
    collect_power_stats,
    current_power_stats,
)
from gridsolver.solver.solver import _cap_solutions


def _solve_branch(
    payload: tuple[Grid, int, int, int, int | None],
) -> set[ImmutableGrid]:
    grid, cell, value, max_sols, depth_gate = payload
    from gridsolver.solver import solver as _solver
    from gridsolver.solver.solver_log import lg as _lg

    _lg.set_lvl(0)
    grid[cell] = value
    return _solver._solve_full(grid, [0], max_sols, set(), depth_gate)


def _solve_branch_with_stats(
    payload: tuple[Grid, int, int, int, int | None],
) -> tuple[set[ImmutableGrid], PowerStats]:
    with collect_power_stats() as stats:
        solutions = _solve_branch(payload)
    return solutions, stats


def solve_parallel_trials(
    grid: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    processes: int,
    depth_gate: int | None = None,
) -> set[ImmutableGrid]:
    """Solve branches concurrently while consuming results in branch order."""
    # Derived caches are cheap to rebuild and can dominate pickled payloads.
    grid._struct_cache.clear()
    grid._guarantee_cache.clear()
    ordered_branches = sorted(branches)
    solutions: set[ImmutableGrid] = set()
    stats = current_power_stats()
    worker = _solve_branch_with_stats if stats is not None else _solve_branch

    with concurrent.futures.ProcessPoolExecutor(max_workers=processes) as pool:
        # Keep no more than one outstanding branch per worker. Submitting every
        # branch up front repeats grid pickling and queues work that a small
        # positive solution cap may never need.
        initial_count = min(processes, len(ordered_branches))
        futures = deque(
            pool.submit(
                worker,
                (grid, cell, value, max_sols, depth_gate),
            )
            for cell, value in ordered_branches[:initial_count]
        )
        next_branch_index = initial_count

        while futures:
            future = futures.popleft()
            result = future.result()
            if stats is None:
                branch_solutions = result
            else:
                branch_solutions, branch_stats = result
                stats.merge(branch_stats)
            solutions.update(branch_solutions)

            if 0 < max_sols <= len(solutions):
                for pending in futures:
                    pending.cancel()
                # Python 3.14 can stop branches already running. Without this,
                # context-manager exit waits for every worker after the
                # deterministic capped subset is complete.
                if futures:
                    pool.terminate_workers()
                break

            if next_branch_index < len(ordered_branches):
                cell, value = ordered_branches[next_branch_index]
                next_branch_index += 1
                futures.append(
                    pool.submit(
                        worker,
                        (grid, cell, value, max_sols, depth_gate),
                    )
                )

    return _cap_solutions(solutions, max_sols)
