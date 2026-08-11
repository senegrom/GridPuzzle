"""Verify that the public candidate facade does not tax solver hot paths."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any


CASE_CODE = r'''
import hashlib
import json
import logging
import sys
from time import perf_counter

logging.disable(10_000)
case = sys.argv[1]


def digest(solutions):
    payload = repr(tuple(tuple(solution) for solution in sorted(solutions, key=tuple))).encode()
    return hashlib.sha256(payload).hexdigest()


if case == "loaded4":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    started = perf_counter()
    solutions = None
    for _ in range(18):
        grid = Sudoku(2, 2, 2, 2)
        grid.load("12344321........")
        solutions = solver.solve(grid, log_level=-1, depth_gate=None)
    seconds = perf_counter() - started
elif case == "nonsquare6":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    grid = Sudoku(3, 2, 2, 3)
    grid.load("123456654321........................", row_wise=False)
    started = perf_counter()
    solutions = solver.solve(
        grid,
        max_sols=10,
        log_level=-1,
        depth_gate=None,
    )
    seconds = perf_counter() - started
else:
    raise SystemExit(case)

print(json.dumps({
    "seconds": seconds,
    "count": len(solutions),
    "digest": digest(solutions),
}))
'''


def run(root: Path, case: str) -> dict[str, Any]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root)
    env["PYTHONHASHSEED"] = "0"
    output = subprocess.check_output(
        [sys.executable, "-c", CASE_CODE, case],
        cwd=root,
        env=env,
        text=True,
    )
    return json.loads(output.strip().splitlines()[-1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    parser.add_argument("--json", dest="json_path", type=Path, required=True)
    parser.add_argument("--marker", type=Path, required=True)
    args = parser.parse_args()

    repetitions = {"loaded4": 5, "nonsquare6": 3}
    summary: dict[str, dict[str, Any]] = {}
    ratios: list[float] = []
    for case, count in repetitions.items():
        baseline: list[dict[str, Any]] = []
        candidate: list[dict[str, Any]] = []
        for index in range(count):
            order = (
                ((args.baseline, baseline), (args.candidate, candidate))
                if index % 2 == 0
                else ((args.candidate, candidate), (args.baseline, baseline))
            )
            for root, target in order:
                target.append(run(root, case))
        outcomes = {
            (entry["count"], entry["digest"])
            for entry in (*baseline, *candidate)
        }
        if len(outcomes) != 1:
            raise SystemExit(f"{case}: deterministic result mismatch: {outcomes}")
        baseline_median = statistics.median(
            float(entry["seconds"]) for entry in baseline
        )
        candidate_median = statistics.median(
            float(entry["seconds"]) for entry in candidate
        )
        ratio = candidate_median / baseline_median
        ratios.append(ratio)
        summary[case] = {
            "baseline_median": baseline_median,
            "candidate_median": candidate_median,
            "change_percent": 100 * (ratio - 1),
            "count": baseline[0]["count"],
            "digest": baseline[0]["digest"],
        }

    geomean = math.prod(ratios) ** (1 / len(ratios))
    decision = "promote" if geomean <= 1.03 else "reject"
    if decision == "promote":
        args.marker.touch()
    report = {
        "decision": decision,
        "depth_gate": None,
        "geomean_change_percent": 100 * (geomean - 1),
        "summary": summary,
    }
    args.json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    labels = {
        "loaded4": "Loaded 4×4 Sudoku, 18 complete solves",
        "nonsquare6": "Non-square 6×6 Sudoku, first 10 solutions",
    }
    lines = [
        "# Validated public candidate view — 2026-08-11",
        "",
        "Solver modules no longer call the public candidate accessor. All",
        "comparisons used `depth_gate=None` and exact solution fingerprints.",
        "",
        "| Case | Baseline | Candidate | Change |",
        "|---|---:|---:|---:|",
    ]
    for case in ("loaded4", "nonsquare6"):
        item = summary[case]
        lines.append(
            f"| {labels[case]} | {item['baseline_median']:.6f}s | "
            f"{item['candidate_median']:.6f}s | "
            f"{item['change_percent']:+.2f}% |"
        )
    lines.extend((
        "",
        f"Solver geometric mean: **{100 * (geomean - 1):+.2f}%**.",
        "",
        f"Decision: **{decision}**.",
    ))
    args.markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
