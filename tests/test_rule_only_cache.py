from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules


def _populate_rule_only_caches(grid: Grid) -> dict[str, object]:
    grid.get_smallest_candidate_set_gt1()
    _ = grid.unique_rule_cells
    _ = grid.weak_links

    # Consume initial all-rules work, then explicitly wake one watched cell.
    # The second pass must use/build the watcher index without changing any
    # candidates or depending on a rule-specific deduction.
    apply_rules(grid)
    grid._trail_state.dirty.rule_cells.add(0)
    apply_rules(grid)

    assert "propagation_rules_by_cell" in grid._rule_cache
    return dict(grid._rule_cache)


def test_rule_only_caches_survive_guarantee_addition_and_deactivation():
    grid = Grid(2)
    grid.add_rules_checked(
        (
            ElementsAtMostOnce(grid, cells=[0, 1]),
            UneqRule(grid, origin_cell=0, rel_cells=[1, 2]),
        )
    )
    cached = _populate_rule_only_caches(grid)
    cache = grid._rule_cache

    guarantee = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(guarantee)
    assert grid._rule_cache is cache
    assert all(grid._rule_cache[key] is value for key, value in cached.items())

    grid.deactivate_gtee(guarantee)
    assert grid._rule_cache is cache
    assert all(grid._rule_cache[key] is value for key, value in cached.items())


def test_rule_only_caches_invalidate_on_rule_changes():
    grid = Grid(2)
    first = ElementsAtMostOnce(grid, cells=[0, 1])
    second = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rule_checked(first)
    _populate_rule_only_caches(grid)
    cache = grid._rule_cache

    grid.add_rule_checked(second)
    assert grid._rule_cache is cache
    assert not grid._rule_cache

    _populate_rule_only_caches(grid)
    grid.deactivate_rule(first)
    assert grid._rule_cache is cache
    assert not grid._rule_cache


def test_nested_trails_restore_rule_only_cache_objects():
    grid = Grid(2)
    root_value = object()
    grid._rule_cache["root"] = root_value
    root_cache = grid._rule_cache

    outer = grid.trail_mark()
    outer_rule = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(outer_rule)
    assert grid._rule_cache is not root_cache
    outer_value = object()
    grid._rule_cache["outer"] = outer_value
    outer_cache = grid._rule_cache

    inner = grid.trail_mark()
    guarantee = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(guarantee)
    assert grid._rule_cache is outer_cache

    inner_rule = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rule_checked(inner_rule)
    assert grid._rule_cache is not outer_cache
    grid.trail_undo(inner)

    assert grid._rule_cache is outer_cache
    assert grid._rule_cache["outer"] is outer_value
    assert inner_rule not in grid.rules
    assert guarantee not in grid.guarantees

    grid.trail_undo(outer)
    assert grid._rule_cache is root_cache
    assert grid._rule_cache["root"] is root_value
    assert outer_rule not in grid.rules


def test_deepcopy_starts_with_empty_detached_rule_cache():
    grid = Grid(2)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 1]))
    _populate_rule_only_caches(grid)

    clone = grid.deepcopy()

    assert clone._rule_cache == {}
    assert clone._rule_cache is not grid._rule_cache
    assert clone.rules == grid.rules


def test_rule_watcher_identity_survives_guarantee_churn():
    grid = Grid(1, 4, max_elem=3)
    first = ElementsAtMostOnce(grid, cells=[0, 1])
    second = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))
    _populate_rule_only_caches(grid)
    watchers = grid._rule_cache["propagation_rules_by_cell"]

    for value in (1, 2, 3):
        guarantee = Guarantee(value, frozenset({0, 1}), 1, 4)
        grid.add_gtee_checked(guarantee)
        apply_rules(grid)
        assert grid._rule_cache["propagation_rules_by_cell"] is watchers

        grid.deactivate_gtee(guarantee)
        grid._trail_state.dirty.rule_cells.add(0)
        apply_rules(grid)
        assert grid._rule_cache["propagation_rules_by_cell"] is watchers


def test_weak_links_are_symmetric_for_a_single_directional_rule():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(
        UneqRule(grid, origin_cell=0, rel_cells=[1, 2])
    )

    links = grid.weak_links

    assert links[0] == {1, 2}
    assert links[1] == {0}
    assert links[2] == {0}


def test_weak_link_symmetry_survives_cache_and_trail_lifecycles():
    grid = Grid(1, 3, max_elem=3)
    root_rule = UneqRule(grid, origin_cell=0, rel_cells=[1])
    grid.add_rule_checked(root_rule)
    root_links = grid.weak_links
    mark = grid.trail_mark()

    branch_rule = UneqRule(grid, origin_cell=1, rel_cells=[2])
    grid.add_rule_checked(branch_rule)
    branch_links = grid.weak_links
    assert branch_links[1] == {0, 2}
    assert branch_links[2] == {1}

    grid.trail_undo(mark)

    assert grid.weak_links is root_links
    assert grid.weak_links[0] == {1}
    assert grid.weak_links[1] == {0}
    assert not grid.weak_links[2]
