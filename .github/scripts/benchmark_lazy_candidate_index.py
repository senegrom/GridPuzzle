"""Benchmark the lazy dirty-cell candidate index against post-PR #3 master."""

from __future__ import annotations

import argparse
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


def digest_solutions(solutions):
    payload = repr(tuple(tuple(solution) for solution in sorted(solutions, key=tuple))).encode()
    return hashlib.sha256(payload).hexdigest()


if case == "topology_static":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver.candidate_topology import CandidateTopology

    grid = Sudoku()
    for cell, possible in enumerate(grid._candidates):
        possible.difference_update(
            value
            for value in tuple(possible)
            if (cell * 7 + value * 11) % 5 == 0
        )
    CandidateTopology.build(grid)
    started = perf_counter()
    for _ in range(25000):
        CandidateTopology.build(grid)
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": sum(map(len, grid._candidates)),
    }))

elif case == "mutation_before_activation":
    from gridsolver.abstract_grids.grid import Grid

    grid = Grid(9, max_elem=9)
    started = perf_counter()
    for round_index in range(600):
        mark = grid.trail_mark()
        for cell, possible in enumerate(grid._candidates):
            possible.discard(1 + (cell + round_index) % 9)
        grid.trail_undo(mark)
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": sum(map(len, grid._candidates)),
        "digest": hashlib.sha256(
            repr(tuple(map(tuple, grid._candidates))).encode()
        ).hexdigest(),
    }))

elif case == "topology_churn":
    from gridsolver.abstract_grids.grid import Grid
    from gridsolver.solver.candidate_topology import CandidateTopology

    grid = Grid(9, max_elem=9)
    CandidateTopology.build(grid)
    started = perf_counter()
    for round_index in range(600):
        mark = grid.trail_mark()
        for cell in range(0, grid.len, 9):
            grid._candidates[cell].discard(1 + (cell + round_index) % 9)
        CandidateTopology.build(grid)
        grid.trail_undo(mark)
        CandidateTopology.build(grid)
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": sum(map(len, grid._candidates)),
        "digest": hashlib.sha256(
            repr(tuple(map(tuple, grid._candidates))).encode()
        ).hexdigest(),
    }))

elif case == "loaded4":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    started = perf_counter()
    solutions = None
    for _ in range(12):
        grid = Sudoku(2, 2, 2, 2)
        grid.load("12344321........")
        solutions = solver.solve(
            grid,
            log_level=-1,
            depth_gate=None,
        )
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": len(solutions),
        "digest": digest_solutions(solutions),
    }))

elif case == "nonsquare6":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    grid = Sudoku(3, 2, 2, 3)
    grid.load("123456654321........................", row_wise=False)
    started = perf_counter()
    solutions = solver.solve(
        grid,
        max_sols=20,
        log_level=-1,
        depth_gate=None,
    )
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": len(solutions),
        "digest": digest_solutions(solutions),
    }))

elif case == "hard9":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    puzzle = (
        (8, 0, 0, 0, 0, 0, 0, 0, 0),
        (0, 0, 3, 6, 0, 0, 0, 0, 0),
        (0, 7, 0, 0, 9, 0, 2, 0, 0),
        (0, 5, 0, 0, 0, 7, 0, 0, 0),
        (0, 0, 0, 0, 4, 5, 7, 0, 0),
        (0, 0, 0, 1, 0, 0, 0, 3, 0),
        (0, 0, 1, 0, 0, 0, 0, 6, 8),
        (0, 0, 8, 5, 0, 0, 0, 1, 0),
        (0, 9, 0, 0, 0, 0, 4, 0, 0),
    )
    started = perf_counter()
    solutions = None
    for _ in range(4):
        grid = Sudoku()
        grid.load(puzzle, row_wise=True)
        solutions = solver.solve(
            grid,
            max_sols=1,
            log_level=-1,
            depth_gate=None,
        )
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": len(solutions),
        "digest": digest_solutions(solutions),
    }))

elif case == "blank4_all":
    from gridsolver.grid_classes.sudoku import Sudoku
    from gridsolver.solver import solver

    grid = Sudoku(2, 2, 2, 2)
    started = perf_counter()
    solutions = solver.solve(
        grid,
        max_sols=-1,
        log_level=-1,
        depth_gate=None,
    )
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": len(solutions),
        "digest": digest_solutions(solutions),
    }))

elif case in {"hidato", "numbrix", "kakuro", "slitherlink"}:
    from gridsolver.abstract_grids.grid_loading import create_from_file
    from gridsolver.solver import solver

    paths = {
        "hidato": "Examples/Hidato/Mebane/Mebane-III.1-S.clp",
        "numbrix": "Examples/Numbrix/Parade/2012-10-21-Expert-S2.clp",
        "kakuro": "Examples/Kakuro/ATK/10x10-E81712.clp",
        "slitherlink": "Examples/Slitherlink/Puzzle-loop/H5x5/2,580,689-L30.clp",
    }
    started = perf_counter()
    solutions = None
    for _ in range(3):
        grid = create_from_file(paths[case])
        solutions = solver.solve(
            grid,
            max_sols=1,
            log_level=-1,
            depth_gate=None,
        )
    elapsed = perf_counter() - started
    print(json.dumps({
        "seconds": elapsed,
        "cardinality": len(solutions),
        "digest": digest_solutions(solutions),
    }))

else:
    raise SystemExit(case)
