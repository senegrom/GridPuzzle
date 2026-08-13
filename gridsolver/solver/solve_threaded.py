"""Opt-in top-level search over a free-threaded Python thread pool.

The process executor remains the default. Each thread owns a private root
object graph and creates detached branch grids from it. Running branches stop
cooperatively when a deterministic positive solution cap has been satisfied.
"""

from __future__ import annotations

import concurrent.futures
import pickle
import threading
from collections import deque
from dataclasses import dataclass

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver.atomic_solver import (
    PowerStats,
    collect_power_stats,
    current_power_stats,
)
from gridsolver.solver.solver import (
    _atomic_pass_or_branches,
    _cap_solutions,
)
from gridsolver.solver.solver_log import lg as _lg


_THREAD_STATE = threading.local()


def _init_thread_worker(worker_payload: bytes) -> None:
    """Unpickle one private root object graph for the current worker."""
    root = pickle.loads(worker_payload)
    if not isinstance(root, Grid):
        raise TypeError("Thread worker payload did not contain a Grid")
    _THREAD_STATE.root = root


def _fresh_thread_grid() -> Grid:
    root = getattr(_THREAD_STATE, "root", None)
    if root is None:
        raise RuntimeError("Thread worker root grid was not initialised")
    # The private root keeps rule and guarantee objects local to this thread;
    # the purpose-built clone detaches all mutable puzzle state per task.
    return root.deepcopy()


def _strip_solver_caches(grid: Grid) -> None:
    """Drop derived state before serialising a worker-private root."""
    grid._struct_cache.clear()
    grid._rule_cache.clear()
    grid._guarantee_cache.clear()
    # These trail-aware memos are deliberately omitted by Grid.deepcopy().
    # The thread path now reuses the solver-owned root directly, so remove
    # them explicitly to preserve the same cache-free worker contract.
    for name in ("_fish_value_memo", "_house_sums_memo"):
        if hasattr(grid, name):
            delattr(grid, name)


def _solve_full_cancellable(
    grid: Grid,
    steps: list[int],
    max_sols: int,
    hidden_pair_checked_gts: set[Guarantee],
    depth_gate: int | None = None,
    *,
    cancel_event: threading.Event,
) -> set[ImmutableGrid]:
    """Mirror the recursive solver with cooperative thread cancellation.

    The ordinary ``solver._solve_full`` is intentionally left byte-for-byte
    unchanged: even a cheap optional-event check at every search node showed
    up in default-path benchmarks.  Thread mode is opt-in, so its cancellation
    checks live entirely in this module instead.
    """
    if cancel_event.is_set():
        return set()
    steps.append(0)
    try:
        settled, branches, from_guarantee = _atomic_pass_or_branches(
            grid,
            steps,
            hidden_pair_checked_gts,
            depth_gate,
        )
        if cancel_event.is_set():
            return set()
        if settled is not None:
            return settled

        solutions: set[ImmutableGrid] = set()
        checked_guarantees = set(grid.guarantees)

        for cell, value in branches:
            if cancel_event.is_set():
                return set()
            depth = len(steps)
            if _lg.is_enabled(depth):
                _lg.logstep(
                    depth,
                    steps,
                    f"Trial{' (guarantee)' if from_guarantee else ''} "
                    f"[{cell % grid.rows},{cell // grid.rows}] "
                    f"== {value} with "
                    f"{len(solutions)} previous solutions",
                )

            mark = grid.trail_mark()
            try:
                grid[cell] = value
                remaining = (
                    -1
                    if max_sols == -1
                    else max_sols - len(solutions)
                )
                branch_solutions = _solve_full_cancellable(
                    grid,
                    steps,
                    remaining,
                    checked_guarantees,
                    depth_gate,
                    cancel_event=cancel_event,
                )
            finally:
                grid.trail_undo(mark)

            if cancel_event.is_set():
                return set()
            steps[depth - 1] += 1
            solutions.update(branch_solutions)

            if 0 < max_sols <= len(solutions):
                _lg.logs(
                    0,
                    f"Step {steps} - Reached max_sols == {max_sols}",
                )
                return _cap_solutions(solutions, max_sols)

        return solutions
    finally:
        steps.pop()


