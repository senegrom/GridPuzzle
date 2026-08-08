from collections.abc import Sequence
from math import prod

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import InvalidGrid, Rule, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import (
    DiffRule,
    DivRule,
    ProdRule,
    SumAndElementsAtMostOnce,
    SumRule,
)
from gridsolver.rules.uneq import DiffGe2Rule, IneqRule, UneqRule
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


class InvalidSolutionError(RuntimeError):
    """Raised when the solver is about to return a constraint-violating grid."""


def _rule_is_satisfied(rule: Rule, values: Sequence[int], max_elem: int) -> bool:
    cell_values = tuple(values[cell] for cell in rule.cells)

    if isinstance(rule, SumAndElementsAtMostOnce):
        return (
            len(set(cell_values)) == len(cell_values)
            and sum(cell_values) == rule.sum
        )
    if isinstance(rule, ElementsAtMostOnce):
        return len(set(cell_values)) == len(cell_values)
    if isinstance(rule, ElementsAtLeastOnce):
        return set(range(1, max_elem + 1)) <= set(cell_values)
    if isinstance(rule, SumRule):
        return sum(cell_values) == rule.sum
    if isinstance(rule, ProdRule):
        return prod(cell_values) == rule.prod
    if isinstance(rule, DiffRule):
        return abs(cell_values[0] - cell_values[1]) == rule.diff
    if isinstance(rule, DivRule):
        first, second = cell_values
        return first == second * rule.div or second == first * rule.div
    if isinstance(rule, IneqRule):
        return values[rule.lt_cell] < values[rule.gt_cell]
    if isinstance(rule, UneqRule):
        origin = values[rule.origin_cell]
        return all(origin != values[cell] for cell in rule.rel_cells)
    if isinstance(rule, DiffGe2Rule):
        origin = values[rule.origin_cell]
        return all(abs(origin - values[cell]) >= 2 for cell in rule.rel_cells)

    # Extension fallback: exercise the custom rule against singleton candidate
    # sets. Built-in rules are checked independently above, so a bug in their
    # propagation code cannot validate its own incorrect solution.
    known = list(values)
    candidates = tuple({value} for value in values)
    try:
        rule.apply(known, candidates, ())
    except RuleAlwaysSatisfied:
        return True
    except InvalidGrid:
        return False
    return all(candidates)


def validate_solution(source: Grid, solution: ImmutableGrid) -> None:
    """Validate a completed grid against the caller's entire puzzle state."""
    if (
        solution.rows != source.rows
        or solution.cols != source.cols
        or solution.max_elem != source.max_elem
        or len(solution) != len(source)
    ):
        raise InvalidSolutionError("Solution shape or value domain differs from the source grid")

    values = tuple(solution)
    for cell, value in enumerate(values):
        if not 1 <= value <= source.max_elem:
            raise InvalidSolutionError(
                f"Solution value {value} at cell {cell} is outside 1..{source.max_elem}"
            )
        known = source._known[cell]
        if known and value != known:
            raise InvalidSolutionError(
                f"Solution changes given cell {cell} from {known} to {value}"
            )
        if value not in source._candidates[cell]:
            raise InvalidSolutionError(
                f"Solution uses eliminated candidate {value} at cell {cell}"
            )

    for rule in source.rules | source.rules_ia:
        try:
            satisfied = _rule_is_satisfied(rule, values, source.max_elem)
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise InvalidSolutionError(
                f"Cannot validate {type(rule).__name__}: {exc}"
            ) from exc
        if not satisfied:
            raise InvalidSolutionError(
                f"Solution violates {type(rule).__name__}: {rule!r}"
            )

    for guarantee in source.guarantees | source.guarantees_ia:
        if (
            guarantee.rows != source.rows
            or guarantee.cols != source.cols
            or not guarantee.cells
            or not 1 <= guarantee.val <= source.max_elem
            or any(cell < 0 or cell >= len(source) for cell in guarantee.cells)
        ):
            raise InvalidSolutionError(f"Malformed guarantee in source grid: {guarantee!r}")
        if all(values[cell] != guarantee.val for cell in guarantee.cells):
            raise InvalidSolutionError(
                f"Solution violates guarantee {guarantee.val} in {sorted(guarantee.cells)}"
            )


def validate_solutions(source: Grid, solutions: set[ImmutableGrid]) -> None:
    for solution in solutions:
        validate_solution(source, solution)
