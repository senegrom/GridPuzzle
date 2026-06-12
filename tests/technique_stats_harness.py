"""Per-technique tries/hits/time statistics over a representative corpus.

Not collected by pytest — run as a script:

    python tests/technique_stats_harness.py [--quick]

Solves each corpus puzzle exactly like the tests do (full enumeration, unique
solution asserted), printing the power-action statistics per puzzle and a
grand total. Used to make data-driven decisions about power-list tiering
(see TODO.md "hit-rate instrumentation").
"""
import sys
import time
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

import examples2
from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str
from gridsolver.solver import atomic_solver, solver
from gridsolver.solver.solver_log import lg as _lg

CORPUS = [
    ("sudoku-mith", lambda: create_from_str(
        "Sudoku::...13.....1...45....2....6.1..3...7.2...5...8.4...6..9.5....7....67...9.....89...")),
    ("sudoku-t-hard", lambda: examples2.get_example(SimpleNamespace(example="t"))),
    ("futoshiki-f", lambda: examples2.get_example(SimpleNamespace(example="f"))),
    ("killer-c", lambda: examples2.get_example(SimpleNamespace(example="c"))),
    ("killer-d", lambda: examples2.get_example(SimpleNamespace(example="d"))),
    ("kenken", lambda: create_from_file(next((_PROJECT_ROOT / "Examples/Kenken").glob("*.pzl")))),
    ("sudoku-16x16", lambda: create_from_file(
        _PROJECT_ROOT / "Examples/Sudoku/16x16/Tarek16x16-W3.sdk", space_sep=True)),
    ("latin-9x9", lambda: create_from_file(
        _PROJECT_ROOT / "Examples/LatinSquares/LatinSquares/9x9-#1-W5.clp")),
    ("pandiagonal-11x11", lambda: create_from_file(
        _PROJECT_ROOT / "Examples/LatinSquares/Pandiagonals/11x11-1to9only-W4.clp")),
]


def run(quick: bool) -> None:
    grand_tries: Counter = Counter()
    grand_hits: Counter = Counter()
    grand_elims: Counter = Counter()
    grand_rulechg: Counter = Counter()
    grand_time: dict = {}

    for name, loader in CORPUS:
        if quick and name == "pandiagonal-11x11":
            print(f"skipping {name} (--quick)")
            continue
        atomic_solver.reset_power_stats()
        t0 = time.perf_counter()
        sols = solver.solve(loader(), log_level=0)
        wall = time.perf_counter() - t0
        assert len(sols) == 1, f"{name}: expected unique solution, got {len(sols)}"
        print(f"\n=== {name}: {len(sols)} solution(s) in {wall:.1f}s ===", flush=True)
        print(atomic_solver.power_stats_table(), flush=True)
        grand_tries.update(atomic_solver.POWER_TRIES)
        grand_hits.update(atomic_solver.POWER_HITS)
        grand_elims.update(atomic_solver.POWER_ELIMS)
        grand_rulechg.update(atomic_solver.POWER_RULE_CHANGES)
        for k, v in _lg.time_stats.items():
            grand_time[k] = grand_time.get(k, 0.0) + v

    atomic_solver.POWER_TRIES.clear()
    atomic_solver.POWER_TRIES.update(grand_tries)
    atomic_solver.POWER_HITS.clear()
    atomic_solver.POWER_HITS.update(grand_hits)
    atomic_solver.POWER_ELIMS.clear()
    atomic_solver.POWER_ELIMS.update(grand_elims)
    atomic_solver.POWER_RULE_CHANGES.clear()
    atomic_solver.POWER_RULE_CHANGES.update(grand_rulechg)
    _lg.time_stats.clear()
    _lg.time_stats.update(grand_time)
    print("\n=== GRAND TOTAL ===", flush=True)
    print(atomic_solver.power_stats_table(), flush=True)


if __name__ == "__main__":
    run(quick="--quick" in sys.argv)
