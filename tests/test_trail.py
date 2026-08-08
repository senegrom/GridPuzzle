import ast
import pickle
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.trail import TrailedSet
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solve_forcing_chain as forcing_chain_module
from gridsolver.solver import solve_forcing_net as forcing_net_module
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import BranchConsensus, propagate_basic
from gridsolver.solver.solve_nishio import nishio


def _state(grid: Grid):
    return (
        tuple(grid._known),
        tuple(frozenset(possible) for possible in grid._candidates),
        frozenset(grid.rules),
        frozenset(grid.rules_ia),
        frozenset(grid.guarantees),
        frozenset(grid.guarantees_ia),
        grid.has_been_filled,
    )


def test_candidate_mutators_are_fully_reversible():
    grid = Grid(2)
    before = _state(grid)
    mark = grid.trail_mark()
    possible = grid._candidates[0]

    possible.discard(1)
    possible.add(1)
    possible.difference_update({2})
    possible.update({2})
    possible.intersection_update({2})
    possible.symmetric_difference_update({1, 2})
    possible |= {2}
    possible &= {1, 2}
    possible -= {2}
    possible ^= {1, 2}
    possible.pop()
    possible.clear()

    candidate_entries = [
        entry for entry in grid._trail_state.entries if entry[0] == "cand"
    ]
    assert len(candidate_entries) == 1

    grid.trail_undo(mark)
    assert _state(grid) == before
    assert grid._trail_state.entries == []
    assert not grid._trail_state.marks


def test_nested_marks_restore_each_boundary():
    grid = Grid(2)
    possible = grid._candidates[0]
    outer = grid.trail_mark()
    possible.discard(1)
    outer_state = _state(grid)

    inner = grid.trail_mark()
    possible.discard(2)
    grid.trail_undo(inner)
    assert _state(grid) == outer_state

    grid.trail_undo(outer)
    assert possible == {1, 2}


def test_marks_must_be_undone_in_lifo_order():
    grid = Grid(2)
    outer = grid.trail_mark()
    inner = grid.trail_mark()
    with pytest.raises(ValueError, match="LIFO"):
        grid.trail_undo(outer)
    grid.trail_undo(inner)
    grid.trail_undo(outer)


def test_known_rules_and_guarantees_rollback_together():
    grid = Grid(2)
    base_rule = ElementsAtMostOnce(grid, [0, 1])
    added_rule = ElementsAtMostOnce(grid, [2, 3])
    base_guarantee = Guarantee(1, frozenset({0, 1}), grid.rows, grid.cols)
    added_guarantee = Guarantee(2, frozenset({2, 3}), grid.rows, grid.cols)
    grid.add_rule_checked(base_rule)
    grid.add_gtee_checked(base_guarantee)
    before = _state(grid)

    mark = grid.trail_mark()
    grid[0] = 1
    grid.deactivate_rule(base_rule)
    grid.add_rule_checked(added_rule)
    grid.deactivate_gtee(base_guarantee)
    grid.add_gtee_checked(added_guarantee)
    grid.trail_undo(mark)

    assert _state(grid) == before


def test_basic_propagation_can_be_rolled_back_exactly():
    grid = Sudoku(2, 2, 2, 2)
    before = _state(grid)
    mark = grid.trail_mark()
    try:
        grid[0] = 1
        propagate_basic(grid)
        assert _state(grid) != before
    finally:
        grid.trail_undo(mark)
    assert _state(grid) == before


def test_deepcopy_and_pickle_rebind_candidate_journals():
    grid = Grid(2)
    clone = grid.deepcopy()
    restored = pickle.loads(pickle.dumps(grid))

    for candidate_grid in (clone, restored):
        assert all(
            isinstance(possible, TrailedSet)
            for possible in candidate_grid._candidates
        )
        before = _state(candidate_grid)
        mark = candidate_grid.trail_mark()
        candidate_grid._candidates[0].discard(1)
        candidate_grid.trail_undo(mark)
        assert _state(candidate_grid) == before


def test_nishio_uses_trail_instead_of_deepcopy(monkeypatch):
    grid = Grid(2)
    grid[1] = 1
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[1]))

    def fail_deepcopy(self):
        raise AssertionError("Nishio must not deepcopy trial grids")

    monkeypatch.setattr(Grid, "deepcopy", fail_deepcopy)
    nishio(grid)

    assert grid._known[0] == 0
    assert grid._known[1] == 1
    assert grid._candidates[0] == {2}
    assert len(grid.rules) == 1
    assert not grid.rules_ia
    assert grid._trail_state.entries == []


