from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time


EXAMPLE_9 = (
    "..29.6......1.83...96.7....9...5....2....9.31.1..8.5"
    "....8...........57.....7...2."
)
WORKERS = 2


def fingerprint(solutions) -> str:
    payload = repr(
        tuple(sorted(tuple(solution) for solution in solutions))
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def macro_factory(case: str):
    from gridsolver.abstract_grids.grid_loading import create_from_str_and_class
    from gridsolver.grid_classes.sudoku import Sudoku

    if case == "loaded4_all":
        grid = Sudoku(2, 2, 2, 2)
        grid.load("12344321........")
        return grid, -1, 4
    if case == "blank4_cap1":
        return Sudoku(2, 2, 2, 2), 1, 1
    if case == "blank4_cap20":
        return Sudoku(2, 2, 2, 2), 20, 20
    if case == "blank4_all":
        return Sudoku(2, 2, 2, 2), -1, 288
    if case == "nonsquare6_cap20":
        grid = Sudoku(3, 2, 2, 3)
        grid.load(
            "123456654321........................",
            row_wise=False,
        )
        return grid, 20, 20
    if case == "example9_first":
        grid = create_from_str_and_class(EXAMPLE_9, Sudoku)
        return grid, 1, 1
    raise ValueError(case)


def worker(mode: str, case: str, label: str) -> dict[str, object]:
    logging.disable(10_000)
    gc.collect()
    started = time.perf_counter()

    if case == "synthetic500":
        from gridsolver.abstract_grids.grid import Grid
        from gridsolver.solver.solve_parallel import solve_parallel_trials
        from gridsolver.solver.solve_threaded import solve_thread_trials

        grid = Grid(1, 1, max_elem=500)
        branches = [(0, value) for value in range(1, 501)]
        if label == "process":
            solutions = solve_parallel_trials(
                grid,
                branches,
                -1,
                WORKERS,
            )
        elif label == "thread":
            solutions = solve_thread_trials(
                grid,
                branches,
                -1,
                WORKERS,
            )
        else:
            raise ValueError(label)
        expected = 500
    else:
        from gridsolver.solver import solver

        grid, max_sols, expected = macro_factory(case)
        kwargs = {
            "log_level": 0,
            "max_sols": max_sols,
            "depth_gate": None,
        }
        if mode == "thread":
            kwargs.update(
                processes=WORKERS,
                parallel_backend=label,
            )
        solutions = solver.solve(grid, **kwargs)

    if len(solutions) != expected:
        raise RuntimeError(
            f"{case}/{label}: expected {expected}, got {len(solutions)}"
        )
    return {
        "seconds": time.perf_counter() - started,
        "digest": fingerprint(solutions),
        "count": len(solutions),
    }


def run_worker(
    directory: Path,
    mode: str,
    case: str,
    label: str,
) -> dict[str, object]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(directory)
    env["PYTHONHASHSEED"] = "0"
    completed = subprocess.run(
        [
            sys.executable,
            __file__,
            "--worker",
            "--mode",
            mode,
            "--case",
            case,
            "--label",
            label,
        ],
        cwd=directory,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def geometric_mean(values: list[float]) -> float:
    return math.exp(sum(math.log(value) for value in values) / len(values))


def write_reports(
    *,
    mode: str,
    results: dict[str, object],
    report: Path,
    json_report: Path,
) -> None:
    json_report.parent.mkdir(parents=True, exist_ok=True)
    json_report.write_text(
        json.dumps(results, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    rows = []
    for name, data in results["cases"].items():
        rows.append(
            "| "
            f"{name} | {data['left_median']:.6f} | "
            f"{data['right_median']:.6f} | "
            f"{data['improvement_percent']:+.2f}% |"
        )
    left_label, right_label = (
        ("Master", "Candidate")
        if mode == "default"
        else ("Process", "Thread")
    )
    gates = results["gates"]
    report.write_text(
        f"# {results['title']}\n\n"
        "All solver runs used `depth_gate=None` and exact deterministic "
        "solution fingerprints. Measurement order alternated by round.\n\n"
        f"| Case | {left_label} seconds | {right_label} seconds | "
        f"{right_label} improvement |\n"
        "|---|---:|---:|---:|\n"
        + "\n".join(rows)
        + "\n\n"
        + "\n".join(f"- {key}: `{value}`" for key, value in gates.items())
        + "\n"
        f"- Verdict: **{'accepted' if results['passed'] else 'rejected'}**\n",
        encoding="utf-8",
    )


def orchestrate(args: argparse.Namespace) -> None:
    if args.mode == "default":
        specs = (
            ("loaded4_all", 5),
            ("blank4_cap20", 2),
            ("nonsquare6_cap20", 2),
            ("example9_first", 5),
        )
        left = ("master", Path(args.baseline).resolve())
        right = ("candidate", Path(args.candidate).resolve())
    else:
        specs = (
            ("synthetic500", 3),
            ("loaded4_all", 5),
            ("blank4_cap1", 3),
            ("blank4_all", 2),
            ("nonsquare6_cap20", 2),
        )
        directory = Path(args.candidate).resolve()
        left = ("process", directory)
        right = ("thread", directory)

    results: dict[str, object] = {
        "title": (
            "Default executor overhead — 2026-08-12"
            if args.mode == "default"
            else "Free-threaded search executor — 2026-08-12"
        ),
        "mode": args.mode,
        "python": sys.version,
        "depth_gate": None,
        "workers": WORKERS,
        "cases": {},
    }

    for case, repeats in specs:
        timings = {left[0]: [], right[0]: []}
        expected_digest = None
        expected_count = None
        for round_index in range(repeats):
            order = (left, right)
            if round_index % 2:
                order = tuple(reversed(order))
            for label, directory in order:
                sample = run_worker(directory, args.mode, case, label)
                digest = sample["digest"]
                count = sample["count"]
                if expected_digest is None:
                    expected_digest = digest
                    expected_count = count
                elif digest != expected_digest or count != expected_count:
                    raise RuntimeError(
                        f"{case}: solution mismatch for {label}"
                    )
                timings[label].append(float(sample["seconds"]))

        left_median = statistics.median(timings[left[0]])
        right_median = statistics.median(timings[right[0]])
        ratio = right_median / left_median
        results["cases"][case] = {
            "left_label": left[0],
            "right_label": right[0],
            "left_seconds": timings[left[0]],
            "right_seconds": timings[right[0]],
            "left_median": left_median,
            "right_median": right_median,
            "right_over_left": ratio,
            "improvement_percent": (1.0 - ratio) * 100.0,
            "digest": expected_digest,
            "count": expected_count,
        }

    cases = results["cases"]
    if args.mode == "default":
        ratios = [data["right_over_left"] for data in cases.values()]
        geomean = geometric_mean(ratios)
        worst = max(ratios)
        results["gates"] = {
            "macro_geomean_ratio": geomean,
            "macro_geomean_max_ratio": 1.01,
            "macro_worst_ratio": worst,
            "macro_worst_max_ratio": 1.03,
        }
        passed = geomean <= 1.01 and worst <= 1.03
    else:
        real_ratios = [
            data["right_over_left"]
            for name, data in cases.items()
            if name != "synthetic500"
        ]
        geomean = geometric_mean(real_ratios)
        worst = max(real_ratios)
        cap_ratio = cases["blank4_cap1"]["right_over_left"]
        results["gates"] = {
            "real_geomean_ratio": geomean,
            "real_geomean_max_ratio": 1.0,
            "real_worst_ratio": worst,
            "real_worst_max_ratio": 1.03,
            "positive_cap_ratio": cap_ratio,
            "positive_cap_max_ratio": 1.03,
            "synthetic_ratio": cases["synthetic500"]["right_over_left"],
        }
        passed = geomean <= 1.0 and worst <= 1.03 and cap_ratio <= 1.03

    results["passed"] = passed
    write_reports(
        mode=args.mode,
        results=results,
        report=Path(args.report),
        json_report=Path(args.json_report),
    )
    print(json.dumps(results["gates"], sort_keys=True))
    if not passed:
        raise SystemExit(f"{args.mode} executor benchmark failed gates")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--mode", choices=("default", "thread"), required=True)
    parser.add_argument("--case")
    parser.add_argument("--label")
    parser.add_argument("--baseline")
    parser.add_argument("--candidate")
    parser.add_argument("--report")
    parser.add_argument("--json-report")
    args = parser.parse_args()
    if args.worker:
        print(json.dumps(worker(args.mode, args.case, args.label)))
    else:
        orchestrate(args)


if __name__ == "__main__":
    main()
