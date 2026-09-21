"""Opt-in top-level search over a free-threaded Python thread pool.

The process executor remains the default. Each thread owns a private root
object graph and creates detached branch grids from it, inside the same
source-protection and sandbox scopes the process executor applies. Running
branches stop cooperatively when a deterministic positive solution cap has
been satisfied.
"""

from __future__ import annotations

import concurrent.futures
import pickle
import threading
from collections import deque
from contextlib import nullcontext
from dataclasses import dataclass

from gridsolver.abstract_grids.extension_scope import (
    protect_source,
    sandbox_sources,
    worker_serialization,
)
from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver.atomic_solver import (
    PowerStats,
    collect_power_stats,
    current_power_stats,
)
from gridsolver.solver.solve_parallel import _wait_for_uncapped_result
from gridsolver.solver.solver import (
    _cap_solutions,
    _solve_branch,
)
from gridsolver.solver.solver_log import lg as _lg
from gridsolver.solver.validation import _requires_source_isolation


_THREAD_STATE = threading.local()


def _init_thread_worker(worker_payload: bytes) -> None:
    """Unpickle one private root object graph for the current worker."""
    root = pickle.loads(worker_payload)
    if not isinstance(root, Grid):
        raise TypeError("Thread worker payload did not contain a Grid")
    _THREAD_STATE.root = root


def _thread_root() -> Grid:
    root = getattr(_THREAD_STATE, "root", None)
    if root is None:
        raise RuntimeError("Thread worker root grid was not initialised")
    return root


def _fresh_thread_grid() -> Grid:
    # The private root keeps rule and guarantee objects local to this thread;
    # the purpose-built clone detaches all mutable puzzle state per task. The
    # sandbox keeps a subclass copy hook from editing captured sources.
    with sandbox_sources():
        return _thread_root().deepcopy()


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
    *,
    cancel_event: threading.Event,
) -> set[ImmutableGrid]:
    """Drive suspended DFS frames like ``solver._solve_full``, stopping on request.

    The frames are the same ``_solve_branch`` generators the default driver
    runs, so thread mode is as stack-safe as the sequential search: a deep
    decision chain costs suspended generators, not Python call frames. The
    ordinary driver is intentionally left untouched; polling an optional event
    at every search node measurably regressed the default path when it was
    tried, so the check lives here and runs once per frame push or pop.

    Cancellation closes every suspended frame from the deepest out, which
    runs the same ``finally`` blocks as normal completion (each trail mark is
    undone and ``steps`` is restored), then reports no solutions. The parent
    has already met its cap by then and ignores the result.
    """
    if cancel_event.is_set():
        return set()
    pending = [_solve_branch(grid, steps, max_sols, hidden_pair_checked_gts)]
    solutions = None
    try:
        while True:
            if cancel_event.is_set():
                return set()
            try:
                remaining, checked_guarantees = pending[-1].send(solutions)
            except StopIteration as completed:
                pending.pop()
                if not pending:
                    return completed.value
                solutions = completed.value
            else:
                pending.append(
                    _solve_branch(grid, steps, remaining, checked_guarantees)
                )
                solutions = None
    finally:
        while pending:
            pending.pop().close()


@dataclass(slots=True)
class _ThreadBranchRunner:
    """Run each submitted branch on a fresh worker-private grid clone."""

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
        root = _thread_root()
        # As in the process executor: an extension's search hooks must finish
        # rolling back captured caller state before the next task runs.
        scope = (
            protect_source(root)
            if _requires_source_isolation(root)
            else nullcontext()
        )
        with scope:
            # A fresh clone avoids a whole-branch outer trail frame. That frame
            # journals every root-branch mutation and regressed long
            # enumeration branches under Python 3.14t.
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
                            cancel_event=self.cancel_event,
                        )
                    return solutions, stats

                return _solve_full_cancellable(
                    grid,
                    [0],
                    max_sols,
                    set(),
                    cancel_event=self.cancel_event,
                )


def _serialize_thread_root(grid: Grid) -> bytes:
    """Serialize the source-owner graph the way the process executor does."""
    scope = (
        grid._extension_sandbox()
        if _requires_source_isolation(grid)
        else nullcontext()
    )
    with scope, worker_serialization():
        return pickle.dumps(grid, protocol=pickle.HIGHEST_PROTOCOL)


def solve_thread_trials(
    grid: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    workers: int,
) -> set[ImmutableGrid]:
    """Solve top-level branches concurrently and consume them in order.

    Submission is bounded to one outstanding branch per worker. Results are
    consumed in deterministic branch order, matching the process executor,
    and an unlimited solve observes a later sibling's failure as soon as it
    happens rather than after the first branch finishes. Once a positive
    solution cap is reached, queued work is cancelled and running siblings
    observe ``cancel_event`` between search frames.
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
    worker_payload = _serialize_thread_root(grid)
    runner = _ThreadBranchRunner(
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
            if max_sols == -1:
                _wait_for_uncapped_result(future, futures)
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
