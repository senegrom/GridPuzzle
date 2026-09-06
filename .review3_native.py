"""One-shot, source-anchored implementation of review-three native fixes."""
from pathlib import Path

p = Path('gridsolver/rules/sumrules.py')
s = p.read_text()
a = s.index('        if maxi is None:', s.index('    def _partition_tuples('))
b = s.index('\n    @staticmethod\n    def partition2(', a)
s = s[:a] + '''        if maxi is None:
            maxi = n
        if maxi < mini or count <= 0 or not count * mini <= n <= count * maxi:
            return ()

        # Explicit lexicographic DFS. The old recursive call graph could exceed
        # Python's recursion limit even when a thousand-cell cage had ONE
        # admissible partition. Frames store only scalars; a single prefix is
        # reused instead of copying it at each depth. No partitions or matching
        # deductions are truncated, deferred or replaced by bounds-only logic.
        partitions: list[tuple[int, ...]] = []
        prefix: list[int] = []
        work = [(n, count, mini, 0)]
        while work:
            remaining, left, lower, depth = work.pop()
            if depth:
                prefix[depth - 1:] = [lower]
            if remaining == left * lower:
                partitions.append((*prefix, *((lower,) * left)))
                continue
            if remaining == left * maxi:
                partitions.append((*prefix, *((maxi,) * left)))
                continue
            if left == 1:
                partitions.append((*prefix, remaining))
                continue
            first = max(lower, remaining - (left - 1) * maxi)
            last = min(remaining // left, maxi)
            # Reverse pushes retain the former ascending recursion order.
            for value in range(last, first - 1, -1):
                work.append((remaining - value, left - 1, value, depth + 1))
        return tuple(partitions)
''' + s[b:]
p.write_text(s)

p = Path('gridsolver/solver/solve_parallel.py')
s = p.read_text()
anchor = '\ndef solve_parallel_trials('
assert s.count(anchor) == 1
s = s.replace(anchor, '''
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


def solve_parallel_trials(''')
s = s.replace('                future = futures.popleft()\n                result = future.result()', '                future = futures.popleft()\n                if max_sols == -1:\n                    _wait_for_uncapped_result(future, futures)\n                result = future.result()')
p.write_text(s)

# Existing test doubles for submission/cleanup are not completion schedulers.
# Keep those tests isolated; the new tests below exercise actual Future states
# and real spawned/forkserver workers, including the out-of-order failure.
p = Path('tests/test_solver_api.py')
s = p.read_text().replace('import pickle\n', 'import pickle\nfrom concurrent.futures import Future\n')
s = s.replace('class _FakeFuture:\n    def __init__(self, result):\n', 'class _FakeFuture(Future):\n    def __init__(self, result):\n        super().__init__()\n        self.set_result(result)\n')
p.write_text(s)
p = Path('tests/test_review_fixes.py')
s = p.read_text()
for signature in ('def test_parallel_errors_terminate_before_context_exit(monkeypatch, phase):', 'def test_parallel_cleanup_does_not_mask_original_error(monkeypatch):'):
    assert s.count(signature) == 1
    s = s.replace(signature, signature + '\n    monkeypatch.setattr(parallel, "_wait_for_uncapped_result", lambda *args: None)')
p.write_text(s)
p = Path('tests/review_parallel_probe.py')
s = p.read_text().replace('    if value == 1:', '    if value == int(os.environ.get("GRIDPUZZLE_FAILING_VALUE", "1")):')
s = s.replace('[(0, 1), (0, 2)], 1, 2)', '[(0, 1), (0, 2)], int(os.environ.get("GRIDPUZZLE_PROBE_CAP", "1")), 2)')
p.write_text(s)

Path('tests/test_review3_native.py').write_text('''"""Exact partitions and independent completion/error observation regressions."""
from concurrent.futures import Future
from itertools import combinations_with_replacement
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import threading

import pytest

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
    grid = Grid(1, count, max_elem=count + 1)
    cage = Cage(grid, range(count), count * (count + 1) // 2 + 1)
    assert cage.sum_candidates == (frozenset((*range(1, count), count + 1)),)


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
''')
print('Applied exact iterative partitions and uncapped error observation.')
