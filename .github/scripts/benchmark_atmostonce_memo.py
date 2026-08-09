"""Benchmark stable at-most-once helper memoisation."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import math
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path


CASES: dict[str, int] = {
    "helper_repeat": 5,
    "blank4_all": 2,
    "nonsquare6_cap20": 3,
    "loaded4_all": 5,
    "killer_example": 5,
}
MACRO_CASES = (
    "blank4_all",
    "nonsquare6_cap20",
    "loaded4_all",
    "killer_example",
)


def _digest(payload: object) -> str:
    return hashlib.sha256(repr(payload).encode()).hexdigest()


def _helper_repeat() -> tuple[float, int, str]:
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver.rulehelpers import rulehelper_atmostonce

    grid = Sudoku()
    rulehelper_atmostonce(grid)
    started = time.perf_counter()
    for _ in range(5_000):
        rulehelper_atmostonce(grid)
    elapsed = time.perf_counter() - started
    payload = tuple(sorted(repr(rule) for rule in grid.rules))
    return elapsed, len(grid.rules), _digest(payload)


def _solver_case(case: str) -> tuple[float, int, str]:
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    if case == "blank4_all":
        grid = Sudoku(2, 2, 2, 2)
        max_sols = -1
        expected = 288
    elif case == "nonsquare6_cap20":
        grid = Sudoku(3, 2, 2, 3)
        grid.load("123456654321........................", row_wise=False)
        max_sols = 20
        expected = 20
    elif case == "loaded4_all":
        grid = Sudoku(2, 2, 2, 2)
        grid.load("12344321........")
        max_sols = -1
        expected = 4
    elif case == "killer_example":
        from Examples import killerSudoku

        grid = killerSudoku.g
        max_sols = -1
        expected = 1
    else:
        raise SystemExit(case)

    started = time.perf_counter()
    solutions = solver.solve(
        grid,
        log_level=0,
        max_sols=max_sols,
        depth_gate=None,
    )
    elapsed = time.perf_counter() - started
    if len(solutions) != expected:
        raise SystemExit(
            f"{case}: expected {expected} solutions, got {len(solutions)}"
        )
    payload = tuple(sorted(tuple(solution) for solution in solutions))
    return elapsed, len(solutions), _digest(payload)


def worker(root: Path, case: str) -> int:
    sys.path.insert(0, str(root.resolve()))
    logging.disable(10_000)
    gc.collect()
    if case == "helper_repeat":
        elapsed, cardinality, digest = _helper_repeat()
    else:
        elapsed, cardinality, digest = _solver_case(case)
    print(
        json.dumps(
            {
                "case": case,
                "seconds": elapsed,
                "cardinality": cardinality,
                "digest": digest,
            },
            sort_keys=True,
        )
    )
    return 0


def sample(script: Path, root: Path, case: str) -> dict[str, object]:
    env = os.environ.copy()
    env["PYTHONHASHSEED"] = "0"
    completed = subprocess.run(
        [
            sys.executable,
            str(script),
            "--worker-root",
            str(root),
            "--worker-case",
            case,
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        timeout=600,
        check=False,
    )
    if completed.returncode:
        print(completed.stdout)
        raise SystemExit(f"benchmark worker failed: {root} {case}")
    return json.loads(completed.stdout.strip().splitlines()[-1])


def orchestrate(args: argparse.Namespace) -> int:
    script = Path(__file__).resolve()
    roots = {
        "baseline": args.baseline.resolve(),
        "candidate": args.candidate.resolve(),
    }
    timings = {
        label: {case: [] for case in CASES}
        for label in roots
    }
    identities: dict[str, tuple[int, str]] = {}

    for case, repeats in CASES.items():
        for repeat in range(repeats):
            order = (
                ("baseline", "candidate")
                if repeat % 2 == 0
                else ("candidate", "baseline")
            )
            for label in order:
                result = sample(script, roots[label], case)
                identity = (int(result["cardinality"]), str(result["digest"]))
                expected = identities.setdefault(case, identity)
                if identity != expected:
                    raise SystemExit(
                        f"{case}: result identity differs: {identity} != {expected}"
                    )
                timings[label][case].append(float(result["seconds"]))

    summary: dict[str, dict[str, object]] = {}
    ratios: dict[str, float] = {}
    for case in CASES:
        baseline = statistics.median(timings["baseline"][case])
        candidate = statistics.median(timings["candidate"][case])
        ratio = candidate / baseline
        ratios[case] = ratio
        summary[case] = {
            "baseline_seconds": timings["baseline"][case],
            "candidate_seconds": timings["candidate"][case],
            "baseline_median": baseline,
            "candidate_median": candidate,
            "change_percent": 100 * (ratio - 1),
            "cardinality": identities[case][0],
            "digest": identities[case][1],
        }

    macro_geomean = math.prod(ratios[case] for case in MACRO_CASES) ** (
        1 / len(MACRO_CASES)
    )
    promote = (
        macro_geomean <= 1.005
        and max(ratios[case] for case in MACRO_CASES) <= 1.025
        and ratios["helper_repeat"] <= 0.5
    )
    payload = {
        "decision": "promote" if promote else "reject",
        "macro_geomean_change_percent": 100 * (macro_geomean - 1),
        "summary": summary,
    }
    args.json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# At-most-once helper memo benchmark — 2026-08-09",
        "",
        "The candidate records completion in the rule-only cache after pairwise",
        "at-most-once relations are materialised. Candidate, known-value, and",
        "guarantee churn reuse that marker; any rule addition or deactivation",
        "invalidates it. Depth gating remained disabled.",
        "",
        f"Decision: **{payload['decision']}**.",
        f"Macro geometric-mean change: **{payload['macro_geomean_change_percent']:+.2f}%**.",
        "",
        "Promotion required the stable-helper microcase to halve, macro geometric",
        "mean no worse than +0.5%, no macro case above +2.5%, and exact result",
        "fingerprints in every sample.",
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
            "Runs alternated baseline and candidate on one Python 3.14 runner.",
            "Every solver sample used the full default hierarchy and checked exact",
            "deterministic solution fingerprints.",
        ]
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if promote:
        args.marker.touch()
    print(json.dumps(payload, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-root", type=Path)
    parser.add_argument("--worker-case", choices=tuple(CASES))
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--marker", type=Path)
    args = parser.parse_args()

    if args.worker_root is not None:
        if args.worker_case is None:
            parser.error("--worker-case is required")
        return worker(args.worker_root, args.worker_case)
    if any(
        value is None
        for value in (
            args.baseline,
            args.candidate,
            args.json,
            args.report,
            args.marker,
        )
    ):
        parser.error("orchestrator paths are required")
    return orchestrate(args)


if __name__ == "__main__":
    raise SystemExit(main())
