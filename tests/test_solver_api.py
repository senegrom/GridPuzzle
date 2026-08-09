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

    def fake_parallel(seed, branches, max_sols, processes, depth_gate=None):
        captured.update(
            seed=seed,
            branches=branches,
            max_sols=max_sols,
            processes=processes,
            depth_gate=depth_gate,
        )
        return set()

    monkeypatch.setattr(solver.AtomicSolver, "solve_atomic", fake_atomic)
    monkeypatch.setattr(
        parallel_module,
        "solve_parallel_trials",
        fake_parallel,
    )

    assert solver._solve_top_parallel(grid, 3, 2, 1) == set()

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
    assert captured["depth_gate"] == 1
    assert grid._struct_cache
    assert grid._guarantee_cache
    assert hasattr(grid, "_fish_value_memo")


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
        self.terminated = False
        self.exited = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.exited = True

    def submit(self, worker, payload):
        future = _FakeFuture(next(self._results))
        self.futures.append(future)
        return future

    def terminate_workers(self):
        self.terminated = True


def test_capped_parallel_search_terminates_unneeded_workers(monkeypatch):
    pool = _FakeProcessPool(({"first"}, {"second"}, {"third"}))
    monkeypatch.setattr(
        parallel_module.concurrent.futures,
        "ProcessPoolExecutor",
        lambda max_workers: pool,
    )

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=3),
        [(0, 1), (0, 2), (0, 3)],
        max_sols=1,
        processes=3,
    )

    assert result == {"first"}
    assert pool.terminated
    assert pool.exited
    assert all(future.cancelled for future in pool.futures[1:])


def test_unlimited_parallel_search_does_not_terminate_workers(monkeypatch):
    pool = _FakeProcessPool(({"first"}, {"second"}, {"third"}))
    monkeypatch.setattr(
        parallel_module.concurrent.futures,
        "ProcessPoolExecutor",
        lambda max_workers: pool,
    )

    result = parallel_module.solve_parallel_trials(
        Grid(1, 1, max_elem=3),
        [(0, 1), (0, 2), (0, 3)],
        max_sols=-1,
        processes=3,
    )

    assert result == {"first", "second", "third"}
    assert not pool.terminated
    assert pool.exited
    assert not any(future.cancelled for future in pool.futures)
