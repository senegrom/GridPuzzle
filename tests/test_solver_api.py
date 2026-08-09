import pickle

from gridsolver.abstract_grids.grid import Grid, SolveStatus
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

    seed = captured["seed"]
    assert seed is not grid
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


class _FakeFuture:
    def __init__(self, result):
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