@dataclass(slots=True)
class _ThreadBranchRunner:
    """Run each submitted branch on a fresh worker-private grid clone."""

    depth_gate: int | None
    cancel_event: threading.Event
    collect_stats: bool

    def __call__(
        self,
        payload: tuple[int, int, int],
    ) -> set[ImmutableGrid] | tuple[set[ImmutableGrid], PowerStats]:
        if self.cancel_event.is_set():
            if self.collect_stats:
                return set(), PowerStats()
            return set()

        cell, value, max_sols = payload
        # A fresh clone avoids a whole-branch outer trail frame. That frame
        # journals every root-branch mutation and regressed long enumeration
        # branches under Python 3.14t.
        grid = _fresh_thread_grid()
        grid[cell] = value
        with _lg.muted_context():
            if self.collect_stats:
                with collect_power_stats() as stats:
                    solutions = _solve_full_cancellable(
                        grid,
                        [0],
                        max_sols,
                        set(),
                        self.depth_gate,
                        cancel_event=self.cancel_event,
                    )
                return solutions, stats

            return _solve_full_cancellable(
                grid,
                [0],
                max_sols,
                set(),
                self.depth_gate,
                cancel_event=self.cancel_event,
            )


def solve_thread_trials(
    grid: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    workers: int,
    depth_gate: int | None = None,
) -> set[ImmutableGrid]:
    """Solve top-level branches concurrently and consume them in order.

    Submission is bounded to one outstanding branch per worker. Results are
    consumed in deterministic branch order, matching the process executor.
    Once a positive solution cap is reached, queued work is cancelled and
    running siblings observe ``cancel_event`` at recursive search boundaries.
    """
    ordered_branches = sorted(branches)
    if not ordered_branches:
        return set()

    _strip_solver_caches(grid)
    solutions: set[ImmutableGrid] = set()
    parent_stats = current_power_stats()
    cancel_event = threading.Event()
    # Grid.deepcopy intentionally shares immutable rule objects. Sharing the
    # root across free-threaded workers therefore creates avoidable contention
    # while each task copies its rule containers. Unpickle once per worker so
    # the full rule/guarantee graph remains thread-private, just as it does in
    # the process executor, while keeping task payloads compact.
    worker_payload = pickle.dumps(grid, protocol=pickle.HIGHEST_PROTOCOL)
    runner = _ThreadBranchRunner(
        depth_gate,
        cancel_event,
        parent_stats is not None,
    )
    pool = concurrent.futures.ThreadPoolExecutor(
        max_workers=workers,
        thread_name_prefix="gridpuzzle",
        initializer=_init_thread_worker,
        initargs=(worker_payload,),
    )
    futures: deque[concurrent.futures.Future] = deque()

    try:
        initial_count = min(workers, len(ordered_branches))
        futures.extend(
            pool.submit(runner, (cell, value, max_sols))
            for cell, value in ordered_branches[:initial_count]
        )
        next_branch_index = initial_count

        while futures:
            future = futures.popleft()
            result = future.result()
            if parent_stats is None:
                branch_solutions = result
            else:
                branch_solutions, branch_stats = result
                parent_stats.merge(branch_stats)
            solutions.update(branch_solutions)

            if 0 < max_sols <= len(solutions):
                cancel_event.set()
                for pending in futures:
                    pending.cancel()
                break

            if next_branch_index < len(ordered_branches):
                cell, value = ordered_branches[next_branch_index]
                next_branch_index += 1
                futures.append(
                    pool.submit(runner, (cell, value, max_sols))
                )
    except BaseException:
        cancel_event.set()
        for pending in futures:
            pending.cancel()
        raise
    finally:
        cancel_event.set()
        pool.shutdown(wait=True, cancel_futures=True)

    return _cap_solutions(solutions, max_sols)
