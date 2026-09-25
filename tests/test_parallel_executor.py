"""The process-pool executor: failures, termination, ordering and start methods.

A later branch's failure is observed without waiting for the first branch,
errors terminate the pool before its context exits and are never masked by
cleanup, capped prefixes ignore failures they do not need, results keep
their consumption order, and capped subsets are deterministic across
process modes. The real-process checks run parallel_failure_probe.py.
"""

import multiprocessing
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import Future
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solve_parallel as parallel, solver


def test_later_failure_is_observed_before_first_branch_finishes():
    first, second = Future(), Future()
    failure = RuntimeError("later branch failed")
    observed = []
    finished = threading.Event()
    def consume():
        try:
            parallel._wait_for_uncapped_result(first, (second,))
        except BaseException as exc:
            observed.append(exc)
        finally:
            finished.set()
    thread = threading.Thread(target=consume)
    thread.start()
    try:
        second.set_exception(failure)
        assert finished.wait(3), "Observer waited for unrelated first branch"
        assert observed == [failure]
        assert not first.done()
    finally:
        first.set_result(set())
        thread.join(3)


def test_successful_later_result_does_not_change_consumption_order():
    first, second = Future(), Future()
    second.set_result({"later"})
    finished = threading.Event()
    def consume():
        parallel._wait_for_uncapped_result(first, (second,))
        finished.set()
    thread = threading.Thread(target=consume)
    thread.start()
    try:
        assert not finished.wait(.05)
        first.set_result({"first"})
        assert finished.wait(3)
    finally:
        if not first.done():
            first.set_result(set())
        thread.join(3)


def test_capped_prefix_ignores_unneeded_later_failure(monkeypatch):
    class Pool:
        count = 0
        terminated = False
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def submit(self, *args):
            self.count += 1
            future = Future()
            if self.count == 1:
                future.set_result({"first"})
            else:
                future.set_exception(RuntimeError("unneeded later failure"))
            return future
        def terminate_workers(self): self.terminated = True
    pool = Pool()
    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kw: pool)
    assert parallel.solve_parallel_trials(Grid(1, 1, 2), [(0, 1), (0, 2)], 1, 2) == {"first"}
    assert pool.terminated


@pytest.mark.parametrize("method", [m for m in ("spawn", "forkserver") if m in multiprocessing.get_all_start_methods()])
def test_real_later_failure_terminates_slow_first_branch(method, tmp_path):
    env = dict(os.environ, GRIDPUZZLE_FAILURE_PROBE=str(tmp_path), GRIDPUZZLE_FAILING_VALUE="2", GRIDPUZZLE_PROBE_CAP="-1")
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("parallel_failure_probe.py")), method], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
        # Starting the workers can take long on a loaded runner or under
        # coverage, so the window opens once the slow first branch runs: from
        # then on it blocks for a minute unless the failure terminates it.
        deadline = time.monotonic() + 120
        while not (tmp_path / "started").exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            (tmp_path / "release").touch()
            process.kill()
            stdout, stderr = process.communicate(timeout=10)
            pytest.fail(f"Later failure remained hidden: {stdout} {stderr}")
        assert process.returncode == 0, stdout + stderr
        assert "original error preserved; no live workers" in stdout
    finally:
        (tmp_path / "release").touch()
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


@pytest.mark.parametrize("phase", ("initial_submit", "refill_submit", "result", "stats", "interrupt"))
def test_parallel_errors_terminate_before_context_exit(monkeypatch, phase):
    monkeypatch.setattr(parallel, "_wait_for_uncapped_result", lambda *args: None)
    failure = KeyboardInterrupt() if phase == "interrupt" else RuntimeError("original failure")
    events = []

    class Future:
        def result(self):
            if phase in {"result", "interrupt"}:
                raise failure
            return (set(), object()) if phase == "stats" else set()

        def cancel(self):
            events.append("cancel")
            return True

    class Pool:
        submitted = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            events.append("exit")
            assert "terminate" in events

        def submit(self, *args):
            self.submitted += 1
            if (phase == "initial_submit" and self.submitted == 2) or (
                phase == "refill_submit" and self.submitted == 3
            ):
                raise failure
            return Future()

        def terminate_workers(self):
            events.append("terminate")

    class Stats:
        def merge(self, other):
            raise failure

    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kwargs: Pool())
    monkeypatch.setattr(parallel, "current_power_stats", lambda: Stats() if phase == "stats" else None)
    with pytest.raises(type(failure)) as caught:
        parallel.solve_parallel_trials(Grid(1, 1, 3), [(0, 1), (0, 2), (0, 3)], -1, 2)
    assert caught.value is failure
    assert events == ["cancel", "terminate", "exit"]


def test_parallel_cleanup_does_not_mask_original_error(monkeypatch):
    monkeypatch.setattr(parallel, "_wait_for_uncapped_result", lambda *args: None)
    failure = RuntimeError("branch failed")

    class Future:
        def result(self):
            raise failure

        def cancel(self):
            raise OSError("cancel failed")

    class Pool:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def submit(self, *args):
            return Future()

        def terminate_workers(self):
            raise OSError("terminate failed")

    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kwargs: Pool())
    with pytest.raises(RuntimeError) as caught:
        parallel.solve_parallel_trials(Grid(1, 1, 2), [(0, 1), (0, 2)], -1, 2)
    assert caught.value is failure
    assert len(failure.__notes__) == 2


@pytest.mark.parametrize(
    "start_method",
    [method for method in ("spawn", "forkserver") if method in multiprocessing.get_all_start_methods()],
)
def test_real_parallel_error_stops_running_sibling(start_method, tmp_path):
    script = Path(__file__).with_name("parallel_failure_probe.py")
    env = os.environ.copy()
    env["GRIDPUZZLE_FAILURE_PROBE"] = str(tmp_path)
    process = subprocess.Popen(
        [sys.executable, str(script), start_method],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    try:
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            (tmp_path / "release").touch()
            process.kill()
            stdout, stderr = process.communicate(timeout=10)
            pytest.fail(f"Parallel error waited for its sibling: {stdout}\n{stderr}")
        assert process.returncode == 0, stdout + stderr
        assert "original error preserved; no live workers" in stdout
    finally:
        (tmp_path / "release").touch()
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)


def test_parallel_trials_work_with_python_314_start_methods():
    puzzle = "12344321........"
    sequential = Sudoku(2, 2, 2, 2)
    sequential.load(puzzle)
    parallel = Sudoku(2, 2, 2, 2)
    parallel.load(puzzle)

    sequential_solutions = solver.solve(sequential, log_level=0)
    parallel_solutions = solver.solve(parallel, log_level=0, processes=2)

    assert len(sequential_solutions) == 4
    assert sequential_solutions == parallel_solutions


def _small_sudoku() -> Sudoku:
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")
    return grid


def test_capped_solution_subset_is_deterministic_across_process_modes():
    first = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    second = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    parallel = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        processes=2,
    )
    assert len(first) == 2
    assert first == second == parallel
