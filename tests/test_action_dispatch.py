import ast
from pathlib import Path

from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver.atomic_solver import AtomicSolver


def test_power_action_pipeline_does_not_allocate_lambdas():
    path = (
        Path(__file__).resolve().parents[1]
        / "gridsolver/solver/atomic_solver.py"
    )
    tree = ast.parse(path.read_text(encoding="utf-8"))
    method = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and node.name == "_solve_power_actions"
    )
    assert not any(
        isinstance(node, ast.Lambda)
        for node in ast.walk(method)
    )


def test_action_dispatch_forwards_positional_arguments():
    solver = AtomicSolver(Grid(1), [], set())
    seen = []

    def action(first, second):
        seen.append((first, second))

    assert solver._act("test", action, 1, "two") == "test"
    assert seen == [(1, "two")]
