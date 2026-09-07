"""Frozen pre-review branch heuristic versus the exact global-scope fast path.

Run from an installed checkout: python scripts/benchmark_branch_pressure.py.
The default three cold microbenchmark samples exclude grid construction. Full
solves use one sample per mode; these timings are indicative, not a statistical
performance gate. Every case compares the actual complete returned solution set.
"""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys
import time

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver


def legacy_branch_choice(self):
    """Frozen implementation from c40a51d4; benchmark/reference use only."""
    def build_branch_peers():
        peers = [set() for _ in range(self.len)]
        for rule in self.rules:
            rule_cells = set(rule.cells)
            for cell in rule.cells:
                peers[cell].update(rule_cells - {cell})
        return tuple(frozenset(items) for items in peers)

    branch_peers = self.cached_rule_struct("branch_peers", build_branch_peers)
    best = None
    for cell, possible in enumerate(self._candidates):
        if len(possible) <= 1:
            continue
        pressure = sum(
            len(possible & self._candidates[peer])
            for peer in branch_peers[cell] if self._known[peer] == 0
        )
        key = (len(possible), -pressure, cell)
        if best is None or key < best[0]:
            best = key, cell, possible
    if best is None:
        raise ValueError("No cell has more than one candidate")
    return best[1], best[2]


def solution_key(solution):
    return solution.rows, solution.cols, solution.max_elem, tuple(solution)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("benchmarks/global_branch_pressure_2026-09-05.json"))
    args = parser.parse_args()
    current = Grid.get_smallest_candidate_set_gt1
    report = {
        "python": sys.version,
        "platform": platform.platform(),
        "baseline": "c40a51d4 branch-choice implementation",
        "micro_samples": 3,
        "solve_samples_per_mode": 1,
        "timing_note": "Single full-solve samples are indicative, not a statistical performance gate.",
        "memory_note": "Peer-cache tuple/frozenset containers only; excludes grid, temporary sets and referenced integers.",
        "microbenchmarks": [],
        "solves": [],
    }
    for size in (10, 20, 30):
        source = Slitherlink([[None] * size for _ in range(size)])
        item = {"board": size, "variables": source.len}
        selections = []
        for label, method in (("before", legacy_branch_choice), ("after", current)):
            samples = []
            for _ in range(3):
                grid = source.deepcopy()
                start = time.perf_counter()
                cell, possible = method(grid)
                samples.append(time.perf_counter() - start)
                cache = grid._rule_cache["branch_peers"]
                container_bytes = sys.getsizeof(cache)
                if cache is not None:
                    container_bytes += sum(sys.getsizeof(peers) for peers in cache)
                selections.append((cell, frozenset(possible)))
            item[label] = {
                "seconds": samples,
                "median_seconds": statistics.median(samples),
                "peer_cache_container_bytes": container_bytes,
            }
        assert len(set(selections)) == 1
        report["microbenchmarks"].append(item)
        print(json.dumps(item), flush=True)

    cases = (
        ("sudoku4-all-288", lambda: Sudoku(2, 2, 2, 2)),
        ("slitherlink2-all", lambda: Slitherlink([[None] * 2 for _ in range(2)])),
        ("slitherlink3-centre-0", lambda: Slitherlink([[None, None, None], [None, 0, None], [None, None, None]])),
        ("numbrix3-endpoints", lambda: Numbrix.from_board([[1, 0, 0], [0, 0, 0], [0, 0, 9]])),
        ("hidato3-endpoints", lambda: Hidato.from_board([[1, 0, 0], [0, 0, 0], [0, 0, 9]])),
    )
    try:
        for name, factory in cases:
            item = {"case": name}
            results = []
            for label, method in (("before", legacy_branch_choice), ("after", current)):
                Grid.get_smallest_candidate_set_gt1 = method
                grid = factory()
                start = time.perf_counter()
                solutions = solver.solve(grid, log_level=-1)
                elapsed = time.perf_counter() - start
                keys = sorted(solution_key(solution) for solution in solutions)
                results.append(keys)
                item[label] = {
                    "seconds": elapsed,
                    "solutions": len(keys),
                    "sha256": hashlib.sha256(repr(keys).encode()).hexdigest(),
                }
            assert results[0] == results[1], name
            report["solves"].append(item)
            print(json.dumps(item), flush=True)
    finally:
        Grid.get_smallest_candidate_set_gt1 = current
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
