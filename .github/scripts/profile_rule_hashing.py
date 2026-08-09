"""Profile GridPuzzle rule hashing in full default-solver workloads."""

from __future__ import annotations

import argparse
import cProfile
import json
import logging
import pstats

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
    raise ValueError(name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=("blank4_all", "nonsquare6_cap20"))
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
    rows = []
    for (filename, line, function), values in stats.stats.items():
        if function != "__hash__" or "gridsolver" not in filename:
            continue
        primitive_calls, total_calls, total_time, cumulative_time, _ = values
        rows.append(
            {
                "file": filename.rsplit("/", 1)[-1],
                "line": line,
                "primitive_calls": primitive_calls,
                "total_calls": total_calls,
                "total_time": total_time,
                "cumulative_time": cumulative_time,
            }
        )
    rows.sort(key=lambda row: row["cumulative_time"], reverse=True)
    print(
        json.dumps(
            {
                "case": args.case,
                "solutions": len(solutions),
                "rule_hash_rows": rows,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
