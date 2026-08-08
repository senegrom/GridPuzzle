from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import relevant_guarantees
from gridsolver.solver.rulehelpers import rulehelper_atmostonce


def test_relevant_guarantees_are_cached_until_guarantees_change():
    grid = Grid(2)
    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(rule)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), 2, 2)
    )

    first = relevant_guarantees(grid, rule)
    assert relevant_guarantees(grid, rule) is first

    grid.add_gtee_checked(
        Guarantee(2, frozenset({0, 1}), 2, 2)
    )
    refreshed = relevant_guarantees(grid, rule)
    assert refreshed is not first
    assert {guarantee.val for guarantee in refreshed} == {1, 2}


def test_rulehelper_atmostonce_reaches_a_stable_merged_structure():
    grid = Sudoku(2, 2, 2, 2)
    grid.add_rule_checked(UneqRule(grid, 0, [15]))

    rulehelper_atmostonce(grid)
    origin_zero = [
        rule
        for rule in grid.get_rules_of_type(UneqRule)
        if rule.origin_cell == 0
    ]
    assert len(origin_zero) == 1
    assert 15 in origin_zero[0].rel_cells

    sentinel = grid.cached_struct("sentinel", object)
    cache = grid._struct_cache
    rules = grid.rules.copy()
    rulehelper_atmostonce(grid)

    assert grid.rules == rules
    assert grid._struct_cache is cache
    assert grid._struct_cache["sentinel"] is sentinel
