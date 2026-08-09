"""Benchmark complete, deduplicated AIC peer edges against the parent source."""

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
    "aic_dense": 3,
    "blank4_all": 2,
    "nonsquare6_cap20": 2,
    "loaded4_all": 4,
}
MACRO_CASES = ("blank4_all", "nonsquare6_cap20", "loaded4_all")


def _digest(payload: object) -> str:
    return hashlib.sha256(repr(payload).encode()).hexdigest()


def _dense_aic_case() -> tuple[int, str]:
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver.solve_aic import alternating_inference_chain

    base = tuple(
        ((row * 3 + row // 3 + col) % 9) + 1
        for col in range(9)
        for row in range(9)
    )
    shifted = tuple(value % 9 + 1 for value in base)
    grid = Sudoku()
    for cell, possible in enumerate(grid._candidates):
        possible.intersection_update((base[cell], shifted[cell]))

    started = time.perf_counter()
    alternating_inference_chain(grid)
    elapsed = time.perf_counter() - started

    for cell, possible in enumerate(grid._candidates):
        expected = {base[cell], shifted[cell]}
        if not expected <= possible:
            raise SystemExit(
                f"AIC removed an independently valid candidate at cell {cell}"
            )
    payload = tuple(tuple(sorted(possible)) for possible in grid._candidates)
    return elapsed, _digest(payload)


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
    else:
        raise SystemExit(f"unknown solver case {case}")

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
    if case == "aic_dense":
        elapsed, digest = _dense_aic_case()
        result = {
            "case": case,
            "seconds": elapsed,
            "cardinality": 81,
            "digest": digest,
        }
    else:
        elapsed, cardinality, digest = _solver_case(case)
        result = {
            "case": case,
            "seconds": elapsed,
            "cardinality": cardinality,
            "digest": digest,
        }
    print(json.dumps(result, sort_keys=True))
    return 0


def run_sample(script: Path, root: Path, case: str) -> dict[str, object]:
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
    samples: dict[str, dict[str, list[float]]] = {
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
                result = run_sample(script, roots[label], case)
                identity = (int(result["cardinality"]), str(result["digest"]))
                expected_identity = identities.setdefault(case, identity)
                if identity != expected_identity:
                    raise SystemExit(
                        f"{case}: baseline/candidate results differ: "
                        f"{identity} != {expected_identity}"
                    )
                samples[label][case].append(float(result["seconds"]))

    summary: dict[str, dict[str, object]] = {}
    ratios: dict[str, float] = {}
    for case in CASES:
        baseline = statistics.median(samples["baseline"][case])
        candidate = statistics.median(samples["candidate"][case])
        ratio = candidate / baseline
        ratios[case] = ratio
        summary[case] = {
            "baseline_seconds": samples["baseline"][case],
            "candidate_seconds": samples["candidate"][case],
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
        and ratios["aic_dense"] <= 1.05
    )
    payload = {
        "decision": "promote" if promote else "reject",
        "macro_geomean_change_percent": 100 * (macro_geomean - 1),
        "summary": summary,
    }
    args.json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# Complete AIC peer-edge benchmark — 2026-08-09",
        "",
        "The candidate builds same-value AIC weak edges from the shared peer-mask",
        "topology. It emits each unordered edge once, includes explicit UneqRule",
        "relations and partial at-most-once groups, and retains complete-house",
        "strong-link semantics. Depth gating remained disabled.",
        "",
        f"Decision: **{payload['decision']}**.",
        f"Macro geometric-mean change: **{payload['macro_geomean_change_percent']:+.2f}%**.",
        "",
        "Promotion permits at most 0.5% macro geometric-mean regression, no macro",
        "case above 2.5%, and no dense-AIC regression above 5%.",
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
            "Baseline and candidate runs alternated on one Python 3.14 runner.",
            "Every paired run checked exact solution/candidate fingerprints.",
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
            parser.error("--worker-case is required with --worker-root")
        return worker(args.worker_root, args.worker_case)
    required = (args.baseline, args.candidate, args.json, args.report, args.marker)
    if any(value is None for value in required):
        parser.error("orchestrator paths are required")
    return orchestrate(args)


if __name__ == "__main__":
    raise SystemExit(main())
