"""Regressions for custom constraints, pending work, and caller isolation."""
from itertools import product

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import InvalidGrid, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.solver.propagation import apply_rules
from gridsolver.solver.rulehelpers import rulehelper_atmostonce
from gridsolver.solver.solver import solve
from gridsolver.solver.validation import InvalidSolutionError, validate_solution


class _OrderedUneq(UneqRule):
    """A UneqRule extension additionally requiring origin < related."""
    def apply(self, known, candidates, guarantees=None):
        first = known[self.origin_cell]
        second = known[next(iter(self.rel_cells))]
        if first and second and first >= second:
            raise InvalidGrid("The first cell must be smaller")
        return super().apply(known, candidates, guarantees)


def _ordered_grid():
    grid = Grid(1, 3, max_elem=3)
    custom = _OrderedUneq(grid, origin_cell=0, rel_cells=(1,))
    grid.add_rules_checked((custom, UneqRule(grid, origin_cell=0, rel_cells=(2,))))
    return grid, custom


def test_unequal_union_retains_custom_rule_semantics():
    grid, custom = _ordered_grid()
    rulehelper_atmostonce(grid)
    assert custom in grid.rules
    assert custom not in grid.rules_ia


def test_full_solve_returns_the_six_ordered_solutions():
    grid, _ = _ordered_grid()
    expected = {
        values for values in product(range(1, 4), repeat=3)
        if values[0] < values[1] and values[0] != values[2]
    }
    assert len(expected) == 6
    actual = {tuple(solution) for solution in solve(grid, log_level=-1)}
    assert actual == expected


@pytest.mark.parametrize("error_type", (RuntimeError, KeyboardInterrupt))
def test_dirty_rule_selection_failure_preserves_pending_work(error_type):
    grid = Grid(1, 1, max_elem=2)
    armed = [False]
    applied = []

    class TemporaryHashFailure(Rule):
        def __hash__(self):
            if armed[0]:
                raise error_type("temporary hash failure")
            return super().__hash__()

        def apply(self, known, candidates, guarantees=None):
            applied.append(True)
            candidates[0].intersection_update({2})
            return False, None, None

    grid.add_rule_checked(TemporaryHashFailure(grid, cells=(0,)))
    armed[0] = True
    try:
        with pytest.raises(error_type, match="temporary hash failure"):
            apply_rules(grid)
    finally:
        armed[0] = False
    assert applied == []
    apply_rules(grid)
    assert applied == [True]
    assert grid.get_candidates(0) == {2}


@pytest.mark.parametrize("error_type", (RuntimeError, KeyboardInterrupt))
def test_selection_hook_mutations_are_rolled_back(error_type):
    grid = Grid(1, 1, max_elem=2)
    armed = [False]

    class MutatingHash(Rule):
        def __hash__(self):
            if armed[0]:
                grid.get_candidates(0).discard(2)
                raise error_type("selection interrupted")
            return super().__hash__()

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    grid.add_rule_checked(MutatingHash(grid, cells=(0,)))
    before = grid.get_candidates(0).copy()
    armed[0] = True
    try:
        with pytest.raises(error_type, match="selection interrupted"):
            apply_rules(grid)
    finally:
        armed[0] = False
    assert grid.get_candidates(0) == before
    assert not grid._trail_state.marks


@pytest.mark.parametrize("mutation", ("given", "candidate"))
@pytest.mark.parametrize("error_type", (None, RuntimeError, KeyboardInterrupt))
def test_final_validation_preserves_captured_source_grid(mutation, error_type):
    grid = Grid(1, 1, max_elem=2)

    class CapturedSourceMutation(Rule):
        def apply(self, known, candidates, guarantees=None):
            if mutation == "given":
                grid[0] = 2
            else:
                grid.get_candidates(0).discard(2)
            if error_type is not None:
                raise error_type("validation hook interrupted")
            return False, None, None

    grid.add_rule_checked(CapturedSourceMutation(grid, cells=(0,)))
    before = (grid.known, grid.get_candidates(0).copy(), grid.has_been_filled)
    solution = ImmutableGrid((1,), rows=1, cols=1, max_elem=2)
    if error_type is None:
        validate_solution(grid, solution)
    else:
        expected_error = KeyboardInterrupt if error_type is KeyboardInterrupt else InvalidSolutionError
        with pytest.raises(expected_error, match="validation hook interrupted"):
            validate_solution(grid, solution)
    after = (grid.known, grid.get_candidates(0).copy(), grid.has_been_filled)
    assert after == before
    assert not grid._trail_state.marks
