"""Compare process and thread top-level search on free-threaded Python 3.14."""

from __future__ import annotations

import argparse
import concurrent.futures
import gc
import hashlib
import json
import logging
import statistics
import sys
import sysconfig
import time
from collections import deque
from collections.abc import Callable

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.validation import validate_solutions


type SolutionSet = set[ImmutableGrid]
type CaseFactory = Callable[[], tuple[Grid, int]]


def _digest(solutions: SolutionSet) -> str:
    payload = repr(sorted(tuple(solution) for solution in solutions)).encode()
    return hashlib.sha256(payload).hexdigest()


def _thread_branch(
    root: Grid,
    payload: tuple[int, int, int],
) -> SolutionSet:
    cell, value, max_sols = payload
    grid = root.deepcopy()
    grid[cell] = value
    return solver._solve_full(grid, [0], max_sols, set())


def _thread_trials(
    root: Grid,
    branches: list[tuple[int, int]],
    max_sols: int,
    workers: int,
) -> SolutionSet:
    ordered_branches = sorted(branches)
    solutions: SolutionSet = set()

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        initial_count = min(workers, len(ordered_branches))
        futures = deque(
            pool.submit(
                _thread_branch,
                root,
                (cell, value, max_sols),
            )
            for cell, value in ordered_branches[:initial_count]
        )
        next_branch_index = initial_count

        while futures:
            future = futures.popleft()
            solutions.update(future.result())

            if 0 < max_sols <= len(solutions):
                for pending in futures:
                    pending.cancel()
                break

            if next_branch_index < len(ordered_branches):
                cell, value = ordered_branches[next_branch_index]
                next_branch_index += 1
                futures.append(
                    pool.submit(
                        _thread_branch,
                        root,
                        (cell, value, max_sols),
                    )
                )

    return solver._cap_solutions(solutions, max_sols)


def solve_threaded(
    source: Grid,
    max_sols: int,
    workers: int,
) -> SolutionSet:
    """Mirror the production top-level process search with threads."""
    grid = source.deepcopy()
    status = AtomicSolver(grid, [0], set()).solve_atomic()
    if status is SolveStatus.SOLVED:
        solutions = {
            ImmutableGrid(
                grid.known,
                grid.rows,
                grid.cols,
                grid.max_elem,
                type(grid).__name__,
            )
        }
    elif status is SolveStatus.INVALID:
        solutions = set()
    else:
        test_cell, possible = grid.get_smallest_candidate_set_gt1()
        guarantee = grid.get_smallest_guarantee()
        values = sorted(possible)
        if guarantee is not None and len(guarantee.cells) < len(values):
            branches = [
                (cell, guarantee.val)
                for cell in sorted(guarantee.cells)
            ]
        else:
            branches = [(test_cell, value) for value in values]
        solutions = _thread_trials(
            grid.deepcopy(),
            branches,
            max_sols,
            workers,
        )

    validate_solutions(source, solutions)
    return solver._cap_solutions(solutions, max_sols)


def _fanout1000() -> tuple[Grid, int]:
    return Grid(1, 1, max_elem=1000), -1


def _blank4_cap1() -> tuple[Grid, int]:
    return Sudoku(2, 2, 2, 2), 1


def _blank4_all() -> tuple[Grid, int]:
    return Sudoku(2, 2, 2, 2), -1


def _nonsquare6_cap20() -> tuple[Grid, int]:
    grid = Sudoku(3, 2, 2, 3)
    grid.load(
        "123456654321........................",
        row_wise=False,
    )
    return grid, 20


_CASES: dict[str, CaseFactory] = {
    "fanout1000": _fanout1000,
    "blank4_cap1": _blank4_cap1,
    "blank4_all": _blank4_all,
    "nonsquare6_cap20": _nonsquare6_cap20,
}


def _run_backend(
    backend: str,
    factory: CaseFactory,
    workers: int,
) -> tuple[float, int, str]:
    grid, max_sols = factory()
    gc.collect()
    started = time.perf_counter()
    if backend == "process":
        solutions = solver.solve(
            grid,
            log_level=0,
            max_sols=max_sols,
            processes=workers,
        )
    elif backend == "thread":
        solutions = solve_threaded(grid, max_sols, workers)
    else:
        raise ValueError(backend)
    elapsed = time.perf_counter() - started
    return elapsed, len(solutions), _digest(solutions)


def benchmark(case: str, repeats: int, workers: int) -> None:
    factory = _CASES[case]
    durations = {"process": [], "thread": []}
    expected: tuple[int, str] | None = None

    for repeat in range(repeats):
        order = (
            ("process", "thread")
            if repeat % 2 == 0
            else ("thread", "process")
        )
        for backend in order:
            elapsed, cardinality, digest = _run_backend(
                backend,
                factory,
                workers,
            )
            result = cardinality, digest
            if expected is None:
                expected = result
            elif result != expected:
                raise RuntimeError(
                    f"{case}: {backend} returned {result}, expected {expected}"
                )
            durations[backend].append(elapsed)

    process_median = statistics.median(durations["process"])
    thread_median = statistics.median(durations["thread"])
    print(
        json.dumps(
            {
                "case": case,
                "workers": workers,
                "cardinality": expected[0] if expected else None,
                "digest": expected[1] if expected else None,
                "process_seconds": durations["process"],
                "thread_seconds": durations["thread"],
                "process_median": process_median,
                "thread_median": thread_median,
                "thread_change_percent": 100 * (
                    thread_median / process_median - 1
                ),
            },
            sort_keys=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=tuple(_CASES), required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    gil_enabled = getattr(sys, "_is_gil_enabled", lambda: True)()
    py_gil_disabled = sysconfig.get_config_var("Py_GIL_DISABLED")
    print(
        json.dumps(
            {
                "python": sys.version,
                "gil_enabled": gil_enabled,
                "Py_GIL_DISABLED": py_gil_disabled,
            },
            sort_keys=True,
        )
    )
    if gil_enabled or py_gil_disabled != 1:
        raise SystemExit("This benchmark requires a free-threaded Python build")
    if args.repeats <= 0 or args.workers <= 0:
        raise SystemExit("repeats and workers must be positive")

    logging.disable(10_000)
    benchmark(args.case, args.repeats, args.workers)


if __name__ == "__main__":
    main()
