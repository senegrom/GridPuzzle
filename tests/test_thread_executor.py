from __future__ import annotations

import concurrent.futures
import contextvars
import logging
import pickle
import sys
import sysconfig
import threading
from itertools import product

import pytest

from gridsolver.abstract_grids.csp_rules_loading import create_from_csp_rules
from gridsolver.abstract_grids.grid import Grid, TechniqueProfile, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.solver import solve_threaded, solver


def _small_sudoku() -> Sudoku:
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")
    return grid


def test_free_threaded_runtime_detection_checks_build_and_live_gil(monkeypatch):
    monkeypatch.setattr(sysconfig, "get_config_var", lambda name: 0)
    assert not solver.free_threaded_runtime_available()

    monkeypatch.setattr(sysconfig, "get_config_var", lambda name: 1)
    monkeypatch.setattr(sys, "_is_gil_enabled", lambda: True, raising=False)
    assert not solver.free_threaded_runtime_available()

    monkeypatch.setattr(sys, "_is_gil_enabled", lambda: False)
    assert solver.free_threaded_runtime_available()


def test_thread_backend_validation_is_explicit(monkeypatch):
    with pytest.raises(TypeError, match="parallel_backend"):
        solver.solve(Grid(1), parallel_backend=True)
    with pytest.raises(ValueError, match="parallel_backend"):
        solver.solve(Grid(1), parallel_backend="auto")
    with pytest.raises(ValueError, match="requires processes > 1"):
        solver.solve(Grid(1), processes=1, parallel_backend="thread")

    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: False)
    with pytest.raises(RuntimeError, match="free-threaded Python"):
        solver.solve(Grid(1), processes=2, parallel_backend="thread")


def test_default_recursive_search_has_no_thread_cancellation_parameter():
    import inspect

    assert "cancel_event" not in inspect.signature(solver._solve_full).parameters


def test_thread_backend_matches_sequential_and_process(monkeypatch):
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)

    sequential = solver.solve(_small_sudoku(), log_level=0)
    process = solver.solve(_small_sudoku(), log_level=0, processes=2)
    thread_input = _small_sudoku()
    original_known = thread_input.known
    original_candidates = tuple(
        possible.copy() for possible in thread_input._candidates
    )
    threaded = solver.solve(
        thread_input,
        log_level=0,
        processes=2,
        parallel_backend="thread",
    )

    assert len(sequential) == 4
    assert threaded == process == sequential
    assert thread_input.known == original_known
    assert thread_input._candidates == original_candidates


def test_thread_backend_preserves_deterministic_positive_cap(monkeypatch):
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)

    sequential = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    threaded = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        processes=2,
        parallel_backend="thread",
    )

    assert len(threaded) == 2
    assert threaded == sequential


def _overlapping_guarantee_grid() -> Grid:
    grid = Grid(1, 3, max_elem=3)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), grid.rows, grid.cols)
    )
    return grid


def test_capped_thread_solve_does_not_undercount_overlapping_guarantees(
    monkeypatch,
):
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)

    full = solver.solve(_overlapping_guarantee_grid(), log_level=0)
    threaded = solver.solve(
        _overlapping_guarantee_grid(),
        log_level=0,
        max_sols=10,
        processes=2,
        parallel_backend="thread",
    )

    assert len(full) == 15
    assert len(threaded) == 10
    assert threaded <= full


def test_cancellable_driver_matches_the_sequential_capped_subset():
    # The cancellable driver must keep sequential capped semantics: disjoint
    # cell-value branches under a positive cap, so per-branch remainders are
    # never consumed by overlapping-guarantee duplicates. Calling it directly
    # pins the driver itself, which top-level full-cap-per-branch consumption
    # would otherwise mask.
    sequential = solver.solve(
        _overlapping_guarantee_grid(),
        log_level=0,
        max_sols=10,
    )

    mirrored = solve_threaded._solve_full_cancellable(
        _overlapping_guarantee_grid(),
        [],
        10,
        set(),
        cancel_event=threading.Event(),
    )

    assert len(mirrored) == 10
    assert mirrored == sequential


