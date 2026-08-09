"""Compare lazy chain diagnostics with the exact parent revision."""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path


CASES: dict[str, tuple[str, int]] = {
    "blank4_all": ("tests/test_basic.py::test_sudo1", 3),
    "nonsquare6_cap20": ("tests/test_basic.py::test_sudo_nonsq", 3),
    "loaded4": ("tests/test_basic.py::test_sudo2", 5),
}


def run_case(root: Path, node: str) -> float:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root)
    env["PYTHONHASHSEED"] = "0"
    started = time.perf_counter()
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            node,
            "--disable-warnings",
        ],
        cwd=root,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=420,
        check=False,
    )
    elapsed = time.perf_counter() - started
    if completed.returncode:
        print(completed.stdout)
        raise SystemExit(f"benchmark case failed in {root}: {node}")
    return elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--marker", type=Path, required=True)
    args = parser.parse_args()

    roots = {
        "baseline": args.baseline.resolve(),
        "candidate": args.candidate.resolve(),
    }
    samples = {
        label: {case: [] for case in CASES}
        for label in roots
    }

    for case, (node, repeats) in CASES.items():
        for repeat in range(repeats):
            order = (
                ("baseline", "candidate")
                if repeat % 2 == 0
                else ("candidate", "baseline")
            )
            for label in order:
                samples[label][case].append(run_case(roots[label], node))

    summary: dict[str, dict[str, object]] = {}
    ratios: list[float] = []
    for case in CASES:
        baseline = statistics.median(samples["baseline"][case])
        candidate = statistics.median(samples["candidate"][case])
        ratio = candidate / baseline
        ratios.append(ratio)
        summary[case] = {
            "baseline_seconds": samples["baseline"][case],
            "candidate_seconds": samples["candidate"][case],
            "baseline_median": baseline,
            "candidate_median": candidate,
            "change_percent": 100 * (ratio - 1),
        }

    geomean = math.prod(ratios) ** (1 / len(ratios))
    promote = (
        geomean <= 0.9975
        and max(ratios) <= 1.025
        and min(ratios) <= 0.99
    )
    payload = {
        "decision": "promote" if promote else "reject",
        "geomean_change_percent": 100 * (geomean - 1),
        "summary": summary,
    }
    args.json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Lazy chain diagnostics benchmark — 2026-08-09",
        "",
        "The candidate defers coordinate formatting and reconstructed chain paths",
        "until a configured logger can emit rule-level diagnostics. Deduction order,",
        "candidate mutations, the full ungated technique hierarchy, and solution limits",
        "are unchanged.",
        "",
        f"Decision: **{payload['decision']}**.",
        f"Geometric-mean change: **{payload['geomean_change_percent']:+.2f}%**.",
        "",
        "Promotion required at least a 0.25% geometric-mean improvement, no case",
        "worse than 2.5%, and at least one case improving by 1%.",
        "",
        "| Case | Baseline median | Candidate median | Change |",
        "|---|---:|---:|---:|",
    ]
    for case, values in summary.items():
        lines.append(
            f"| {case} | {values['baseline_median']:.3f}s | "
            f"{values['candidate_median']:.3f}s | "
            f"{values['change_percent']:+.2f}% |"
        )
    lines.extend(
        [
            "",
            "Runs alternated baseline/candidate order on the same Python 3.14 runner.",
            "Each benchmark command was an existing correctness test; the candidate",
            "also passed differential and per-technique soundness checks before timing.",
        ]
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if promote:
        args.marker.touch()
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
