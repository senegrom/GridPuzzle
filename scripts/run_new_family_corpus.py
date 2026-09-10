"""Solve retained Hidato, Numbrix, Kakuro, and Slitherlink corpora.

Each puzzle runs in a fresh interpreter with a hard timeout. Case reports are
written before returning a non-zero status for unexpected errors, solution-count
regressions, unexpected timeouts, or a shard without any uniquely solved case.
Only exact cases in an explicitly supplied, unexpired timeout baseline are
exempt. Invalid configuration fails before launching cases.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path, PurePosixPath
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


def load_timeout_baseline(
    path: Path | None,
    *,
    root: Path,
    timeout_seconds: float,
    today: date | None = None,
) -> frozenset[str]:
    """Read reviewed, exact repository-relative timeout exceptions.

    No baseline means no exceptions. Entries must refer to existing corpus
    files, include a reason, and expire within 31 days of their review. A
    baseline is tied to its measured timeout, so reducing the timeout cannot
    silently reuse an exemption from a different experiment.
    """
    if path is None:
        return frozenset()
    baseline = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(baseline, dict) or type(baseline.get("schema_version")) is not int or baseline["schema_version"] != 1:
        raise ValueError("Timeout baseline must have schema_version 1")
    measured_timeout = baseline.get("case_timeout_seconds")
    if type(measured_timeout) not in (int, float) or not math.isfinite(measured_timeout) or measured_timeout <= 0 or measured_timeout != timeout_seconds:
        raise ValueError("Timeout baseline must match the positive, finite case timeout")
    for field in ("evidence", "reviewed_on", "expires_on"):
        if not isinstance(baseline.get(field), str) or not baseline[field].strip():
            raise ValueError(f"Timeout baseline requires {field}")
    reviewed = date.fromisoformat(baseline["reviewed_on"])
    expires = date.fromisoformat(baseline["expires_on"])
    today = datetime.now(UTC).date() if today is None else today
    if not 0 < (expires - reviewed).days <= 31:
        raise ValueError("Timeout baseline must expire within 31 days of review")
    if not reviewed <= today < expires:
        raise ValueError("Timeout baseline is expired or has a future review date")
    entries = baseline.get("timeouts")
    if not isinstance(entries, list):
        raise ValueError("Timeout baseline timeouts must be a list")
    root = root.resolve()
    allowed: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Timeout baseline entries must be objects")
        raw_path = entry.get("path")
        reason = entry.get("reason")
        if not isinstance(raw_path, str) or not isinstance(reason, str) or not reason.strip():
            raise ValueError("Each timeout baseline entry needs a path and reason")
        relative = PurePosixPath(raw_path)
        if (
            relative.is_absolute()
            or relative.as_posix() != raw_path
            or "\\" in raw_path
            or ".." in relative.parts
            or len(relative.parts) < 3
            or relative.parts[0] != "Examples"
            or relative.parts[1] not in FAMILY_DIRECTORIES.values()
            or relative.suffix != ".clp"
        ):
            raise ValueError(f"Invalid timeout baseline corpus path: {raw_path!r}")
        resolved = (root / raw_path).resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ValueError(f"Timeout baseline case is missing or outside the repository: {raw_path}")
        if classify_unsupported_variant(resolved) is not None:
            raise ValueError(f"Unsupported variants cannot have timeout exemptions: {raw_path}")
        if raw_path in allowed:
            raise ValueError(f"Duplicate timeout baseline case: {raw_path}")
        allowed.add(raw_path)
    return frozenset(allowed)


def report_exit_code(report: dict[str, Any]) -> int:
    """Fail closed on unexpected outcomes and shards with no completed solve."""
    counts = report["status_counts"]
    if counts.get("unique", 0) == 0:
        return 1
    if any(count for status, count in counts.items() if status not in {"unique", "timeout", "unsupported_variant"}):
        return 1
    if report.get("unexpected_timeouts"):
        return 1
    # Reports lacking policy metadata must not silently restore the old
    # blanket timeout exemption. Count every observed timeout exactly once.
    return int(counts.get("timeout", 0) != len(report.get("accepted_timeouts", ())))


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
    timeout_baseline: Path | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Case timeout must be positive and finite")
    if max_cases is not None and (type(max_cases) is not int or max_cases <= 0):
        raise ValueError("max_cases must be a positive integer")
    allowed_timeouts = load_timeout_baseline(
        timeout_baseline, root=root, timeout_seconds=timeout_seconds,
    )
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
    accepted: list[str] = []
    unexpected: list[str] = []
    resolved: list[str] = []
    for path, case in zip(paths, cases, strict=True):
        relative = path.relative_to(root).as_posix()
        # Match the input path controlled by the parent, not a child's JSON
        # path, which must not be able to claim another case's exemption.
        if case["status"] == "timeout":
            (accepted if relative in allowed_timeouts else unexpected).append(relative)
        elif case["status"] == "unique" and relative in allowed_timeouts:
            resolved.append(relative)
    return {
        "family": family.strip().lower(),
        "shard_index": shard_index,
        "shard_count": shard_count,
        "case_timeout_seconds": timeout_seconds,
        "elapsed_seconds": time.perf_counter() - started,
        "case_count": len(cases),
        "status_counts": dict(sorted(counts.items())),
        "accepted_timeouts": accepted,
        "unexpected_timeouts": unexpected,
        "resolved_timeouts": resolved,
        "no_unique_cases": counts.get("unique", 0) == 0,
        "timeout_baseline": None if timeout_baseline is None else str(timeout_baseline),
        "cases": cases,
    }


def _positive_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("must be positive and finite")
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
    parser.add_argument("--timeout-baseline", type=Path, help="Reviewed, expiring per-case timeout exceptions; default: none")
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
        timeout_baseline=args.timeout_baseline,
    )
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")

    return report_exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
