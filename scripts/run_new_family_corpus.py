"""Solve retained Hidato, Numbrix, Kakuro, and Slitherlink corpora.

Each puzzle runs in a fresh interpreter with a hard timeout. The parent process
always writes a machine-readable report before returning a non-zero status for
unexpected loader/solver errors and for solution-count regressions
(``unsatisfiable`` or ``multiple`` on the retained unique-solution corpus).
Timeouts and deliberately unsupported historical variants are recorded but do
not fail the run.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any


FAMILY_DIRECTORIES = {
    "hidato": "Hidato",
    "numbrix": "Numbrix",
    "kakuro": "Kakuro",
    "slitherlink": "Slitherlink",
}


def classify_unsupported_variant(path: Path) -> str | None:
    """Return a reason for a deliberately unsupported historical variant.

    The Mebane Slitherlink corpus describes the numbered ``#I.*`` set as the
    standard puzzles and the other series as variants with extra constraints.
    Those extra constraints are not silently discarded and are reported here.
    """
    normalized = path.as_posix()
    if "/Slitherlink/Mebane/" in normalized and not path.name.startswith("#I."):
        return "Mebane non-standard Slitherlink variant with extra constraints"
    return None


def solve_case(path: Path) -> dict[str, Any]:
    """Load and solve one case in the current interpreter."""
    from gridsolver.abstract_grids.csp_rules_loading import (
        create_from_csp_rules_file,
    )
    from gridsolver.solver import solver

    started = time.perf_counter()
    try:
        grid = create_from_csp_rules_file(path)
        solutions = solver.solve(
            grid,
            log_level=-1,
            max_sols=2,
            depth_gate=None,
        )
    except Exception as exc:  # recorded by the corpus harness, not swallowed
        return {
            "path": path.as_posix(),
            "status": "error",
            "seconds": time.perf_counter() - started,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }

    solution_count = len(solutions)
    if solution_count == 0:
        status = "unsatisfiable"
    elif solution_count == 1:
        status = "unique"
    else:
        status = "multiple"
    return {
        "path": path.as_posix(),
        "status": status,
        "seconds": time.perf_counter() - started,
        "solutions_observed": solution_count,
        "grid_type": type(grid).__name__,
        "variables": grid.len,
    }


def run_isolated_case(
    path: Path,
    *,
    timeout_seconds: float,
) -> dict[str, Any]:
    """Run one case in a child interpreter with a hard timeout."""
    unsupported = classify_unsupported_variant(path)
    if unsupported is not None:
        return {
            "path": path.as_posix(),
            "status": "unsupported_variant",
            "reason": unsupported,
            "seconds": 0.0,
        }

    command = (
        sys.executable,
        str(Path(__file__).resolve()),
        "--single",
        str(path),
    )
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {
            "path": path.as_posix(),
            "status": "timeout",
            "seconds": time.perf_counter() - started,
            "timeout_seconds": timeout_seconds,
        }

    if completed.returncode != 0:
        return {
            "path": path.as_posix(),
            "status": "error",
            "seconds": time.perf_counter() - started,
            "error_type": "ChildProcessError",
            "error": completed.stderr.strip() or completed.stdout.strip(),
            "returncode": completed.returncode,
        }
    try:
        result = json.loads(completed.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as exc:
        return {
            "path": path.as_posix(),
            "status": "error",
            "seconds": time.perf_counter() - started,
            "error_type": type(exc).__name__,
            "error": "Child process did not emit a valid JSON result",
            "stdout": completed.stdout[-2000:],
            "stderr": completed.stderr[-2000:],
        }
    return result


def corpus_paths(
    root: Path,
    family: str,
    *,
    shard_index: int = 0,
    shard_count: int = 1,
) -> tuple[Path, ...]:
    """Return one deterministic shard of the requested retained corpus."""
    family_key = family.strip().lower()
    try:
        directory = FAMILY_DIRECTORIES[family_key]
    except KeyError as exc:
        choices = ", ".join(sorted(FAMILY_DIRECTORIES))
        raise ValueError(f"Unknown family {family!r}; choose one of {choices}") from exc
    if shard_count <= 0:
        raise ValueError("shard_count must be positive")
    if not 0 <= shard_index < shard_count:
        raise ValueError("shard_index must lie in 0..shard_count-1")

    corpus_dir = root / "Examples" / directory
    if not corpus_dir.is_dir():
        raise FileNotFoundError(f"Corpus directory {corpus_dir} does not exist")
    paths = tuple(sorted(corpus_dir.rglob("*.clp")))
    shard = tuple(
        path
        for index, path in enumerate(paths)
        if index % shard_count == shard_index
    )
    # a wrong --root or emptied corpus must fail, not report a green no-op
    if not shard:
        raise FileNotFoundError(
            f"No .clp cases in shard {shard_index}/{shard_count} under {corpus_dir}"
        )
    return shard


def run_corpus(
    *,
    root: Path,
    family: str,
    timeout_seconds: float,
    shard_index: int,
    shard_count: int,
    max_cases: int | None = None,
) -> dict[str, Any]:
    paths = corpus_paths(
        root,
        family,
        shard_index=shard_index,
        shard_count=shard_count,
    )
    if max_cases is not None:
        paths = paths[:max_cases]

    started = time.perf_counter()
    cases = [
        run_isolated_case(path, timeout_seconds=timeout_seconds)
        for path in paths
    ]
    counts = Counter(case["status"] for case in cases)
    return {
        "family": family.strip().lower(),
        "shard_index": shard_index,
        "shard_count": shard_count,
        "case_timeout_seconds": timeout_seconds,
        "elapsed_seconds": time.perf_counter() - started,
        "case_count": len(cases),
        "status_counts": dict(sorted(counts.items())),
        "cases": cases,
    }


def _positive_float(raw: str) -> float:
    value = float(raw)
    if value <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return value


def _positive_int(raw: str) -> int:
    value = int(raw)
    if value <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return value


def _non_negative_int(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--single", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--family", choices=tuple(FAMILY_DIRECTORIES))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--case-timeout", type=_positive_float, default=60.0)
    parser.add_argument("--shard-index", type=_non_negative_int, default=0)
    parser.add_argument("--shard-count", type=_positive_int, default=1)
    parser.add_argument("--max-cases", type=_positive_int)
    parser.add_argument("--output", type=Path)
    return parser


def main(argv: list[str] | tuple[str, ...] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.single is not None:
        print(json.dumps(solve_case(args.single), sort_keys=True))
        return 0
    if args.family is None:
        raise SystemExit("--family is required unless --single is used")

    report = run_corpus(
        root=args.root.resolve(),
        family=args.family,
        timeout_seconds=args.case_timeout,
        shard_index=args.shard_index,
        shard_count=args.shard_count,
        max_cases=args.max_cases,
    )
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")

    failing = sum(
        report["status_counts"].get(status, 0)
        for status in ("error", "unsatisfiable", "multiple")
    )
    return 1 if failing else 0


if __name__ == "__main__":
    raise SystemExit(main())