def test_thread_root_avoids_a_redundant_full_grid_clone(monkeypatch):
    grid = Grid(1, 1, max_elem=2)
    captured = {}
    clone_calls = 0
    original_deepcopy = Grid.deepcopy

    def fake_atomic(self):
        return SolveStatus.NONE

    def counted_deepcopy(self):
        nonlocal clone_calls
        clone_calls += 1
        return original_deepcopy(self)

    def fake_thread_trials(
        root,
        branches,
        max_sols,
        workers,
    ):
        captured.update(
            root=root,
            branches=branches,
            max_sols=max_sols,
            workers=workers,
        )
        return set()

    monkeypatch.setattr(solver.AtomicSolver, "solve_atomic", fake_atomic)
    monkeypatch.setattr(Grid, "deepcopy", counted_deepcopy)
    monkeypatch.setattr(
        solve_threaded,
        "solve_thread_trials",
        fake_thread_trials,
    )

    assert solver._solve_top_threaded(
        grid,
        3,
        2,
    ) == set()
    assert clone_calls == 0
    assert captured == {
        "root": grid,
        "branches": [(0, 1), (0, 2)],
        "max_sols": 3,
        "workers": 2,
    }


def test_thread_root_serialisation_strips_derived_caches(monkeypatch):
    grid = Grid(1, 1, max_elem=1)
    grid._struct_cache["large"] = object()
    grid._rule_cache["large"] = object()
    grid._guarantee_cache["large"] = object()
    grid._fish_value_memo = object()
    grid._house_sums_memo = object()
    captured = {}
    original_dumps = pickle.dumps

    def capture_dumps(root, *, protocol):
        payload = original_dumps(root, protocol=protocol)
        worker_root = pickle.loads(payload)
        captured["root"] = root
        captured["protocol"] = protocol
        captured["struct_cache"] = dict(worker_root._struct_cache)
        captured["rule_cache"] = dict(worker_root._rule_cache)
        captured["guarantee_cache"] = dict(worker_root._guarantee_cache)
        captured["has_fish_memo"] = hasattr(worker_root, "_fish_value_memo")
        captured["has_house_memo"] = hasattr(worker_root, "_house_sums_memo")
        return payload

    pool = _FakeThreadPool((set(),))
    monkeypatch.setattr(pickle, "dumps", capture_dumps)
    monkeypatch.setattr(
        solve_threaded.concurrent.futures,
        "ThreadPoolExecutor",
        lambda **kwargs: pool.configure(**kwargs),
    )

    assert solve_threaded.solve_thread_trials(
        grid,
        [(0, 1)],
        max_sols=-1,
        workers=2,
    ) == set()
    assert captured == {
        "root": grid,
        "protocol": pickle.HIGHEST_PROTOCOL,
        "struct_cache": {},
        "rule_cache": {},
        "guarantee_cache": {},
        "has_fish_memo": False,
        "has_house_memo": False,
    }
    # Worker serialisation drops them; the solver-owned root is not stripped.
    assert grid._struct_cache and hasattr(grid, "_fish_value_memo")


def test_thread_branch_runner_uses_a_fresh_grid_per_task(monkeypatch):
    root = Grid(1, 1, max_elem=2)
    solve_threaded._init_thread_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )
    worker_root = solve_threaded._THREAD_STATE.root
    clone_calls = 0
    # Keep the objects alive as well as recording their IDs. Retaining the
    # references prevents allocator ID reuse from making this identity check
    # flaky after the first task returns.
    worker_grids: list[Grid] = []
    worker_refs: list[Grid] = []
    original_deepcopy = Grid.deepcopy

    def counted_deepcopy(self):
        nonlocal clone_calls
        if self is worker_root:
            clone_calls += 1
        return original_deepcopy(self)

    def fake_solve_full(
        grid,
        steps,
        max_sols,
        hidden_pair_checked_gts,
        *,
        cancel_event,
    ):
        worker_grids.append(grid)
        worker_refs.append(grid)
        return {
            ImmutableGrid(
                grid.known,
                grid.rows,
                grid.cols,
                grid.max_elem,
            )
        }

    monkeypatch.setattr(Grid, "deepcopy", counted_deepcopy)
    monkeypatch.setattr(
        solve_threaded, "_solve_full_cancellable", fake_solve_full
    )
    runner = solve_threaded._ThreadBranchRunner(
        threading.Event(),
        False,
    )

    first = runner((0, 1, 1))
    second = runner((0, 2, 1))

    assert clone_calls == 2
    assert worker_grids[0] is not worker_grids[1]
    assert worker_refs[0] is not worker_refs[1]
    assert {tuple(solution) for solution in first} == {(1,)}
    assert {tuple(solution) for solution in second} == {(2,)}
    assert root.known == (0,)
    assert root.get_candidates(0) == {1, 2}


