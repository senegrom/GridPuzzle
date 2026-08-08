import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce
from gridsolver.rules.uneq import DiffGe2Rule, IneqRule, UneqRule
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce
from gridsolver.solver import solver
from gridsolver.solver.validation import InvalidSolutionError, validate_solution


def test_validator_accepts_returned_solutions():
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")

    solutions = solver.solve(grid, log_level=0, max_sols=2)

    assert len(solutions) == 2
    for solution in solutions:
        validate_solution(grid, solution)


def test_validator_rejects_rule_candidate_and_guarantee_violations():
    unique = Grid(1, 2, max_elem=2)
    unique.add_rule_checked(ElementsAtMostOnce(unique, cells=[0, 1]))
    duplicate_values = ImmutableGrid([1, 1], rows=1, cols=2, max_elem=2)
    with pytest.raises(InvalidSolutionError, match="ElementsAtMostOnce"):
        validate_solution(unique, duplicate_values)

    restricted = Grid(1, 1, max_elem=2)
    restricted.get_candidates(0).discard(2)
    with pytest.raises(InvalidSolutionError, match="eliminated candidate"):
        validate_solution(restricted, ImmutableGrid([2], 1, 1, 2))

    guaranteed = Grid(1, 2, max_elem=2)
    guaranteed.add_gtee_checked(Guarantee(2, frozenset({0}), 1, 2))
    with pytest.raises(InvalidSolutionError, match="violates guarantee"):
        validate_solution(guaranteed, ImmutableGrid([1, 2], 1, 2, 2))


def test_solve_refuses_an_invalid_internal_result(monkeypatch):
    source = Grid(1, 1, max_elem=2)
    source[0] = 1
    invalid = ImmutableGrid([2], 1, 1, 2)

    monkeypatch.setattr(
        solver,
        "_solve_full",
        lambda grid, steps, max_sols, checked: {invalid},
    )

    with pytest.raises(InvalidSolutionError, match="changes given cell"):
        solver.solve(source, log_level=0)


def test_frequent_rule_types_do_not_allocate_instance_dicts():
    grid = Grid(2)
    rules = (
        ElementsAtMostOnce(grid, cells=[0, 1]),
        ElementsAtLeastOnce(grid, cells=[0, 1]),
        IneqRule(grid, gt_cell=1, lt_cell=0),
        UneqRule(grid, origin_cell=0, rel_cells=[1, 2]),
        DiffGe2Rule(grid, origin_cell=0, rel_cells=[1, 2]),
    )

    assert all(not hasattr(rule, "__dict__") for rule in rules)

    # The combined sum/uniqueness rule intentionally keeps a dictionary for
    # cached_property-backed partition caches.
    combined = SumAndElementsAtMostOnce(grid, cells=[0, 1], mysum=3)
    assert hasattr(combined, "__dict__")
    assert combined.sum_candidates


def test_relation_rules_are_order_independent_and_accept_no_guarantee_list():
    grid = Grid(2, max_elem=4)
    first = UneqRule(grid, origin_cell=0, rel_cells=[1, 2])
    second = UneqRule(grid, origin_cell=0, rel_cells=[2, 1])

    assert first == second
    assert hash(first) == hash(second)

    first.apply(grid._known, grid._candidates)
    DiffGe2Rule(grid, origin_cell=0, rel_cells=[1, 2]).apply(
        grid._known,
        grid._candidates,
    )

    with pytest.raises(ValueError, match="at least one related cell"):
        UneqRule(grid, origin_cell=0, rel_cells=[])
