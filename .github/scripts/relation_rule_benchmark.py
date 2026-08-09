"""Full default-solver benchmark for relation-rule batching."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import time
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
    if name == "miracle":
        return examples2.get_example(SimpleNamespace(example="m")), 1, 1
    raise ValueError(name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "case",
        choices=("blank4_all", "nonsquare6_cap20", "miracle"),
    )
    args = parser.parse_args()

    gc.collect()
    grid, max_sols, expected = make_case(args.case)
    started = time.perf_counter()
    solutions = solver.solve(
        grid,
        log_level=0,
        max_sols=max_sols,
        processes=0,
        depth_gate=None,
    )
    elapsed = time.perf_counter() - started
    if len(solutions) != expected:
        raise SystemExit(
            f"{args.case}: expected {expected} solutions, got {len(solutions)}"
        )
    payload = repr(sorted(tuple(solution) for solution in solutions)).encode()
    print(
        json.dumps(
            {
                "case": args.case,
                "seconds": elapsed,
                "cardinality": len(solutions),
                "digest": hashlib.sha256(payload).hexdigest(),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
