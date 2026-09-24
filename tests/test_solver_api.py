import pickle
import sys
from concurrent.futures import Future

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver import solve_parallel as parallel_module
from gridsolver.solver import solver


class _StatefulGrid(Grid):
    def __init__(self):
        super().__init__(2)
        self.metadata = {"labels": ["original"]}

    def _copy_extra_state_to(self, result):
        result.metadata = {
            "labels": list(self.metadata["labels"]),
        }


def test_solve_does_not_mark_or_mutate_the_caller_grid():
    grid = Grid(1)
    original_candidates = tuple(possible.copy() for possible in grid._candidates)

    solutions = solver.solve(grid, log_level=0)

    assert len(solutions) == 1
    assert not grid.has_been_filled
    assert grid.known == (0,)
    assert grid._candidates == original_candidates

    grid.load("1")
    assert grid.known == (1,)


def test_deepcopy_hook_detaches_subclass_owned_state():
    grid = _StatefulGrid()
    clone = grid.deepcopy()

    assert type(clone) is _StatefulGrid
    assert clone.metadata == grid.metadata
    assert clone.metadata is not grid.metadata
    assert clone.metadata["labels"] is not grid.metadata["labels"]

    clone.metadata["labels"].append("clone")
    assert grid.metadata == {"labels": ["original"]}


def test_parallel_workers_receive_a_cache_free_root_seed(monkeypatch):
    grid = Grid(1, 1, max_elem=2)
    captured = {}

    def fake_atomic(self):
        self.grid._struct_cache["large"] = object()
        self.grid._guarantee_cache["large"] = object()
        self.grid._fish_value_memo = {"large": object()}
        return SolveStatus.NONE

    def fake_parallel(seed, branches, max_sols, processes):
        captured.update(
            seed=seed,
            branches=branches,
            max_sols=max_sols,
            processes=processes,
        )
        return set()

    monkeypatch.setattr(solver.AtomicSolver, "solve_atomic", fake_atomic)
    monkeypatch.setattr(
        parallel_module,
        "solve_parallel_trials",
        fake_parallel,
    )

    assert solver._solve_top_parallel(grid, 3, 2) == set()

    # The solver-owned grid goes to the executor without another clone;
    # worker_serialization() keeps the root pass caches out of the payload.
    assert captured["seed"] is grid
    seed = pickle.loads(parallel_module._serialize_worker_root(grid))
    assert seed.known == grid.known
    assert tuple(map(set, seed._candidates)) == tuple(map(set, grid._candidates))
    assert seed.rules == grid.rules
    assert seed.guarantees == grid.guarantees
    assert seed._struct_cache == {}
    assert seed._guarantee_cache == {}
    assert not hasattr(seed, "_fish_value_memo")
    assert captured["branches"] == [(0, 1), (0, 2)]
    assert captured["max_sols"] == 3
    assert captured["processes"] == 2
    assert grid._struct_cache
    assert grid._guarantee_cache
    assert hasattr(grid, "_fish_value_memo")


def test_worker_root_creates_isolated_branch_grids(monkeypatch):
    monkeypatch.setattr(parallel_module, "_WORKER_ROOT_GRID", None)
    root = Grid(1, 1, max_elem=2)
    parallel_module._init_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )

    first = parallel_module._fresh_worker_grid()
    second = parallel_module._fresh_worker_grid()

    assert first is not second
    assert first is not parallel_module._WORKER_ROOT_GRID
    assert second is not parallel_module._WORKER_ROOT_GRID
    first.get_candidates(0).discard(2)
    assert second.get_candidates(0) == {1, 2}
    assert parallel_module._WORKER_ROOT_GRID.get_candidates(0) == {1, 2}

    first_solutions = parallel_module._solve_branch((0, 1, 1))
    second_solutions = parallel_module._solve_branch((0, 2, 1))
    assert {tuple(solution) for solution in first_solutions} == {(1,)}
    assert {tuple(solution) for solution in second_solutions} == {(2,)}
    assert parallel_module._WORKER_ROOT_GRID.known == (0,)


class _FakeFuture(Future):
    def __init__(self, result):
        super().__init__()
        self.set_result(result)
        self._result = result
        self.cancelled = False

    def result(self):
        return self._result

    def cancel(self):
        self.cancelled = True
        return True


class _FakeProcessPool:
    def __init__(self, results):
        self._results = iter(results)
        self.futures = []
        self.payloads = []
        self.max_workers = None
        self.initializer = None
        self.initargs = ()
        self.terminated = False
        self.exited = False

    def configure(self, *, max_workers, initializer, initargs):
        self.max_workers = max_workers
        self.initializer = initializer
        self.initargs = initargs
        initializer(*initargs)
        return self

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.exited = True

    def submit(self, worker, payload):
        self.payloads.append(payload)
        future = _FakeFuture(next(self._results))
        self.futures.append(future)
        return future

    def terminate_workers(self):
        self.terminated = True


def _install_fake_pool(monkeypatch, pool):
    monkeypatch.setattr(parallel_module, "_WORKER_ROOT_GRID", None)
    monkeypatch.setattr(
        parallel_module.concurrent.futures,
        "ProcessPoolExecutor",
        lambda **kwargs: pool.configure(**kwargs),
    )


