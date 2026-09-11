"""Parallel top-level backtracking trials over a Python 3.14 process pool.

The implementation does not rely on ``fork`` semantics: the worker entry point
is module-level and every payload is picklable, so Python 3.14's platform
start methods are exercised by the regression suite.
"""

import concurrent.futures
import pickle
from collections import deque
from contextlib import nullcontext

from gridsolver.abstract_grids.extension_scope import protect_source, sandbox_sources, worker_serialization

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.solver.atomic_solver import (
    PowerStats,
    collect_power_stats,
    current_power_stats,
)
from gridsolver.solver.solver import _cap_solutions
from gridsolver.solver.validation import _requires_source_isolation


_WORKER_ROOT_GRID: Grid | None = None


def _serialize_worker_root(grid: Grid) -> bytes:
    """Serialize the complete source-owner graph without transient solver state."""
    scope = grid._extension_sandbox() if _requires_source_isolation(grid) else nullcontext()
    with scope, worker_serialization():
        return pickle.dumps(grid, protocol=pickle.HIGHEST_PROTOCOL)


def _init_worker(worker_payload: bytes) -> None:
    """Unpickle one immutable-by-convention root grid per worker."""
    global _WORKER_ROOT_GRID
    root = pickle.loads(worker_payload)
    if not isinstance(root, Grid):
        raise TypeError("Parallel worker payload did not contain a Grid")
    _WORKER_ROOT_GRID = root


def _fresh_worker_grid() -> Grid:
    root = _WORKER_ROOT_GRID
    if root is None:
        raise RuntimeError("Parallel worker root grid was not initialised")
    # Grid.deepcopy is purpose-built for branch isolation: it copies puzzle
    # state, resets trails and derived caches, and invokes subclass copy hooks.
    with sandbox_sources():
        return root.deepcopy()


def _solve_branch(
    payload: tuple[int, int, int],
) -> set[ImmutableGrid]:
    cell, value, max_sols = payload
    root = _WORKER_ROOT_GRID
    if root is None:
        raise RuntimeError("Parallel worker root grid was not initialised")
    from gridsolver.solver import solver as _solver
    from gridsolver.solver.solver_log import lg as _lg

    # A fresh interpreter has no parent's ContextVar registry. The serialized
    # source-owner tuple reconstructs that context; both copy hooks and every
    # search hook must finish rollback before the next sibling/task executes.
    scope = protect_source(root) if _requires_source_isolation(root) else nullcontext()
    with scope:
        grid = _fresh_worker_grid()
        _lg.set_lvl(0)
        grid[cell] = value
        return _solver._solve_full(grid, [0], max_sols, set())


def _solve_branch_with_stats(
    payload: tuple[int, int, int],
) -> tuple[set[ImmutableGrid], PowerStats]:
    with collect_power_stats() as stats:
        solutions = _solve_branch(payload)
    return solutions, stats


def _wait_for_uncapped_result(future, siblings) -> None:
    """Observe any required branch failure without reordering successful results.

    Only unlimited solves use this observer: every branch is required there.
    A positive cap intentionally keeps errors outside its consumed prefix
    irrelevant. The bounded submission window also bounds completed results
    held while the first branch is running.
    """
    outstanding = {future, *siblings}
    while outstanding:
        done, outstanding = concurrent.futures.wait(
            outstanding,
            return_when=concurrent.futures.FIRST_COMPLETED,
        )
        for completed in done:
            if completed.exception() is not None:
                completed.result()  # Re-raise the original worker exception.
        if future in done:
            return


def solve_parallel_trials(
    grid: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    processes: int,
) -> set[ImmutableGrid]:
    """Solve branches concurrently while consuming results in branch order.

    A positive cap applies only to the deterministic branch prefix consumed
    before the limit is reached. Later branches are cancelled rather than
    exhausted to compute a global content-key minimum.
    """
    # Derived caches are cheap to rebuild and can dominate pickled payloads.
    grid._struct_cache.clear()
    grid._rule_cache.clear()
    grid._guarantee_cache.clear()
    ordered_branches = sorted(branches)
    solutions: set[ImmutableGrid] = set()
    stats = current_power_stats()
    worker = _solve_branch_with_stats if stats is not None else _solve_branch

    # Serialize the root once. Each worker receives that immutable payload
    # through its initializer; task payloads remain compact three-scalar tuples.
    worker_payload = _serialize_worker_root(grid)
    with concurrent.futures.ProcessPoolExecutor(
        max_workers=processes,
        initializer=_init_worker,
        initargs=(worker_payload,),
    ) as pool:
        futures = deque()
        try:
            # Keep no more than one outstanding branch per worker. Append
            # incrementally so a later submission failure retains earlier work
            # for cancellation, rather than losing a half-built deque.
            initial_count = min(processes, len(ordered_branches))
            for cell, value in ordered_branches[:initial_count]:
                futures.append(pool.submit(worker, (cell, value, max_sols)))
            next_branch_index = initial_count

            while futures:
                future = futures.popleft()
                if max_sols == -1:
                    _wait_for_uncapped_result(future, futures)
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
                    if futures:
                        pool.terminate_workers()
                    break

                if next_branch_index < len(ordered_branches):
                    cell, value = ordered_branches[next_branch_index]
                    next_branch_index += 1
                    futures.append(
                        pool.submit(worker, (cell, value, max_sols))
                    )
        except BaseException as error:
            # Includes KeyboardInterrupt/SystemExit, errors while submitting,
            # worker exceptions, and errors while combining results/stats.
            # A plain context-manager exit waits for already-running siblings.
            for pending in futures:
                try:
                    pending.cancel()
                except Exception as cleanup_error:
                    error.add_note(f"Future cancellation failed: {cleanup_error!r}")
            try:
                pool.terminate_workers()
            except Exception as cleanup_error:
                # Cleanup must not replace the useful original branch error.
                error.add_note(f"Worker termination failed: {cleanup_error!r}")
            raise

    return _cap_solutions(solutions, max_sols)
