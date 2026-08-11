from itertools import product
from math import prod
from random import Random

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import (
    DiffRule,
    DivRule,
    ProdRule,
    SumAndElementsAtMostOnce,
    SumRule,
)


def _valid_assignments(kind, target, candidates, known):
    domains = tuple(
        (value,) if value else tuple(sorted(possible))
        for value, possible in zip(known, candidates, strict=True)
    )
    valid = []
    for assignment in product(*domains):
        if kind == "sum":
            accepted = sum(assignment) == target
        elif kind == "product":
            accepted = prod(assignment) == target
        elif kind == "difference":
            accepted = abs(assignment[0] - assignment[1]) == target
        elif kind == "division":
            accepted = (
                assignment[0] == assignment[1] * target
                or assignment[1] == assignment[0] * target
            )
        elif kind == "distinct-sum":
            accepted = (
                sum(assignment) == target
                and len(set(assignment)) == len(assignment)
            )
        else:  # pragma: no cover - the fixed table below owns the values
            raise AssertionError(kind)
        if accepted:
            valid.append(assignment)
    return tuple(valid)


def _make_rule(kind, grid, target):
    cells = range(grid.len)
    if kind == "sum":
        return SumRule(grid, cells=cells, mysum=target)
    if kind == "product":
        return ProdRule(grid, cells=cells, target=target)
    if kind == "difference":
        return DiffRule(grid, cells=cells, target=target)
    if kind == "division":
        return DivRule(grid, cells=cells, target=target)
    if kind == "distinct-sum":
        return SumAndElementsAtMostOnce(grid, cells=cells, mysum=target)
    raise AssertionError(kind)  # pragma: no cover


def test_arithmetic_rules_never_remove_an_independently_valid_value():
    specifications = (
        ("sum", 3, range(1, 13), 180),
        ("product", 3, range(1, 65), 70),
        ("difference", 2, range(0, 4), 300),
        ("division", 2, range(1, 5), 300),
        ("distinct-sum", 3, range(1, 13), 180),
    )
    max_elem = 4

    for specification_index, (kind, cell_count, targets, samples) in enumerate(
        specifications
    ):
        grid = Grid(1, cell_count, max_elem=max_elem)
        for target in targets:
            rule = _make_rule(kind, grid, target)
            rng = Random(100_000 * specification_index + target)
            for sample in range(samples):
                candidates = []
                known = []
                for _ in range(cell_count):
                    possible = {
                        value
                        for value in range(1, max_elem + 1)
                        if rng.random() < 0.55
                    }
                    if not possible:
                        possible.add(rng.randint(1, max_elem))
                    candidates.append(possible)
                    known.append(
                        rng.choice(tuple(sorted(possible)))
                        if rng.random() < 0.3
                        else 0
                    )

                completions = _valid_assignments(
                    kind,
                    target,
                    candidates,
                    known,
                )
                after = tuple(set(possible) for possible in candidates)
                working_known = list(known)
                invalid = False
                satisfied = False
                try:
                    rule.apply(working_known, after, ())
                except RuleAlwaysSatisfied:
                    satisfied = True
                except InvalidGrid:
                    invalid = True

                context = (
                    f"kind={kind}, target={target}, sample={sample}, "
                    f"known={known}, before={candidates}, after={after}"
                )
                assert working_known == known, context
                if not completions:
                    assert not satisfied, context
                    continue

                assert not invalid, context
                for cell in range(cell_count):
                    values_used_by_a_completion = {
                        completion[cell] for completion in completions
                    }
                    assert values_used_by_a_completion <= after[cell], context
