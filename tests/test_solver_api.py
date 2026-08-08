from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver import solver


def test_solve_does_not_mark_or_mutate_the_caller_grid():
    grid = Grid(1)
    original_candidates = tuple(possible.copy() for possible in grid._candidates)

    solutions = solver.solve(grid, log_level=0)

    assert len(solutions) == 1
    assert not grid.has_been_filled
    assert grid.known == (0,)
    assert grid._candidates == original_candidates

    grid.load("1")
    assert grid.known == (1,)
