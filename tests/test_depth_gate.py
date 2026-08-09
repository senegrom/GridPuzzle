import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.solver import atomic_solver
from gridsolver.solver import solve_parallel as parallel_module
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from run import build_parser


@pytest.mark.parametrize(
    ("depth_gate", "error"),
    (
        (True, TypeError),
        (1.5, TypeError),
        ("1", TypeError),
        (-1, ValueError),
    ),
)
def test_depth_gate_rejects_coercive_or_negative_values(depth_gate, error):
    with pytest.raises(error, match="depth_gate"):
        solver.solve(Grid(1), depth_gate=depth_gate)


def test_depth_gate_is_default_off_and_none_is_equivalent():
    assert solver.solve(Grid(1)) == solver.solve(
        Grid(1),
        depth_gate=None,
    )


def test_depth_gate_zero_keeps_full_root_and_gates_only_children(
    monkeypatch,
):
    monkeypatch.setattr(
        AtomicSolver,
        "_act",
        lambda self, label, action, *args: label,
    )

    class _Topology:
        @staticmethod
        def build(grid):
            return object()

    class _Analysis:
        @staticmethod
        def build(grid, topology):
            return object()

    monkeypatch.setattr(atomic_solver, "CandidateTopology", _Topology)
    monkeypatch.setattr(atomic_solver, "ALSAnalysis", _Analysis)

    root = AtomicSolver(Grid(1), [0], set(), depth_gate=0)
    child = AtomicSolver(Grid(1), [0, 0], set(), depth_gate=0)
    root_labels = list(root._solve_power_actions())
    child_labels = list(child._solve_power_actions())

    cheap = [
        "locked_candidate",
        "skyscraper",
        "empty_rectangle",
        "ineq_bounds",
        "rulehelper_atmostonce",
        "rulehelper_sum_atmostonce",
        "rulehelper_house_sums",
        "naked_tuples5",
    ]
    assert root_labels[: len(cheap)] == cheap
    assert "xy_wing" in root_labels
    assert root_labels[-1] == "forcing_net"
    assert child_labels == cheap


def test_parallel_root_forwards_depth_gate(monkeypatch):
    captured = {}

    def fake_atomic(self):
        return SolveStatus.NONE

    def fake_parallel(
        seed,
        branches,
        max_sols,
        processes,
        depth_gate=None,
    ):
        captured.update(
            branches=branches,
            max_sols=max_sols,
            processes=processes,
            depth_gate=depth_gate,
        )
        return set()

    monkeypatch.setattr(solver.AtomicSolver, "solve_atomic", fake_atomic)
    monkeypatch.setattr(
        parallel_module,
        "solve_parallel_trials",
        fake_parallel,
    )

    grid = Grid(1, 1, max_elem=2)
    assert solver._solve_top_parallel(
        grid,
        3,
        2,
        depth_gate=2,
    ) == set()
    assert captured == {
        "branches": [(0, 1), (0, 2)],
        "max_sols": 3,
        "processes": 2,
        "depth_gate": 2,
    }


def test_worker_bundle_forwards_depth_gate_without_expanding_tasks(
    monkeypatch,
):
    monkeypatch.setattr(parallel_module, "_WORKER_ROOT_GRID", None)
    monkeypatch.setattr(parallel_module, "_WORKER_DEPTH_GATE", None)
    captured = {}

    def fake_solve_full(
        grid,
        steps,
        max_sols,
        hidden_pair_checked_gts,
        depth_gate=None,
    ):
        captured["depth_gate"] = depth_gate
        return set()

    monkeypatch.setattr(solver, "_solve_full", fake_solve_full)
    root = Grid(1, 1, max_elem=2)
    parallel_module._init_worker(
        pickle.dumps(
            (root, 2),
            protocol=pickle.HIGHEST_PROTOCOL,
        )
    )

    assert parallel_module._solve_branch((0, 1, 1)) == set()
    assert captured["depth_gate"] == 2
    assert parallel_module._WORKER_DEPTH_GATE == 2


def test_depth_gate_cli_is_explicit_and_default_off():
    parser = build_parser()
    common = ["--str", "1", "--class", "sudoku"]

    default = parser.parse_args(common)
    explicit = parser.parse_args([*common, "--depth-gate", "0"])
    assert default.depth_gate is None
    assert explicit.depth_gate == 0

    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--depth-gate", "-1"])
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--depth-gate", "not-an-int"])
