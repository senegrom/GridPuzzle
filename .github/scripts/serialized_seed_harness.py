"""Temporary correctness and timing harness for worker seed initialisation."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import pickle
import statistics
import time

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solve_parallel as parallel_module
from gridsolver.solver import solver


def _state(grid: Grid):
    return (
        tuple(grid._known),
        tuple(frozenset(possible) for possible in grid._candidates),
        frozenset(grid.rules),
        frozenset(grid.rules_ia),
        frozenset(grid.guarantees),
        frozenset(grid.guarantees_ia),
        grid.has_been_filled,
        tuple(grid._trail_state.entries),
        tuple(grid._trail_state.marks),
    )


class _ImmediateFuture:
    def __init__(self, result) -> None:
        self._result = result
        self.cancelled = False

    def result(self):
        return self._result

    def cancel(self) -> bool:
        self.cancelled = True
        return True


class _FakeProcessPool:
    def __init__(
        self,
        *,
        max_workers: int,
        initializer,
        initargs: tuple,
    ) -> None:
        self.max_workers = max_workers
        self.initializer = initializer
        self.initargs = initargs
        self.payloads = []
        self.futures = []
        self.terminated = False
        initializer(*initargs)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        pass

    def submit(self, worker, payload):
        self.payloads.append(payload)
        future = _ImmediateFuture(worker(payload))
        self.futures.append(future)
        return future

    def terminate_workers(self) -> None:
        self.terminated = True


def unit_check() -> None:
    seed = Sudoku(2, 2, 2, 2)
    before = _state(seed)
    payload = pickle.dumps(seed, protocol=pickle.HIGHEST_PROTOCOL)
    parallel_module._init_worker(payload)

    first = parallel_module._solve_branch((0, 1, 1, 0))
    assert len(first) == 1
    assert _state(seed) == before

    second = parallel_module._solve_branch((0, 2, 1, 0))
    assert len(second) == 1
    assert first != second
    assert _state(seed) == before

    original = parallel_module.concurrent.futures.ProcessPoolExecutor
    pools: list[_FakeProcessPool] = []

    def factory(**kwargs):
        pool = _FakeProcessPool(**kwargs)
        pools.append(pool)
        return pool

    parallel_module.concurrent.futures.ProcessPoolExecutor = factory
    try:
        root = Grid(1, 1, max_elem=3)
        result = parallel_module.solve_parallel_trials(
            root,
            [(0, 1), (0, 2), (0, 3)],
            max_sols=1,
            processes=2,
        )
        assert len(result) == 1
        assert _state(root) == _state(Grid(1, 1, max_elem=3))

        pool = pools[-1]
        assert pool.max_workers == 2
        assert pool.initializer is parallel_module._init_worker
        assert len(pool.initargs) == 1
        assert isinstance(pool.initargs[0], bytes)
        assert len(pool.payloads) == 2
        assert all(len(branch_payload) == 4 for branch_payload in pool.payloads)
        assert all(
            not any(isinstance(item, Grid) for item in branch_payload)
            for branch_payload in pool.payloads
        )
        assert pool.terminated
    finally:
        parallel_module.concurrent.futures.ProcessPoolExecutor = original


def _fanout_case(count: int, payload_bytes: int = 0):
    grid = Grid(1, 1, max_elem=count)
    if payload_bytes:
        grid._benchmark_payload = b"x" * payload_bytes
    return parallel_module.solve_parallel_trials(
        grid,
        [(0, value) for value in range(1, count + 1)],
        max_sols=-1,
        processes=2,
    )


def _run_case(case: str):
    if case == "fanout1000":
        return _fanout_case(1000)
    if case == "payload1mb_fanout100":
        return _fanout_case(100, 1_000_000)
    if case == "blank4_cap1":
        return solver.solve(
            Sudoku(2, 2, 2, 2),
            log_level=0,
            max_sols=1,
            processes=2,
            depth_gate=None,
        )
    if case == "blank4_all":
        return solver.solve(
            Sudoku(2, 2, 2, 2),
            log_level=0,
            max_sols=-1,
            processes=2,
            depth_gate=None,
        )
    if case == "nonsquare6_cap20":
        grid = Sudoku(3, 2, 2, 3)
        grid.load("123456654321........................", row_wise=False)
        return solver.solve(
            grid,
            log_level=0,
            max_sols=20,
            processes=2,
            depth_gate=None,
        )
    raise ValueError(f"Unknown case {case!r}")


def benchmark(case: str, repeats: int) -> None:
    durations: list[float] = []
    digest: str | None = None
    cardinality: int | None = None
    for _ in range(repeats):
        gc.collect()
        started = time.perf_counter()
        solutions = _run_case(case)
        durations.append(time.perf_counter() - started)
        current_cardinality = len(solutions)
        if cardinality is None:
            cardinality = current_cardinality
        elif current_cardinality != cardinality:
            raise RuntimeError(f"{case}: nondeterministic cardinality")
        payload = repr(sorted(tuple(solution) for solution in solutions)).encode()
        current = hashlib.sha256(payload).hexdigest()
        if digest is None:
            digest = current
        elif current != digest:
            raise RuntimeError(f"{case}: nondeterministic solution set")

    print(
        json.dumps(
            {
                "case": case,
                "cardinality": cardinality,
                "seconds": durations,
                "median": statistics.median(durations),
                "digest": digest,
            },
            sort_keys=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", action="store_true")
    parser.add_argument(
        "--case",
        choices=(
            "fanout1000",
            "payload1mb_fanout100",
            "blank4_cap1",
            "blank4_all",
            "nonsquare6_cap20",
        ),
    )
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    if args.unit:
        unit_check()
    elif args.case:
        benchmark(args.case, args.repeats)
    else:
        parser.error("choose --unit or --case")


if __name__ == "__main__":
    main()
