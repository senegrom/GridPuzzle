"""Temporary harness for the Python 3.14 capped-parallel experiment."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import statistics
import time

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solve_parallel as parallel_module
from gridsolver.solver import solver


class _FakeFuture:
    def __init__(self, result: set[str]) -> None:
        self._result = result
        self.cancelled = False

    def result(self) -> set[str]:
        return self._result

    def cancel(self) -> bool:
        self.cancelled = True
        return True


class _FakeProcessPool:
    def __init__(self, results: tuple[set[str], ...]) -> None:
        self._results = iter(results)
        self.futures: list[_FakeFuture] = []
        self.terminated = False
        self.exited = False

    def __enter__(self) -> "_FakeProcessPool":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.exited = True

    def submit(self, worker, payload) -> _FakeFuture:
        future = _FakeFuture(next(self._results))
        self.futures.append(future)
        return future

    def terminate_workers(self) -> None:
        self.terminated = True


def unit_check() -> None:
    original = parallel_module.concurrent.futures.ProcessPoolExecutor
    try:
        capped = _FakeProcessPool(({"first"}, {"second"}, {"third"}))
        parallel_module.concurrent.futures.ProcessPoolExecutor = (
            lambda max_workers: capped
        )
        result = parallel_module.solve_parallel_trials(
            Grid(1, 1, max_elem=3),
            [(0, 1), (0, 2), (0, 3)],
            max_sols=1,
            processes=3,
        )
        assert result == {"first"}
        assert capped.terminated and capped.exited
        assert all(future.cancelled for future in capped.futures[1:])

        unlimited = _FakeProcessPool(({"first"}, {"second"}, {"third"}))
        parallel_module.concurrent.futures.ProcessPoolExecutor = (
            lambda max_workers: unlimited
        )
        result = parallel_module.solve_parallel_trials(
            Grid(1, 1, max_elem=3),
            [(0, 1), (0, 2), (0, 3)],
            max_sols=-1,
            processes=3,
        )
        assert result == {"first", "second", "third"}
        assert not unlimited.terminated and unlimited.exited
        assert not any(future.cancelled for future in unlimited.futures)
    finally:
        parallel_module.concurrent.futures.ProcessPoolExecutor = original


def _factory(case: str) -> Sudoku:
    if case == "blank4_cap1":
        return Sudoku(2, 2, 2, 2)
    if case == "nonsquare6_cap1":
        grid = Sudoku(3, 2, 2, 3)
        grid.load("123456654321........................", row_wise=False)
        return grid
    raise ValueError(f"Unknown case {case!r}")


def benchmark(case: str, repeats: int) -> None:
    durations: list[float] = []
    digest: str | None = None
    for _ in range(repeats):
        gc.collect()
        started = time.perf_counter()
        solutions = solver.solve(
            _factory(case),
            log_level=0,
            max_sols=1,
            processes=4,
            depth_gate=None,
        )
        durations.append(time.perf_counter() - started)
        if len(solutions) != 1:
            raise RuntimeError(f"{case}: expected one solution")
        payload = repr(sorted(tuple(solution) for solution in solutions)).encode()
        current = hashlib.sha256(payload).hexdigest()
        if digest is None:
            digest = current
        elif current != digest:
            raise RuntimeError(f"{case}: nondeterministic result")

    print(
        json.dumps(
            {
                "case": case,
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
    parser.add_argument("--case", choices=("blank4_cap1", "nonsquare6_cap1"))
    parser.add_argument("--repeats", type=int, default=2)
    args = parser.parse_args()

    if args.unit:
        unit_check()
    elif args.case:
        benchmark(args.case, args.repeats)
    else:
        parser.error("choose --unit or --case")


if __name__ == "__main__":
    main()
