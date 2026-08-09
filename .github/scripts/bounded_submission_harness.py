"""Temporary harness for bounded parallel branch submission."""

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
        capped = _FakeProcessPool(
            ({"first"}, {"second"}, {"third"}, {"fourth"}, {"fifth"})
        )
        parallel_module.concurrent.futures.ProcessPoolExecutor = (
            lambda max_workers: capped
        )
        result = parallel_module.solve_parallel_trials(
            Grid(1, 1, max_elem=5),
            [(0, value) for value in range(1, 6)],
            max_sols=1,
            processes=2,
        )
        assert result == {"first"}
        assert len(capped.futures) == 2
        assert capped.terminated and capped.exited
        assert capped.futures[1].cancelled

        unlimited = _FakeProcessPool(
            ({"first"}, {"second"}, {"third"}, {"fourth"}, {"fifth"})
        )
        parallel_module.concurrent.futures.ProcessPoolExecutor = (
            lambda max_workers: unlimited
        )
        result = parallel_module.solve_parallel_trials(
            Grid(1, 1, max_elem=5),
            [(0, value) for value in range(1, 6)],
            max_sols=-1,
            processes=2,
        )
        assert result == {"first", "second", "third", "fourth", "fifth"}
        assert len(unlimited.futures) == 5
        assert not unlimited.terminated and unlimited.exited
        assert not any(future.cancelled for future in unlimited.futures)
    finally:
        parallel_module.concurrent.futures.ProcessPoolExecutor = original


def _run_case(case: str):
    if case == "fanout100":
        grid = Grid(1, 1, max_elem=100)
        return parallel_module.solve_parallel_trials(
            grid,
            [(0, value) for value in range(1, 101)],
            max_sols=1,
            processes=2,
        )
    if case == "fanout1000":
        grid = Grid(1, 1, max_elem=1000)
        return parallel_module.solve_parallel_trials(
            grid,
            [(0, value) for value in range(1, 1001)],
            max_sols=1,
            processes=2,
        )
    if case == "blank4_cap1":
        return solver.solve(
            Sudoku(2, 2, 2, 2),
            log_level=0,
            max_sols=1,
            processes=2,
            depth_gate=None,
        )
    raise ValueError(f"Unknown case {case!r}")


def benchmark(case: str, repeats: int) -> None:
    durations: list[float] = []
    digest: str | None = None
    for _ in range(repeats):
        gc.collect()
        started = time.perf_counter()
        solutions = _run_case(case)
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
    parser.add_argument(
        "--case",
        choices=("fanout100", "fanout1000", "blank4_cap1"),
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