'''


REPETITIONS = {
    "topology_static": 5,
    "mutation_before_activation": 7,
    "topology_churn": 5,
    "loaded4": 5,
    "nonsquare6": 3,
    "hard9": 5,
    "blank4_all": 2,
    "hidato": 5,
    "numbrix": 5,
    "kakuro": 5,
    "slitherlink": 3,
}

SOLVER_CASES = (
    "loaded4",
    "nonsquare6",
    "hard9",
    "blank4_all",
    "hidato",
    "numbrix",
    "kakuro",
    "slitherlink",
)

LABELS = {
    "topology_static": "25,000 unchanged topology builds",
    "mutation_before_activation": "600 trail rounds before index activation",
    "topology_churn": "600 dirty-cell topology/rollback rounds",
    "loaded4": "Loaded 4×4 Sudoku, 12 complete solves",
    "nonsquare6": "Non-square 6×6 Sudoku, first 20 solutions",
    "hard9": "Hard 9×9 Sudoku, four first-solution solves",
    "blank4_all": "Blank 4×4 Sudoku, all 288 solutions",
    "hidato": "Hidato representative, three solves",
    "numbrix": "Numbrix representative, three solves",
    "kakuro": "Kakuro representative, three solves",
    "slitherlink": "Slitherlink representative, three solves",
}


def run(root: Path, case: str) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(root)
    environment["PYTHONHASHSEED"] = "0"
    output = subprocess.check_output(
        [sys.executable, "-c", CASE_CODE, case],
        cwd=root,
        env=environment,
        text=True,
        timeout=900,
    )
    return json.loads(output.strip().splitlines()[-1])


def median_result(results: list[dict[str, Any]]) -> float:
    return statistics.median(float(item["seconds"]) for item in results)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--json-report", type=Path, required=True)
    parser.add_argument("--promote-marker", type=Path, required=True)
    arguments = parser.parse_args()

    summary: dict[str, dict[str, Any]] = {}
    solver_ratios: list[float] = []
    individual_solver_changes: list[float] = []

    for case, count in REPETITIONS.items():
        baseline_results: list[dict[str, Any]] = []
        candidate_results: list[dict[str, Any]] = []
        for index in range(count):
            order = (
                (arguments.baseline, baseline_results),
                (arguments.candidate, candidate_results),
            )
            if index % 2:
                order = tuple(reversed(order))
            for root, target in order:
                target.append(run(root, case))

        outcomes = {
            (item.get("cardinality"), item.get("digest"))
            for item in baseline_results + candidate_results
        }
        if len(outcomes) != 1:
            raise SystemExit(
                f"{case}: deterministic outcome mismatch: {sorted(outcomes)!r}"
            )

        baseline_median = median_result(baseline_results)
        candidate_median = median_result(candidate_results)
        ratio = candidate_median / baseline_median
        change = 100 * (ratio - 1)
        if case in SOLVER_CASES:
            solver_ratios.append(ratio)
            individual_solver_changes.append(change)
        summary[case] = {
            "baseline_seconds": [item["seconds"] for item in baseline_results],
            "candidate_seconds": [item["seconds"] for item in candidate_results],
            "baseline_median": baseline_median,
            "candidate_median": candidate_median,
            "change_percent": change,
            "cardinality": baseline_results[0].get("cardinality"),
            "digest": baseline_results[0].get("digest"),
        }

    macro_change = 100 * (
        math.prod(solver_ratios) ** (1 / len(solver_ratios)) - 1
    )
    topology_change = float(summary["topology_static"]["change_percent"])
    churn_change = float(summary["topology_churn"]["change_percent"])
    cold_mutation_change = float(
        summary["mutation_before_activation"]["change_percent"]
    )
    worst_solver_change = max(individual_solver_changes)

    gates = {
        "macro_solver_change_lte_0_75": macro_change <= 0.75,
        "worst_solver_change_lte_4": worst_solver_change <= 4.0,
        "cold_mutation_change_lte_3": cold_mutation_change <= 3.0,
        "static_topology_change_lte_minus_40": topology_change <= -40.0,
        "topology_churn_change_lte_minus_10": churn_change <= -10.0,
    }
    decision = "promote" if all(gates.values()) else "reject"
    if decision == "promote":
        arguments.promote_marker.touch()

    payload = {
        "decision": decision,
        "macro_solver_change_percent": macro_change,
        "worst_solver_change_percent": worst_solver_change,
        "gates": gates,
        "summary": summary,
    }
    arguments.json_report.parent.mkdir(parents=True, exist_ok=True)
    arguments.json_report.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Lazy dirty-cell per-value candidate masks — 2026-08-10",
        "",
        "The index remains absent until a candidate-topology consumer first",
        "requests it. Once active, candidate mutations mark changed cells and",
        "the next topology request updates only those cells. Speculative branches",
        "copy the index on their first synchronization; trail rollback restores",
        "the parent references exactly. All solver comparisons use",
        "`depth_gate=None` and matched deterministic solution fingerprints.",
        "",
        "| Case | Baseline | Candidate | Change |",
        "|---|---:|---:|---:|",
    ]
    for case in REPETITIONS:
        item = summary[case]
        lines.append(
            f"| {LABELS[case]} | {item['baseline_median']:.6f}s | "
            f"{item['candidate_median']:.6f}s | "
            f"{item['change_percent']:+.2f}% |"
        )
    lines.extend(
        (
            "",
            f"Macro solver geomean: **{macro_change:+.2f}%**.",
            f"Worst individual solver case: **{worst_solver_change:+.2f}%**.",
            "",
            "## Gates",
            "",
        )
    )
    for gate, passed in gates.items():
        lines.append(f"- [{'x' if passed else ' '}] `{gate}`")
    lines.extend(("", f"Decision: **{decision}**.", ""))
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
