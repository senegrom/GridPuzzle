"""Compare the thread and process executors on a free-threaded build.

Solves a fixed set of workloads with `processes=N` under both parallel
backends, alternating which goes first in each round, checks that both
return the same solutions, and writes per-case timings, the thread/process
ratios and a summary as JSON. A ratio below 1 means the thread backend was
faster. FREE_THREADED.md quotes the summary; the "Thread executor
benchmark" workflow runs this on GitHub's free-threaded Python 3.14 and
uploads the file:

    python scripts/benchmark_thread_executor.py --output thread-executor.json

The thread backend runs only on a free-threaded build with the GIL
disabled, so the script refuses to measure anything else.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
import sysconfig
import time
from pathlib import Path

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


def _loaded4():
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")
    return grid


def _nonsquare6():
    grid = Sudoku(3, 2, 2, 3)
    grid.load("123456654321........................", row_wise=False)
    return grid


# name: (description, grid factory, max_sols); the 2026-08-12 record's
# real workloads, rebuilt from the tests that use the same grids.
CASES = {
    "loaded4_all": ("4x4 Sudoku with two rows given, all 4 solutions", _loaded4, -1),
    "blank4_cap1": ("blank 4x4 Sudoku, first solution", lambda: Sudoku(2, 2, 2, 2), 1),
    "blank4_all": ("blank 4x4 Sudoku, all 288 solutions", lambda: Sudoku(2, 2, 2, 2), -1),
    "nonsquare6_cap20": ("6x6 Sudoku with 3x2 boxes and two rows given, 20 of 1408", _nonsquare6, 20),
}
BACKENDS = ("process", "thread")


def free_threaded() -> bool:
    is_gil_enabled = getattr(sys, "_is_gil_enabled", None)
    return bool(sysconfig.get_config_var("Py_GIL_DISABLED")) and callable(is_gil_enabled) and not is_gil_enabled()


def digest(solutions) -> str:
    """Content of a solution set, independent of order and object identity."""
    return hashlib.sha256(repr(sorted(solution.known for solution in solutions)).encode()).hexdigest()


def measure(name: str, backend: str, workers: int) -> tuple[float, int, str]:
    _, make, cap = CASES[name]
    grid = make()
    started = time.perf_counter()
    solutions = solver.solve(grid, max_sols=cap, processes=workers, parallel_backend=backend)
    return time.perf_counter() - started, len(solutions), digest(solutions)


def geomean(values: list[float]) -> float:
    return math.exp(sum(math.log(value) for value in values) / len(values))


def run(names: list[str], workers: int, rounds: int, warmup: int) -> dict:
    cases = {}
    for name in names:
        seconds = {backend: [] for backend in BACKENDS}
        results = set()
        for round_ in range(warmup + rounds):
            # alternate which backend goes first, so neither always runs warm
            order = BACKENDS if round_ % 2 == 0 else BACKENDS[::-1]
            for backend in order:
                elapsed, count, content = measure(name, backend, workers)
                results.add((count, content))
                if round_ >= warmup:
                    seconds[backend].append(elapsed)
        if len(results) != 1:
            raise AssertionError(f"{name}: the backends returned different solutions: {sorted(results)}")
        (count, content), = results
        medians = {backend: statistics.median(values) for backend, values in seconds.items()}
        cases[name] = {
            "description": CASES[name][0],
            "max_sols": CASES[name][2],
            "count": count,
            "digest": content,
            **{f"{backend}_seconds": values for backend, values in seconds.items()},
            **{f"{backend}_median": medians[backend] for backend in BACKENDS},
            "thread_over_process": medians["thread"] / medians["process"],
        }
        print(f"{name:18} process {medians['process']:8.3f}s  thread {medians['thread']:8.3f}s  "
              f"ratio {cases[name]['thread_over_process']:.4f}", flush=True)
    ratios = [case["thread_over_process"] for case in cases.values()]
    capped = [case["thread_over_process"] for case in cases.values() if case["max_sols"] > 0]
    return {
        "python": sys.version,
        "gil_enabled": sys._is_gil_enabled() if hasattr(sys, "_is_gil_enabled") else True,
        "workers": workers,
        "rounds": rounds,
        "warmup_rounds": warmup,
        "cases": cases,
        "summary": {
            "geomean_ratio": geomean(ratios),
            "worst_ratio": max(ratios),
            "best_ratio": min(ratios),
            "positive_cap_geomean_ratio": geomean(capped) if capped else None,
        },
        "definitions": {
            "thread_over_process": "median thread seconds / median process seconds for one case",
            "geomean_ratio": "geometric mean of thread_over_process over the cases",
            "worst_ratio": "largest thread_over_process",
            "positive_cap_geomean_ratio": "geometric mean over the cases with max_sols > 0",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workers", type=int, default=2, help="processes / threads per solve (default 2)")
    parser.add_argument("--rounds", type=int, default=5, help="timed solves per backend and case (default 5)")
    parser.add_argument("--warmup", type=int, default=1, help="untimed rounds first (default 1)")
    parser.add_argument("--cases", nargs="+", choices=sorted(CASES), default=list(CASES))
    parser.add_argument("--output", type=Path, default=Path("thread-executor.json"))
    args = parser.parse_args(argv)
    if args.workers < 2 or args.rounds < 1 or args.warmup < 0:
        parser.error("needs --workers of at least 2, --rounds of at least 1 and --warmup of at least 0")
    if not free_threaded():
        parser.error(f"the thread backend needs a free-threaded build with the GIL disabled, not {sys.version}")
    report = run(args.cases, args.workers, args.rounds, args.warmup)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
