"""Temporary correctness and timing harness for worker-root trail reuse."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import pickle
import statistics
import time

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solve_parallel as parallel_module
from gridsolver.solver import solver
from gridsolver.solver.solve_fish import _value_memo


def _state(grid: Grid):
    return (
        tuple(grid._known),
        tuple(frozenset(possible) for possible in grid._candidates),
        frozenset(grid.rules),
        frozenset(grid.rules_ia),
        frozenset(grid.guarantees),
        frozenset(grid.guarantees_ia),
        grid.has_been_filled,
        tuple(grid._trail_state.entries),
        tuple(grid._trail_state.marks),
    )


class _StatefulGrid(Grid):
    def __init__(self) -> None:
        super().__init__(1, 1, max_elem=2)
        self.metadata = ["root"]

    def _copy_extra_state_to(self, result: Grid) -> None:
        result.metadata = list(self.metadata)


def unit_check() -> None:
    root = Grid(1, 1, max_elem=2)
    baseline = _state(root)
    baseline_attrs = frozenset(vars(root))
    parallel_module._init_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )

    first = parallel_module._solve_branch((0, 1, 1, 0))
    second = parallel_module._solve_branch((0, 2, 1, 0))
    assert {tuple(solution) for solution in first} == {(1,)}
    assert {tuple(solution) for solution in second} == {(2,)}
    worker_root = parallel_module._WORKER_ROOT_GRID
    assert worker_root is not None
    assert _state(worker_root) == baseline
    assert frozenset(vars(worker_root)) == baseline_attrs

    candidate_root = Grid(1, 1, max_elem=2)
    candidate_root.get_candidates(0).discard(2)
    parallel_module._init_worker(
        pickle.dumps(candidate_root, protocol=pickle.HIGHEST_PROTOCOL)
    )
    invalid = parallel_module._solve_branch((0, 2, 1, 0))
    assert invalid == set()
    worker_root = parallel_module._WORKER_ROOT_GRID
    assert worker_root is not None
    assert _state(worker_root) == _state(candidate_root)

    original_solve_full = solver._solve_full

    def explode(grid, steps, max_sols, hidden_pair_checked_gts, depth_gate=None):
        grid.get_candidates(0).discard(2)
        grid.add_rule_checked(ElementsAtMostOnce(grid, [0]))
        grid.add_gtee_checked(
            Guarantee(1, frozenset({0}), grid.rows, grid.cols)
        )
        _value_memo(grid)[("branch",)] = ("temporary",)
        grid._temporary_branch_attribute = object()
        raise RuntimeError("intentional branch failure")

    root = Grid(1, 1, max_elem=2)
    parallel_module._init_worker(
        pickle.dumps(root, protocol=pickle.HIGHEST_PROTOCOL)
    )
    worker_root = parallel_module._WORKER_ROOT_GRID
    assert worker_root is not None
    baseline = _state(worker_root)
    baseline_attrs = frozenset(vars(worker_root))
    solver._solve_full = explode
    try:
        try:
            parallel_module._solve_branch((0, 1, 1, 0))
        except RuntimeError as exc:
            assert str(exc) == "intentional branch failure"
        else:
            raise AssertionError("expected the intentional branch failure")
    finally:
        solver._solve_full = original_solve_full
    assert _state(worker_root) == baseline
    assert frozenset(vars(worker_root)) == baseline_attrs

    extension = _StatefulGrid()
    parallel_module._init_worker(
        pickle.dumps(extension, protocol=pickle.HIGHEST_PROTOCOL)
    )
    worker_root = parallel_module._WORKER_ROOT_GRID
    assert worker_root is not None
    assert not parallel_module._worker_root_is_trail_safe(worker_root)

    def mutate_extension(
        grid,
        steps,
        max_sols,
        hidden_pair_checked_gts,
        depth_gate=None,
    ):
        grid.metadata.append("branch")
        return set()

    solver._solve_full = mutate_extension
    try:
        parallel_module._solve_branch((0, 1, 1, 0))
    finally:
        solver._solve_full = original_solve_full
    assert worker_root.metadata == ["root"]
    assert worker_root.known == (0,)


def _run_case(case: str):
    if case == "fanout1000":
        grid = Grid(1, 1, max_elem=1000)
        return parallel_module.solve_parallel_trials(
            grid,
            [(0, value) for value in range(1, 1001)],
            max_sols=-1,
            processes=2,
        )
    if case == "blank4_cap1":
        return solver.solve(
            Sudoku(2, 2, 2, 2),
            log_level=0,
            max_sols=1,
            processes=2,
            depth_gate=None,
        )
    if case == "blank4_all":
        return solver.solve(
            Sudoku(2, 2, 2, 2),
            log_level=0,
            max_sols=-1,
            processes=2,
            depth_gate=None,
        )
    if case == "nonsquare6_cap20":
        grid = Sudoku(3, 2, 2, 3)
        grid.load("123456654321........................", row_wise=False)
        return solver.solve(
            grid,
            log_level=0,
            max_sols=20,
            processes=2,
            depth_gate=None,
        )
    raise ValueError(f"Unknown case {case!r}")


def benchmark(case: str, repeats: int) -> None:
    durations: list[float] = []
    digest: str | None = None
    cardinality: int | None = None
    for _ in range(repeats):
        gc.collect()
        started = time.perf_counter()
        solutions = _run_case(case)
        durations.append(time.perf_counter() - started)
        current_cardinality = len(solutions)
        if cardinality is None:
            cardinality = current_cardinality
        elif current_cardinality != cardinality:
            raise RuntimeError(f"{case}: nondeterministic cardinality")
        payload = repr(sorted(tuple(solution) for solution in solutions)).encode()
        current = hashlib.sha256(payload).hexdigest()
        if digest is None:
            digest = current
        elif current != digest:
            raise RuntimeError(f"{case}: nondeterministic solution set")

    print(
        json.dumps(
            {
                "case": case,
                "cardinality": cardinality,
                "seconds": durations,
                "median": statistics.median(durations),
                "digest": digest,
            },
            sort_keys=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", action="store_true")
    parser.add_argument(
        "--case",
        choices=(
            "fanout1000",
            "blank4_cap1",
            "blank4_all",
            "nonsquare6_cap20",
        ),
    )
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    if args.unit:
        unit_check()
    elif args.case:
        benchmark(args.case, args.repeats)
    else:
        parser.error("choose --unit or --case")


if __name__ == "__main__":
    main()
