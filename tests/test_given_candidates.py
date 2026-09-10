import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus, TechniqueProfile
from gridsolver.rules.rules import Rule
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import propagate_basic
from gridsolver.solver.solver import solve


@pytest.mark.parametrize("profile", TechniqueProfile)
@pytest.mark.parametrize("candidates", ({2}, {2, 3}, set()))
def test_candidates_excluding_a_given_are_an_unsatisfiable_grid(profile, candidates, monkeypatch):
    monkeypatch.setattr(Grid, "technique_profile", profile)
    grid = Grid(1, 2, max_elem=3)

    class MustNotRun(Rule):
        def apply(self, known, candidates, guarantees=None):
            raise RuntimeError("contradictory givens must stop before applying rules")

    grid.add_rule_checked(MustNotRun(grid, cells=(0, 1)))
    grid[0] = 1
    grid.get_candidates(0).symmetric_difference_update({1} ^ candidates)
    before = grid.deepcopy()

    assert not grid.is_valid
    assert solve(grid, max_sols=1, log_level=-1) == set()
    assert grid == before
    assert AtomicSolver(grid.deepcopy(), [], set()).solve_atomic() is SolveStatus.INVALID
    assert propagate_basic(grid.deepcopy()) is SolveStatus.INVALID


@pytest.mark.parametrize("profile", TechniqueProfile)
def test_expanded_candidates_cannot_branch_away_from_an_existing_given(profile, monkeypatch):
    monkeypatch.setattr(Grid, "technique_profile", profile)
    grid = Grid(1, 2, max_elem=3)
    grid[0] = 1
    grid.get_candidates(0).update({2, 3})

    assert grid.is_valid
    assert {tuple(solution) for solution in solve(grid, log_level=-1)} == {
        (1, 1), (1, 2), (1, 3),
    }
    assert grid.known == (1, 0)
    assert grid.get_candidates(0) == {1, 2, 3}

    mark = grid.trail_mark()
    try:
        assert propagate_basic(grid) is SolveStatus.NONE
        assert grid.get_candidates(0) == {1}
    finally:
        grid.trail_undo(mark)
    assert grid.known == (1, 0)
    assert grid.get_candidates(0) == {1, 2, 3}