def test_thread_branch_exception_does_not_poison_later_tasks(monkeypatch):
    root = Grid(1, 1, max_elem=2)
    solve_threaded._init_thread_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )
    calls = 0

    def fail_then_succeed(grid, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("branch failed")
        return {
            ImmutableGrid(
                grid.known,
                grid.rows,
                grid.cols,
                grid.max_elem,
            )
        }

    monkeypatch.setattr(
        solve_threaded, "_solve_full_cancellable", fail_then_succeed
    )
    runner = solve_threaded._ThreadBranchRunner(
        threading.Event(),
        False,
    )

    with pytest.raises(RuntimeError, match="branch failed"):
        runner((0, 2, 1))

    assert {tuple(solution) for solution in runner((0, 1, 1))} == {(1,)}
    assert root.known == (0,)
    assert root.get_candidates(0) == {1, 2}


def test_thread_worker_requires_an_initialised_private_root(monkeypatch):
    state = threading.local()
    monkeypatch.setattr(solve_threaded, "_THREAD_STATE", state)

    with pytest.raises(RuntimeError, match="not initialised"):
        solve_threaded._fresh_thread_grid()
    with pytest.raises(TypeError, match="did not contain a Grid"):
        solve_threaded._init_thread_worker(pickle.dumps("not a grid"))


def test_thread_workers_unpickle_disjoint_rule_graphs():
    root = _small_sudoku()
    original_rule_ids = {id(rule) for rule in root.rules}
    payload = pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    barrier = threading.Barrier(2)

    def probe_worker_graph():
        barrier.wait(timeout=5)
        worker_root = solve_threaded._THREAD_STATE.root
        return id(worker_root), frozenset(id(rule) for rule in worker_root.rules)

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=2,
        initializer=solve_threaded._init_thread_worker,
        initargs=(payload,),
    ) as pool:
        first = pool.submit(probe_worker_graph)
        second = pool.submit(probe_worker_graph)
        first_root_id, first_rule_ids = first.result(timeout=10)
        second_root_id, second_rule_ids = second.result(timeout=10)

    assert first_root_id != second_root_id
    assert first_rule_ids.isdisjoint(second_rule_ids)
    assert first_rule_ids.isdisjoint(original_rule_ids)
    assert second_rule_ids.isdisjoint(original_rule_ids)


def test_thread_branch_statistics_merge_in_parent_context(monkeypatch):
    from gridsolver.solver.atomic_solver import (
        collect_power_stats,
        current_power_stats,
    )

    def record_stat(*args, **kwargs):
        stats = current_power_stats()
        assert stats is not None
        stats.tries["thread-test"] += 1
        return set()

    monkeypatch.setattr(
        solve_threaded, "_solve_full_cancellable", record_stat
    )
    with collect_power_stats() as parent_stats:
        solve_threaded.solve_thread_trials(
            Grid(1, 1, max_elem=3),
            [(0, 1), (0, 2), (0, 3)],
            max_sols=-1,
            workers=2,
        )

    assert parent_stats.tries["thread-test"] == 3


def test_cancellable_driver_obeys_a_pre_set_cancellation_event():
    grid = Grid(1, 1, max_elem=2)
    steps: list[int] = []
    event = threading.Event()
    event.set()

    assert solve_threaded._solve_full_cancellable(
        grid,
        steps,
        1,
        set(),
        cancel_event=event,
    ) == set()
    assert steps == []
    assert grid.known == (0,)
    assert grid.get_candidates(0) == {1, 2}


class _FakeFuture(concurrent.futures.Future):
    """A finished future that records cancellation requests.

    A real Future, because the uncapped observer waits on futures with
    concurrent.futures.wait, which reads their internal state.
    """

    def __init__(self, result):
        super().__init__()
        self.set_result(result)
        self.cancel_requested = False

    def cancel(self):
        self.cancel_requested = True
        return True


class _FakeThreadPool:
    def __init__(self, results):
        self._results = iter(results)
        self.futures = []
        self.payloads = []
        self.runner = None
        self.max_workers = None
        self.thread_name_prefix = None
        self.initializer = None
        self.initargs = None
        self.shutdown_args = None

    def configure(
        self,
        *,
        max_workers,
        thread_name_prefix,
        initializer,
        initargs,
    ):
        self.max_workers = max_workers
        self.thread_name_prefix = thread_name_prefix
        self.initializer = initializer
        self.initargs = initargs
        return self

    def submit(self, runner, payload):
        self.runner = runner
        self.payloads.append(payload)
        item = next(self._results)
        # A test may hand over a real, possibly pending, future directly.
        future = item if isinstance(item, concurrent.futures.Future) else _FakeFuture(item)
        self.futures.append(future)
        return future

    def shutdown(self, *, wait, cancel_futures):
        self.shutdown_args = (wait, cancel_futures)


