import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import rulehelpers


def _warm_grid() -> Grid:
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 1]))
    rulehelpers.rulehelper_atmostonce(grid)
    return grid


def test_stable_helper_returns_before_rescanning_rules(monkeypatch):
    grid = _warm_grid()
    assert grid._rule_cache[rulehelpers._ATMOSTONCE_COMPLETE] is True

    def unexpected_scan(*args, **kwargs):
        raise AssertionError("stable helper must not rescan the rule graph")

    monkeypatch.setattr(Grid, "get_rules_of_type", unexpected_scan)
    rulehelpers.rulehelper_atmostonce(grid)


def test_candidate_known_and_guarantee_churn_preserve_completion(monkeypatch):
    grid = _warm_grid()
    cache = grid._rule_cache
    grid.get_candidates(2).discard(3)
    grid[2] = 1
    grid.add_gtee_checked(Guarantee(2, frozenset({0, 1}), 1, 3))

    assert grid._rule_cache is cache
    assert grid._rule_cache[rulehelpers._ATMOSTONCE_COMPLETE] is True

    def unexpected_scan(*args, **kwargs):
        raise AssertionError("non-rule churn must not re-run materialisation")

    monkeypatch.setattr(Grid, "get_rules_of_type", unexpected_scan)
    rulehelpers.rulehelper_atmostonce(grid)


def test_new_uniqueness_rule_invalidates_and_extends_relations():
    grid = _warm_grid()
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[1, 2]))

    assert rulehelpers._ATMOSTONCE_COMPLETE not in grid._rule_cache

    rulehelpers.rulehelper_atmostonce(grid)

    by_origin = {
        rule.origin_cell: rule.rel_cells
        for rule in grid.get_rules_of_type(UneqRule)
    }
    assert by_origin[0] == frozenset({1})
    assert by_origin[1] == frozenset({0, 2})
    assert by_origin[2] == frozenset({1})
    assert grid._rule_cache[rulehelpers._ATMOSTONCE_COMPLETE] is True


def test_trail_rollback_restores_parent_completion_marker():
    grid = _warm_grid()
    parent_cache = grid._rule_cache
    parent_rules = grid.rules.copy()
    mark = grid.trail_mark()

    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[1, 2]))
    rulehelpers.rulehelper_atmostonce(grid)
    assert grid._rule_cache is not parent_cache
    assert grid._rule_cache[rulehelpers._ATMOSTONCE_COMPLETE] is True

    grid.trail_undo(mark)

    assert grid.rules == parent_rules
    assert grid._rule_cache is parent_cache
    assert grid._rule_cache[rulehelpers._ATMOSTONCE_COMPLETE] is True


def test_interrupted_materialisation_does_not_publish_completion(monkeypatch):
    grid = Grid(1, 2, max_elem=2)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 1]))

    def interrupt(rules):
        raise RuntimeError("test interruption")

    monkeypatch.setattr(grid, "add_rules_checked", interrupt)
    with pytest.raises(RuntimeError, match="interruption"):
        rulehelpers.rulehelper_atmostonce(grid)

    assert rulehelpers._ATMOSTONCE_COMPLETE not in grid._rule_cache