def test_recursive_search_uses_trail_instead_of_deepcopy(monkeypatch):
    grid = Grid(1, 2, max_elem=2)
    before = _state(grid)
    steps: list[int] = []

    def fail_deepcopy(self):
        raise AssertionError("recursive search must not deepcopy branch grids")

    monkeypatch.setattr(Grid, "deepcopy", fail_deepcopy)
    monkeypatch.setattr(
        AtomicSolver,
        "_solve_power_actions",
        lambda self: iter(()),
    )

    solutions = solver._solve_full(grid, steps, 3, set())

    assert len(solutions) == 3
    assert _state(grid) == before
    assert steps == []
    assert grid._trail_state.entries == []
    assert not grid._trail_state.marks



def test_branch_consensus_preserves_candidates_seen_in_any_valid_branch():
    grid = Grid(1, 2, max_elem=2)
    consensus = BranchConsensus()

    for removed in (2, 1):
        mark = grid.trail_mark()
        grid._candidates[1].discard(removed)
        consensus.observe(grid)
        grid.trail_undo(mark)

    assert consensus.branch_count == 2
    assert consensus.forced_value(1) == 0
    assert consensus.common_eliminations(1, grid._candidates[1]) == set()
    assert grid._candidates[1] == {1, 2}


def test_forcing_chain_uses_trail_and_merges_valid_branches(monkeypatch):
    grid = Grid(1, 2, max_elem=2)

    def fail_deepcopy(self):
        raise AssertionError("forcing chain must not deepcopy branch grids")

    def fake_propagation(branch: Grid) -> SolveStatus:
        branch[1] = 2
        return SolveStatus.NONE

    monkeypatch.setattr(Grid, "deepcopy", fail_deepcopy)
    monkeypatch.setattr(
        forcing_chain_module,
        "_propagate_with_techniques",
        fake_propagation,
    )

    forcing_chain_module.forcing_chain(grid)

    assert tuple(grid._known) == (0, 0)
    assert grid._candidates[0] == {1, 2}
    assert grid._candidates[1] == {2}
    assert grid.has_been_filled is False
    assert grid._trail_state.entries == []
    assert not grid._trail_state.marks
    assert not forcing_chain_module._in_forcing_chain


def test_forcing_net_uses_trail_and_merges_valid_branches(monkeypatch):
    grid = Grid(1, 3, max_elem=2)

    def fail_deepcopy(self):
        raise AssertionError("forcing net must not deepcopy branch grids")

    def fake_propagation(branch: Grid) -> SolveStatus:
        branch[2] = 1
        return SolveStatus.NONE

    monkeypatch.setattr(Grid, "deepcopy", fail_deepcopy)
    monkeypatch.setattr(
        forcing_net_module,
        "propagate_basic",
        fake_propagation,
    )

    forcing_net_module.forcing_net(grid)

    assert tuple(grid._known) == (0, 0, 0)
    assert grid._candidates[0] == {1, 2}
    assert grid._candidates[1] == {1, 2}
    assert grid._candidates[2] == {1}
    assert grid.has_been_filled is False
    assert grid._trail_state.entries == []
    assert not grid._trail_state.marks


def test_solver_and_rules_do_not_bypass_known_value_journal():
    root = Path(__file__).resolve().parents[1] / "gridsolver"
    violations: list[str] = []

    for directory in (root / "rules", root / "solver"):
        for path in directory.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    targets = node.targets
                elif isinstance(
                    node,
                    (ast.AnnAssign, ast.AugAssign, ast.NamedExpr),
                ):
                    targets = [node.target]
                elif isinstance(node, ast.Delete):
                    targets = node.targets
                else:
                    continue

                for target in targets:
                    for part in ast.walk(target):
                        if not isinstance(part, ast.Subscript):
                            continue
                        owner = part.value
                        bypasses_journal = (
                            isinstance(owner, ast.Name) and owner.id == "known"
                        ) or (
                            isinstance(owner, ast.Attribute)
                            and owner.attr == "_known"
                        )
                        if bypasses_journal:
                            relative = path.relative_to(root.parent)
                            violations.append(f"{relative}:{part.lineno}")

    assert not violations, (
        "Known values must be changed through Grid.__setitem__ so trail "
        f"rollback can journal them; direct writes: {violations}"
    )
