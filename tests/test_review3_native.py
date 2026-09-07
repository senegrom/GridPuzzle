"""Exact partitions and independent completion/error observation regressions."""
from concurrent.futures import Future
from itertools import combinations_with_replacement
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import threading

import pytest

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce as Cage
from gridsolver.solver import solve_parallel as parallel


@pytest.mark.parametrize("maximum", range(1, 8))
def test_iterative_partitions_equal_complete_ordered_oracle(maximum):
    for count in range(1, 7):
        expected = {}
        for values in combinations_with_replacement(range(1, maximum + 1), count):
            expected.setdefault(sum(values), []).append(values)
        for target in range(count - 1, count * maximum + 2):
            assert Cage._partition_tuples(target, count, 1, maximum) == tuple(expected.get(target, ()))


@pytest.mark.parametrize("count", (1000, 2500))
def test_large_near_extreme_partition_has_no_recursion(count):
    assert Cage._partition_tuples(count + 1, count, 1, 2) == ((1,) * (count - 1) + (2,),)
    assert Cage._partition_tuples(2 * count - 1, count, 1, 2) == ((1,) + (2,) * (count - 1),)
    grid = GridSizeContainer(1, count, max_elem=count + 1)
    cage = Cage(grid, range(count), count * (count + 1) // 2 + 1)
    assert cage.sum_candidates == (frozenset((*range(1, count), count + 1)),)



def test_full_large_cage_matching_is_stack_safe():
    # One exact full-domain partition, but candidate edges form an
    # alternating cycle whose final augmenting path is longer than a
    # deliberately lowered recursion limit. The former recursive
    # matcher failed here even though partition generation was iterative.
    count = 400
    grid = GridSizeContainer(1, count, max_elem=count)
    cage = Cage(grid, range(count), count * (count + 1) // 2)
    values = cage.sum_candidates[0]
    order = list(values)
    candidates = tuple(
        [{order[0], order[-1]}]
        + [{order[index - 1], order[index]} for index in range(1, count)]
    )
    known = [0] * count

    original_limit = sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(250)
        changed, replacement_rules, guarantees = cage.apply(
            known,
            candidates,
            (),
        )
    finally:
        sys.setrecursionlimit(original_limit)

    assert changed is False
    assert replacement_rules is None
    assert len(guarantees) == count
    assert all(len(possible) == 2 for possible in candidates)

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
            if self.count == 1: future.set_result({"first"})
            else: future.set_exception(RuntimeError("unneeded later failure"))
            return future
        def terminate_workers(self): self.terminated = True
    pool = Pool()
    monkeypatch.setattr(parallel.concurrent.futures, "ProcessPoolExecutor", lambda **kw: pool)
    assert parallel.solve_parallel_trials(Grid(1, 1, 2), [(0, 1), (0, 2)], 1, 2) == {"first"}
    assert pool.terminated


@pytest.mark.parametrize("method", [m for m in ("spawn", "forkserver") if m in multiprocessing.get_all_start_methods()])
def test_real_later_failure_terminates_slow_first_branch(method, tmp_path):
    env = dict(os.environ, GRIDPUZZLE_FAILURE_PROBE=str(tmp_path), GRIDPUZZLE_FAILING_VALUE="2", GRIDPUZZLE_PROBE_CAP="-1")
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("review_parallel_probe.py")), method], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
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
