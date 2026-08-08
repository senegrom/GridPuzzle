from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee
from gridsolver.solver.solve_guarantees import filter_guarantees


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
    assert grid._guarantee_cache["filter_guarantees_by_value"][1] == (
        smaller,
    )

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