def test_capped_thread_search_bounds_work_and_signals_cancellation(monkeypatch):
    pool = _FakeThreadPool(
        ({"first"}, {"second"}, {"third"}, {"fourth"})
    )
    monkeypatch.setattr(
        solve_threaded.concurrent.futures,
        "ThreadPoolExecutor",
        lambda **kwargs: pool.configure(**kwargs),
    )

    result = solve_threaded.solve_thread_trials(
        Grid(1, 1, max_elem=4),
        [(0, value) for value in range(1, 5)],
        max_sols=1,
        workers=2,
    )

    assert result == {"first"}
    assert len(pool.futures) == 2
    assert pool.futures[1].cancel_requested
    assert pool.runner.cancel_event.is_set()
    assert pool.shutdown_args == (True, True)
    assert pool.max_workers == 2
    assert pool.thread_name_prefix == "gridpuzzle"
    assert pool.initializer is solve_threaded._init_thread_worker
    assert isinstance(pool.initargs[0], bytes)


def test_thread_worker_logging_is_context_locally_muted(monkeypatch, caplog):
    root = Grid(1, 1, max_elem=1)
    caplog.set_level(logging.DEBUG)

    def noisy_solve_full(*args, **kwargs):
        solver._lg.logs(0, "thread noise")
        return set()

    monkeypatch.setattr(
        solve_threaded, "_solve_full_cancellable", noisy_solve_full
    )
    solve_threaded._init_thread_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )
    runner = solve_threaded._ThreadBranchRunner(
        threading.Event(),
        False,
    )

    runner((0, 1, 1))

    assert "thread noise" not in caplog.text


class _BinaryGrid(Grid):
    technique_profile = TechniqueProfile.RULES_ONLY


def test_thread_search_is_stack_safe_on_a_deep_decision_chain(monkeypatch):
    # 1024 binary decisions exceed the default recursion limit. The default
    # driver is an explicit stack of suspended frames; the cancellable driver
    # must be the same kind of thing, not a recursive mirror of it.
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)
    threaded = solver.solve(
        _BinaryGrid(1, 1024, max_elem=2),
        max_sols=2,
        log_level=solver.QUIET,
        processes=2,
        parallel_backend="thread",
    )
    # The first two solutions in branch order, as the sequential search
    # returns them (tests/test_stack_safe_search.py pins that set).
    assert {tuple(solution) for solution in threaded} == {
        (1,) * 1024,
        (1,) * 1023 + (2,),
    }


def _family_boards():
    from gridsolver.grid_classes.futoshiki import Futoshiki
    from gridsolver.grid_classes.kakuro import Kakuro
    from gridsolver.grid_classes.kenken import Kenken, _CellTuple
    from gridsolver.grid_classes.killer_sudoku import KillerSudoku
    from gridsolver.grid_classes.slitherlink import Slitherlink
    from gridsolver.grid_classes.str8ts import Str8ts

    white = tuple(product(range(2), repeat=2))
    runs = (
        (3, ((0, 0), (0, 1))),
        (3, ((1, 0), (1, 1))),
        (3, ((0, 0), (1, 0))),
        (3, ((0, 1), (1, 1))),
    )
    # Every board has at least two solutions, so the search branches and the
    # thread pool does real work rather than returning a settled grid.
    return {
        "futoshiki": lambda: Futoshiki(3),
        "kenken": lambda: Kenken([_CellTuple(3, [(0, 0), (0, 1)], "+")], n=3),
        "killer": lambda: KillerSudoku(None, 1, 2, 2, 1),
        "kakuro": lambda: Kakuro(2, 2, white, runs),
        "slitherlink": lambda: Slitherlink(((None, None), (None, None))),
        "str8ts": lambda: Str8ts(3, black={(1, 1)}),
        "numbrix": lambda: create_from_csp_rules("(solve Numbrix topological 2 4\n1 .\n. .\n)"),
        "hidato": lambda: create_from_csp_rules("(solve Hidato topological 2 4\n1 .\n. .\n)"),
    }


@pytest.mark.parametrize("family", sorted(_family_boards()))
def test_thread_backend_matches_sequential_per_family(family, monkeypatch):
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)
    board = _family_boards()[family]
    sequential = solver.solve(board(), log_level=solver.QUIET)
    threaded = solver.solve(board(), log_level=solver.QUIET, processes=2, parallel_backend="thread")
    assert len(sequential) >= 2, "the board must branch for the pool to matter"
    assert threaded == sequential


def test_concurrent_thread_solves_keep_their_roots_private(monkeypatch):
    from gridsolver.grid_classes.futoshiki import Futoshiki

    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)
    expected = solver.solve(Futoshiki(3), log_level=solver.QUIET)

    def threaded(_):
        return solver.solve(Futoshiki(3), log_level=solver.QUIET, processes=2, parallel_backend="thread")

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(threaded, range(3)))
    assert results == [expected] * 3


