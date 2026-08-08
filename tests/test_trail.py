import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.trail import TrailedSet
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import propagate_basic
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