def _assert_compact_worker_payloads(pool):
    assert pool.max_workers == 2
    assert pool.initializer is parallel_module._init_worker
    assert len(pool.initargs) == 1
    assert isinstance(pool.initargs[0], bytes)
    assert all(len(payload) == 3 for payload in pool.payloads)
    assert all(
        not any(isinstance(item, Grid) for item in payload)
        for payload in pool.payloads
    )


def test_capped_parallel_search_bounds_submissions_and_terminates(monkeypatch):
    pool = _FakeProcessPool(
        ({"first"}, {"second"}, {"third"}, {"fourth"}, {"fifth"})
    )
    _install_fake_pool(monkeypatch, pool)

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=5),
        [(0, value) for value in range(1, 6)],
        max_sols=1,
        processes=2,
    )

    assert result == {"first"}
    assert len(pool.futures) == 2
    assert pool.terminated
    assert pool.exited
    assert pool.futures[1].cancelled
    _assert_compact_worker_payloads(pool)


def test_capped_parallel_search_does_not_scan_later_branches_for_global_minimum(
    monkeypatch,
):
    earlier_branch_solution = ImmutableGrid(
        [2],
        rows=1,
        cols=1,
        max_elem=2,
    )
    later_smaller_solution = ImmutableGrid(
        [1],
        rows=1,
        cols=1,
        max_elem=2,
    )
    assert (
        solver._solution_key(later_smaller_solution)
        < solver._solution_key(earlier_branch_solution)
    )
    pool = _FakeProcessPool(
        ({earlier_branch_solution}, {later_smaller_solution})
    )
    _install_fake_pool(monkeypatch, pool)

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=2),
        [(0, 2), (0, 1)],
        max_sols=1,
        processes=2,
    )

    assert result == {earlier_branch_solution}
    assert pool.payloads == [(0, 1, 1), (0, 2, 1)]
    assert pool.futures[1].cancelled
    _assert_compact_worker_payloads(pool)


def test_unlimited_parallel_search_replenishes_all_branches(monkeypatch):
    pool = _FakeProcessPool(
        ({"first"}, {"second"}, {"third"}, {"fourth"}, {"fifth"})
    )
    _install_fake_pool(monkeypatch, pool)

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=5),
        [(0, value) for value in range(1, 6)],
        max_sols=-1,
        processes=2,
    )

    assert result == {"first", "second", "third", "fourth", "fifth"}
    assert len(pool.futures) == 5
    assert not pool.terminated
    assert pool.exited
    assert not any(future.cancelled for future in pool.futures)
    _assert_compact_worker_payloads(pool)


def test_pool_size_is_one_worker_per_branch_within_the_platform_limit():
    assert parallel_module.pool_size(100, 3, platform="linux") == 3
    assert parallel_module.pool_size(2, 50, platform="linux") == 2
    assert parallel_module.pool_size(100, 1000, platform="linux") == 100
    assert parallel_module.pool_size(4, 0, platform="linux") == 1
    # ProcessPoolExecutor refuses more than 61 workers on Windows.
    assert parallel_module.pool_size(100, 1000, platform="win32") == 61
    assert parallel_module.pool_size(100, 5, platform="win32") == 5


def test_parallel_pool_never_exceeds_the_branches_or_the_platform_limit(monkeypatch):
    pool = _FakeProcessPool([{f"branch-{value}"} for value in range(1, 101)])
    _install_fake_pool(monkeypatch, pool)

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=100),
        [(0, value) for value in range(1, 101)],
        max_sols=1,
        processes=500,
    )

    assert result == {"branch-1"}
    assert pool.max_workers == (61 if sys.platform == "win32" else 100)
    assert len(pool.futures) == pool.max_workers

    few = _FakeProcessPool(({"first"}, {"second"}, {"third"}))
    _install_fake_pool(monkeypatch, few)
    parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=3),
        [(0, value) for value in range(1, 4)],
        max_sols=-1,
        processes=500,
    )
    assert few.max_workers == 3


def test_more_processes_than_the_platform_allows_still_solve():
    # Real workers: before the clamp, 100 processes raised ValueError on
    # Windows after the root pass. Two branches start two workers whatever N.
    grid = Grid(1, 2, max_elem=2)
    expected = solver.solve(grid, log_level=solver.QUIET)
    assert len(expected) == 4
    assert solver.solve(grid, processes=100, log_level=solver.QUIET) == expected


@pytest.mark.parametrize("max_sols", (-1, 0))
def test_solve_rejects_non_grid_inputs_even_for_an_empty_result_cap(max_sols):
    with pytest.raises(TypeError, match="grid must be a Grid instance"):
        solver.solve(object(), max_sols=max_sols)


def test_capped_search_does_not_undercount_overlapping_guarantee_branches():
    # regression: guarantee-derived branches overlap (one solution can
    # satisfy several), and per-branch remainders were consumed by
    # duplicates, so a capped solve returned 9 of 15 existing solutions
    grid = Grid(1, 3, max_elem=3)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), grid.rows, grid.cols)
    )

    exhaustive = solver.solve(grid, max_sols=-1, log_level=solver.QUIET)
    capped = solver.solve(grid, max_sols=10, log_level=solver.QUIET)

    assert len(exhaustive) == 15
    assert len(capped) == 10
    assert capped <= exhaustive