def test_thread_tasks_enter_the_process_executor_isolation_scopes(monkeypatch):
    """Structural parity with solve_parallel: sandbox around the clone,
    source protection around each task, serialization scopes around pickle."""
    from contextlib import contextmanager

    events = []

    @contextmanager
    def record(name):
        events.append(f"enter {name}")
        try:
            yield
        finally:
            events.append(f"exit {name}")

    monkeypatch.setattr(solve_threaded, "_requires_source_isolation", lambda grid: True)
    monkeypatch.setattr(solve_threaded, "protect_source", lambda root: record("protect"))
    monkeypatch.setattr(solve_threaded, "sandbox_sources", lambda: record("sandbox"))
    monkeypatch.setattr(solve_threaded, "worker_serialization", lambda: record("serialization"))
    monkeypatch.setattr(Grid, "_extension_sandbox", lambda self: record("extension-sandbox"))

    root = Grid(1, 1, max_elem=2)
    solve_threaded._serialize_thread_root(root)
    assert events == [
        "enter extension-sandbox", "enter serialization",
        "exit serialization", "exit extension-sandbox",
    ]

    events.clear()
    solve_threaded._init_thread_worker(pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL))
    runner = solve_threaded._ThreadBranchRunner(threading.Event(), False)
    assert {tuple(solution) for solution in runner((0, 1, -1))} == {(1,)}
    assert events[:3] == ["enter protect", "enter sandbox", "exit sandbox"]
    assert events[-1] == "exit protect"


def test_uncapped_thread_solve_reports_a_later_sibling_failure_promptly(monkeypatch):
    # The first branch never finishes; the second fails at once. An unlimited
    # solve needs every branch, so the failure must surface without waiting
    # for the first branch, exactly as the process executor behaves.
    never = concurrent.futures.Future()
    failed = concurrent.futures.Future()
    failed.set_exception(RuntimeError("branch failed"))
    pool = _FakeThreadPool((never, failed))
    monkeypatch.setattr(
        solve_threaded.concurrent.futures,
        "ThreadPoolExecutor",
        lambda **kwargs: pool.configure(**kwargs),
    )
    with pytest.raises(RuntimeError, match="branch failed"):
        solve_threaded.solve_thread_trials(
            Grid(1, 1, max_elem=2),
            [(0, 1), (0, 2)],
            max_sols=-1,
            workers=2,
        )
    # The running branch cannot be cancelled through its future; it is told
    # to stop through the shared event, and the pool is drained.
    assert pool.runner.cancel_event.is_set()
    assert pool.shutdown_args == (True, True)


@pytest.mark.skipif(
    not solver.free_threaded_runtime_available(),
    reason="needs a free-threaded build with the GIL disabled",
)
def test_thread_backend_runs_without_the_gil():
    # No monkeypatch here: this is the one test that proves the executor ran
    # on a real no-GIL interpreter, which only the free-threaded CI job has.
    assert not sys._is_gil_enabled()
    expected = solver.solve(_small_sudoku(), log_level=0)
    assert solver.solve(_small_sudoku(), log_level=0, processes=2, parallel_backend="thread") == expected


def test_thread_tasks_start_from_a_fresh_context(monkeypatch):
    # A free-threaded build starts new threads with a copy of the creating
    # thread's context (sys.flags.thread_inherit_context). A task must see
    # none of the caller's scopes, exactly like a worker process, or every
    # worker sandboxes the caller's grid at once. Inheriting threads are
    # forced here so the check does not depend on the interpreter build.
    monkeypatch.setattr(solver, "free_threaded_runtime_available", lambda: True)

    class InheritingThread(threading.Thread):
        def __init__(self, *args, **kwargs):
            kwargs.setdefault("context", contextvars.copy_context())
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(threading, "Thread", InheritingThread)
    caller_scope = contextvars.ContextVar("caller_scope", default=None)
    token = caller_scope.set("caller")
    seen = []
    fresh_grid = solve_threaded._fresh_thread_grid

    def observe():
        seen.append(caller_scope.get())
        return fresh_grid()

    monkeypatch.setattr(solve_threaded, "_fresh_thread_grid", observe)
    try:
        expected = solver.solve(_BinaryGrid(1, 8, max_elem=2), log_level=solver.QUIET)
        threaded = solver.solve(
            _BinaryGrid(1, 8, max_elem=2),
            log_level=solver.QUIET,
            processes=2,
            parallel_backend="thread",
        )
    finally:
        caller_scope.reset(token)
    assert threaded == expected
    assert seen and all(value is None for value in seen)
