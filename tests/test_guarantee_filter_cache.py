import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee, InvalidGrid
from gridsolver.solver.solve_guarantees import (
    filter_guarantees,
    update_from_guarantee,
)


def test_guarantee_filter_grouping_is_cached_and_invalidated():
    grid = Grid(2)
    larger = Guarantee(1, frozenset({0, 1, 2}), 2, 2)
    smaller = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(larger)
    grid.add_gtee_checked(smaller)

    filter_guarantees(grid)
    cache = grid._guarantee_cache
    assert larger in grid.guarantees_ia

    filter_guarantees(grid)
    assert grid._guarantee_cache is cache
    # The first deactivation invalidates the old grouping. With no guarantee
    # additions, the event-driven filter does not rebuild a relation index it
    # has no work for.
    assert "filter_guarantees_by_value" not in grid._guarantee_cache

    grid.add_gtee_checked(
        Guarantee(2, frozenset({2, 3}), 2, 2)
    )
    assert grid._guarantee_cache is cache
    assert not grid._guarantee_cache

    filter_guarantees(grid)
    assert grid._guarantee_cache is cache
    assert set(
        grid._guarantee_cache["filter_guarantees_by_value"]
    ) == {1, 2}


def test_guarantee_update_shrinks_to_eligible_cells():
    grid = Grid(2)
    guarantee = Guarantee(1, frozenset({0, 1, 2}), 2, 2)
    grid.add_gtee_checked(guarantee)
    grid._candidates[0].discard(1)

    update_from_guarantee(grid, guarantee)

    assert guarantee in grid.guarantees_ia
    assert Guarantee(1, frozenset({1, 2}), 2, 2) in grid.guarantees


def test_guarantee_update_assigns_the_only_eligible_cell():
    grid = Grid(2)
    guarantee = Guarantee(1, frozenset({0, 1, 2}), 2, 2)
    grid.add_gtee_checked(guarantee)
    grid[0] = 2
    grid._candidates[1].discard(1)

    update_from_guarantee(grid, guarantee)

    assert grid[2] == 1
    assert grid.get_candidates(2) == {1}
    assert guarantee in grid.guarantees_ia


def test_guarantee_update_rejects_no_eligible_cell():
    grid = Grid(2)
    guarantee = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(guarantee)
    grid._candidates[0].discard(1)
    grid._candidates[1].discard(1)

    with pytest.raises(InvalidGrid):
        update_from_guarantee(grid, guarantee)

    assert not grid.is_valid
