from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solve_guarantees as guarantee_module
from gridsolver.solver.propagation import apply_rules, relevant_guarantees
from gridsolver.solver.rulehelpers import rulehelper_atmostonce


class _CountingRule(Rule):
    __slots__ = ()
    calls: list[tuple[int, ...]] = []

    def apply(self, known, candidates, guarantees=None):
        type(self).calls.append(self.cells)
        return False, None, None


class _GuaranteeCountingRule(_CountingRule):
    __slots__ = ()
    uses_guarantees = True


def test_relevant_guarantees_track_guarantee_changes():
    # the min-cell index is cached with the guarantee lifecycle; the per-rule
    # result is built fresh (a per-rule cache measured 55-80% miss), so the
    # contract is content-tracking plus a re-iterable result, not identity
    grid = Grid(2)
    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(rule)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), 2, 2)
    )

    first = relevant_guarantees(grid, rule)
    assert {guarantee.val for guarantee in first} == {1}
    assert list(first) == list(first)  # re-iterable (SaEAMO reads it twice)

    grid.add_gtee_checked(
        Guarantee(2, frozenset({0, 1}), 2, 2)
    )
    refreshed = relevant_guarantees(grid, rule)
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


def test_mrv_ties_prefer_the_cell_with_more_candidate_pressure():
    grid = Grid(2)
    grid.add_rule_checked(UneqRule(grid, 0, [1]))
    grid.add_rule_checked(UneqRule(grid, 0, [2]))

    cell, possible = grid.get_smallest_candidate_set_gt1()

    assert cell == 0
    assert possible == {1, 2}


def test_candidate_changes_only_wake_rules_watching_that_cell():
    grid = Grid(1, 4, max_elem=3)
    first = _CountingRule(grid, cells=[0, 1])
    second = _CountingRule(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))

    _CountingRule.calls = []
    apply_rules(grid)
    assert set(_CountingRule.calls) == {first.cells, second.cells}

    _CountingRule.calls = []
    grid._candidates[0].discard(3)
    apply_rules(grid)

    assert _CountingRule.calls == [first.cells]


def test_new_guarantee_only_wakes_relevant_guarantee_consumers():
    grid = Grid(1, 4, max_elem=3)
    first = _GuaranteeCountingRule(grid, cells=[0, 1])
    second = _GuaranteeCountingRule(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))
    apply_rules(grid)

    _GuaranteeCountingRule.calls = []
    grid.add_gtee_checked(Guarantee(1, frozenset({0}), 1, 4))
    apply_rules(grid)

    assert _GuaranteeCountingRule.calls == [first.cells]


def test_candidate_changes_only_wake_guarantees_watching_that_cell(monkeypatch):
    grid = Grid(1, 4, max_elem=3)
    first = Guarantee(1, frozenset({0, 1}), 1, 4)
    second = Guarantee(2, frozenset({2, 3}), 1, 4)
    grid.add_gtees_checked((first, second))
    guarantee_module.filter_guarantees(grid)

    calls = []
    monkeypatch.setattr(
        guarantee_module,
        "update_from_guarantee",
        lambda _grid, guarantee: calls.append(guarantee),
    )
    grid._candidates[0].discard(3)
    guarantee_module.filter_guarantees(grid)

    assert calls == [first]
