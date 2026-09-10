import sys

import pytest

from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.solver import solver


class _BinaryGrid(Grid):
    technique_profile = TechniqueProfile.RULES_ONLY


def test_deep_search_preserves_the_first_two_solutions_and_caller():
    grid = _BinaryGrid(1, 1024, max_elem=2)
    recursion_limit = sys.getrecursionlimit()

    solutions = solver.solve(grid, max_sols=2, log_level=-1)

    assert {tuple(solution) for solution in solutions} == {
        (1,) * 1024,
        (1,) * 1023 + (2,),
    }
    assert grid.known == (0,) * 1024
    assert all(grid.get_candidates(cell) == {1, 2} for cell in range(grid.len))
    assert sys.getrecursionlimit() == recursion_limit


def test_large_slitherlink_search_returns_one_connected_cycle():
    grid = Slitherlink([[None] * 32 for _ in range(32)])

    solutions = solver.solve(grid, max_sols=1, log_level=-1)

    assert len(solutions) == 1
    # Check the actual edge geometry independently of SingleLoopRule.
    neighbors = {}
    for axis, row, col in grid.selected_edges(next(iter(solutions))):
        first = (row, col)
        second = (row, col + 1) if axis == "H" else (row + 1, col)
        neighbors.setdefault(first, set()).add(second)
        neighbors.setdefault(second, set()).add(first)
    assert neighbors
    assert all(len(adjacent) == 2 for adjacent in neighbors.values())
    pending = [next(iter(neighbors))]
    visited = set(pending)
    while pending:
        for neighbor in neighbors[pending.pop()] - visited:
            visited.add(neighbor)
            pending.append(neighbor)
    assert visited == set(neighbors)
    assert grid.known == (0,) * grid.len


@pytest.mark.parametrize("error_type", (RuntimeError, KeyboardInterrupt))
def test_deep_search_exception_unwinds_every_trial(error_type):
    class FailingGrid(_BinaryGrid):
        def __setitem__(self, cell, value):
            super().__setitem__(cell, value)
            if cell == self.len - 1:
                raise error_type("deep branch failed")

    grid = FailingGrid(1, 1024, max_elem=2)
    steps = [7]
    outer = grid.trail_mark()
    try:
        with pytest.raises(error_type, match="deep branch failed"):
            solver._solve_full(grid, steps, 1, set())

        assert steps == [7]
        assert grid.known == (0,) * grid.len
        assert all(grid.get_candidates(cell) == {1, 2} for cell in range(grid.len))
        assert [frame.token for frame in grid._trail_state.marks] == [outer]
        assert not grid._trail_state.entries
    finally:
        grid.trail_undo(outer)
