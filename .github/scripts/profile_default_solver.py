"""Profile current default-solver workloads after accepted optimizations."""

from __future__ import annotations

import argparse
import cProfile
import json
import logging
import pstats
from pathlib import Path
from types import SimpleNamespace

import examples2
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


logging.disable(10_000)


def make_case(name: str):
    if name == "blank4_all":
        return Sudoku(2, 2, 2, 2), -1, 288
    if name == "nonsquare6_cap20":
        grid = Sudoku(3, 2, 2, 3)
        grid.load(
            "123456654321........................",
            row_wise=False,
        )
        return grid, 20, 20
    if name == "killer_a":
        return examples2.get_example(SimpleNamespace(example="a")), 1, 1
    raise ValueError(name)


def compact_row(key, values):
    filename, line, function = key
    primitive_calls, total_calls, own, cumulative, _ = values
    return [
        Path(filename).name,
        line,
        function,
        primitive_calls,
        total_calls,
        round(own, 6),
        round(cumulative, 6),
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "case",
        choices=("blank4_all", "nonsquare6_cap20", "killer_a"),
    )
    args = parser.parse_args()

    grid, max_sols, expected = make_case(args.case)
    profile = cProfile.Profile()
    profile.enable()
    solutions = solver.solve(
        grid,
        log_level=0,
        max_sols=max_sols,
        processes=0,
        depth_gate=None,
    )
    profile.disable()
    if len(solutions) != expected:
        raise SystemExit(
            f"{args.case}: expected {expected}, got {len(solutions)}"
        )

    stats = pstats.Stats(profile)
    rows = [
        compact_row(key, values)
        for key, values in stats.stats.items()
        if "gridsolver" in key[0]
    ]
    top_cumulative = sorted(rows, key=lambda row: row[6], reverse=True)[:12]
    top_own = sorted(rows, key=lambda row: row[5], reverse=True)[:12]
    print(
        "PROFILE "
        + json.dumps(
            {
                "case": args.case,
                "solutions": len(solutions),
                "total": round(stats.total_tt, 6),
                "columns": [
                    "file",
                    "line",
                    "function",
                    "primitive_calls",
                    "total_calls",
                    "own_seconds",
                    "cumulative_seconds",
                ],
                "cumulative": top_cumulative,
                "own": top_own,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
