"""Measure immutable partition caching against the immediately preceding branch state."""

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

if case == "partition":
    from gridsolver.rules.sumrules import SumAndElementsAtMostOnce

    result = SumAndElementsAtMostOnce.partition2(24, 4, 1, 9)
    normalized = tuple(tuple(partition) for partition in result)
    started = perf_counter()
    for _ in range(250_000):
        result = SumAndElementsAtMostOnce.partition2(24, 4, 1, 9)
    seconds = perf_counter() - started
    print(json.dumps({
        "seconds": seconds,
        "count": len(result),
        "digest": hashlib.sha256(repr(normalized).encode()).hexdigest(),
    }))

elif case == "kakuro":
    from gridsolver.abstract_grids.grid_loading import create_from_file
    from gridsolver.solver import solver

    solutions = None
    started = perf_counter()
    for _ in range(24):
        grid = create_from_file("Examples/Kakuro/ATK/10x10-E81712.clp")
        solutions = solver.solve(
            grid,
            max_sols=1,
            log_level=-1,
            depth_gate=None,
        )
    seconds = perf_counter() - started
    payload = repr(tuple(tuple(solution) for solution in sorted(solutions, key=tuple))).encode()
    print(json.dumps({
        "seconds": seconds,
        "count": len(solutions),
        "digest": hashlib.sha256(payload).hexdigest(),
    }))
else:
    raise SystemExit(case)
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

    repetitions = {"partition": 7, "kakuro": 5}
    summary: dict[str, dict[str, Any]] = {}
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
            raise SystemExit(f"{case}: result mismatch: {outcomes}")
        baseline_seconds = [float(entry["seconds"]) for entry in baseline]
        candidate_seconds = [float(entry["seconds"]) for entry in candidate]
        baseline_median = statistics.median(baseline_seconds)
        candidate_median = statistics.median(candidate_seconds)
        summary[case] = {
            "baseline_seconds": baseline_seconds,
            "candidate_seconds": candidate_seconds,
            "baseline_median": baseline_median,
            "candidate_median": candidate_median,
            "change_percent": 100 * (candidate_median / baseline_median - 1),
            "count": baseline[0]["count"],
            "digest": baseline[0]["digest"],
        }

    kakuro_ratio = (
        summary["kakuro"]["candidate_median"]
        / summary["kakuro"]["baseline_median"]
    )
    decision = "promote" if kakuro_ratio <= 1.05 else "reject"
    if decision == "promote":
        args.marker.touch()

    report = {
        "decision": decision,
        "depth_gate": None,
        "summary": summary,
    }
    args.json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    labels = {
        "partition": "250,000 cached partition lookups",
        "kakuro": "24 representative Kakuro solves",
    }
    lines = [
        "# Immutable cage-partition cache — 2026-08-11",
        "",
        "The mutable process-global list/deque cache was replaced by bounded",
        "`lru_cache` entries containing only tuples. Every solver comparison used",
        "`depth_gate=None` and matched exact deterministic result fingerprints.",
        "",
        "| Case | Baseline | Candidate | Change |",
        "|---|---:|---:|---:|",
    ]
    for case in ("partition", "kakuro"):
        item = summary[case]
        lines.append(
            f"| {labels[case]} | {item['baseline_median']:.6f}s | "
            f"{item['candidate_median']:.6f}s | "
            f"{item['change_percent']:+.2f}% |"
        )
    lines.extend(("", f"Decision: **{decision}**."))
    args.markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
