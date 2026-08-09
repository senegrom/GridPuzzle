"""Parallel top-level backtracking trials over a Python 3.14 process pool.

The implementation does not rely on ``fork`` semantics: the worker entry point
is module-level and every payload is picklable, so Python 3.14's platform
start methods are exercised by the regression suite.
"""

import concurrent.futures
import pickle
from collections import deque

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.solver.atomic_solver import (
    PowerStats,
    collect_power_stats,
    current_power_stats,
)
from gridsolver.solver.solver import _cap_solutions


_WORKER_ROOT_GRID: Grid | None = None
_WORKER_DEPTH_GATE: int | None = None


def _init_worker(worker_payload: bytes) -> None:
    """Unpickle one immutable-by-convention root grid per worker."""
    global _WORKER_ROOT_GRID, _WORKER_DEPTH_GATE
    decoded = pickle.loads(worker_payload)
    if isinstance(decoded, Grid):
        # Backwards-compatible direct initialisation used by tests and
        # third-party embedding code written before depth_gate existed.
        root = decoded
        depth_gate = None
    elif (
        isinstance(decoded, tuple)
        and len(decoded) == 2
        and isinstance(decoded[0], Grid)
    ):
        root, depth_gate = decoded
    else:
        raise TypeError(
            "Parallel worker payload did not contain a Grid"
        )

    if depth_gate is not None and (
        type(depth_gate) is not int or depth_gate < 0
    ):
        raise TypeError(
            "Parallel worker depth_gate must be None or a non-negative int"
        )
    _WORKER_ROOT_GRID = root
    _WORKER_DEPTH_GATE = depth_gate


def _fresh_worker_grid() -> Grid:
    root = _WORKER_ROOT_GRID
    if root is None:
        raise RuntimeError("Parallel worker root grid was not initialised")
    # Grid.deepcopy is purpose-built for branch isolation: it copies puzzle
    # state, resets trails and derived caches, and invokes subclass copy hooks.
    return root.deepcopy()


def _solve_branch(
    payload: tuple[int, int, int],
) -> set[ImmutableGrid]:
    cell, value, max_sols = payload
    grid = _fresh_worker_grid()
    from gridsolver.solver import solver as _solver
    from gridsolver.solver.solver_log import lg as _lg

    _lg.set_lvl(0)
    grid[cell] = value
    return _solver._solve_full(
        grid,
        [0],
        max_sols,
        set(),
        _WORKER_DEPTH_GATE,
    )


def _solve_branch_with_stats(
    payload: tuple[int, int, int],
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
    grid._rule_cache.clear()
    grid._guarantee_cache.clear()
    ordered_branches = sorted(branches)
    solutions: set[ImmutableGrid] = set()
    stats = current_power_stats()
    worker = _solve_branch_with_stats if stats is not None else _solve_branch

    # Serialize the root and the explicit per-solve gate once. Each worker
    # receives that immutable payload through its initializer; task payloads
    # remain the same compact three-scalar tuples as before.
    worker_root = grid if depth_gate is None else (grid, depth_gate)
    worker_payload = pickle.dumps(
        worker_root,
        protocol=pickle.HIGHEST_PROTOCOL,
    )
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=processes,
        initializer=_init_worker,
        initargs=(worker_payload,),
    ) as pool:
        # Keep no more than one outstanding branch per worker. Submitting every
        # branch up front queues work that a small positive solution cap may
        # never need.
        initial_count = min(processes, len(ordered_branches))
        futures = deque(
            pool.submit(
                worker,
                (cell, value, max_sols),
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
                        (cell, value, max_sols),
                    )
                )

    return _cap_solutions(solutions, max_sols)
