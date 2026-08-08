"""Measure opt-in depth-gating policies with exact solution-set checks."""

import gc
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from types import SimpleNamespace
from typing import Callable

from examples2 import get_example
from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


@dataclass(frozen=True, slots=True)
class BenchmarkCase:
    name: str
    factory: Callable[[], Grid]
    max_solutions: int
    gates: tuple[int | None, ...]


def _blank_4x4() -> Grid:
    return Sudoku(2, 2, 2, 2)


def _non_square_6x6() -> Grid:
    grid = Sudoku(3, 2, 2, 3)
    grid.load("123456654321........................", row_wise=False)
    return grid


def _example(name: str) -> Callable[[], Grid]:
    return lambda: get_example(SimpleNamespace(example=name))


def _solution_key(solution) -> tuple[int, int, int, tuple[int, ...]]:
    return solution.rows, solution.cols, solution.max_elem, tuple(solution)


def _fingerprint(solutions) -> list[tuple[int, int, int, tuple[int, ...]]]:
    return sorted((_solution_key(solution) for solution in solutions))


def _gate_label(gate: int | None) -> str:
    return "full" if gate is None else str(gate)


def _run_case(case: BenchmarkCase) -> list[dict[str, object]]:
    baseline = None
    baseline_seconds = None
    rows: list[dict[str, object]] = []

    for gate in case.gates:
        gc.collect()
        grid = case.factory()
        started = perf_counter()
        solutions = solver.solve(
            grid,
            log_level=0,
            max_sols=case.max_solutions,
            depth_gate=gate,
        )
        seconds = perf_counter() - started
        fingerprint = _fingerprint(solutions)

        if baseline is None:
            baseline = fingerprint
            baseline_seconds = seconds
        elif fingerprint != baseline:
            raise AssertionError(
                f"{case.name}: depth_gate={gate!r} changed the returned solution set"
            )

        rows.append(
            {
                "case": case.name,
                "depth_gate": gate,
                "gate_label": _gate_label(gate),
                "solutions": len(solutions),
                "seconds": seconds,
                "speedup_vs_full": (
                    1.0 if baseline_seconds is None else baseline_seconds / seconds
                ),
            }
        )

    return rows


def _markdown(rows: list[dict[str, object]]) -> str:
    lines = [
        "## Depth-gate benchmark",
        "",
        "Every row returned exactly the same deterministic solution set as `full`.",
        "",
        "| Case | Gate | Solutions | Seconds | Speed-up vs full |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            "| {case} | {gate_label} | {solutions} | {seconds:.3f} | {speedup_vs_full:.2f}× |".format(
                **row
            )
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    # GridPuzzle uses custom logging levels above CRITICAL; disable above those
    # levels so rendering hundreds of solutions cannot distort the timings.
    logging.disable(10_000)

    cases = (
        BenchmarkCase("blank 4x4 Sudoku", _blank_4x4, -1, (None, 0, 1, 2)),
        BenchmarkCase("non-square 6x6 Sudoku (20)", _non_square_6x6, 20, (None, 0, 1, 2)),
        BenchmarkCase("hard 9x9 Sudoku (1)", _example("t"), 1, (None, 1)),
        BenchmarkCase("Killer Sudoku A (1)", _example("a"), 1, (None, 1)),
    )

    # Exclude one-time imports and allocator setup from the recorded cases.
    solver.solve(Sudoku(1, 1, 1, 1), log_level=0, max_sols=1)

    rows = [row for case in cases for row in _run_case(case)]
    markdown = _markdown(rows)
    print(markdown, end="")

    Path("benchmark-results.json").write_text(
        json.dumps(rows, indent=2) + "\n",
        encoding="utf-8",
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write(markdown)


if __name__ == "__main__":
    main()
