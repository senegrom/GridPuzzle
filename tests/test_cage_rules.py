"""Sum, product and arithmetic cage rules against independent oracles.

Exact partitions (staircase generation, order preserved), Regin matching
and guarantee deductions, Hall deductions on full-domain cages, product
feasibility, stack safety on large cages, and the rules' public input
validation.
"""

import random
import sys
from functools import cached_property
from itertools import combinations, combinations_with_replacement
from math import factorial, prod

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.grid_classes.cage_loading import _product_target_is_possible
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.rules.rules import Guarantee, InvalidGrid, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import DiffRule, DivRule, ProdRule, SumAndElementsAtMostOnce, SumAndElementsAtMostOnce as Cage, SumRule
from gridsolver.solver.propagation import propagate_basic


class _CombinationOracleCage(SumAndElementsAtMostOnce):
    # apply() consumes the bitmask partitions; sum_candidates decodes them.
    @cached_property
    def _partition_masks(self):
        return tuple(sum(1 << value for value in values) for values in combinations(
            range(1, self._max_elem + 1), self.len_cells
        ) if sum(values) == self.sum)


@pytest.mark.parametrize('maximum', range(1, 10))
def test_staircase_preserves_every_partition_and_its_order(maximum):
    for count in range(1, maximum + 2):
        size = GridSizeContainer(1, count, maximum)
        by_sum = {}
        for values in combinations(range(1, maximum + 1), count):
            by_sum.setdefault(sum(values), []).append(frozenset(values))
        for target in range(count * maximum + 2):
            rule = SumAndElementsAtMostOnce(size, range(count), target)
            assert rule.sum_candidates == tuple(by_sum.get(target, ()))


def _apply_signature(rule, known, candidates, guarantees):
    known = list(known)
    candidates = tuple(set(values) for values in candidates)
    try:
        changed, rules, emitted = rule.apply(known, candidates, guarantees)
    except InvalidGrid:
        return ('invalid',)
    except RuleAlwaysSatisfied:
        return 'satisfied', tuple(known), candidates
    rules = None if rules is None else tuple((type(r).__name__, r.cells, r.sum) for r in rules)
    emitted = None if emitted is None else frozenset(emitted)
    return 'live', tuple(known), candidates, changed, rules, emitted


def test_full_matching_and_guarantee_deductions_equal_independent_partitions():
    # Compare deductions, not just completed solutions: a weaker propagator
    # might preserve solutions but force the caller to do more branching.
    rng = random.Random(20260906)
    for _ in range(300):
        maximum = rng.randint(2, 9)
        count = rng.randint(1, min(maximum, 6))
        size = GridSizeContainer(1, count, maximum)
        target = rng.randrange(count * maximum + 2)
        candidates = tuple({v for v in range(1, maximum + 1) if rng.randrange(3)} or {1}
                           for _ in range(count))
        known = [next(iter(values)) if len(values) == 1 and rng.randrange(2) else 0
                 for values in candidates]
        guarantees = tuple(Guarantee(rng.randint(1, maximum),
                                    frozenset(rng.sample(range(count), rng.randint(1, count))),
                                    1, count) for _ in range(rng.randrange(4)))
        exact = SumAndElementsAtMostOnce(size, range(count), target)
        oracle = _CombinationOracleCage(size, range(count), target)
        assert _apply_signature(exact, known, candidates, guarantees) == _apply_signature(
            oracle, known, candidates, guarantees)


@pytest.mark.parametrize('maximum', (16, 25, 100))
def test_full_domain_cages_keep_hall_deductions_without_branching(maximum):
    grid = Grid(1, maximum, maximum)
    rule = SumAndElementsAtMostOnce(grid, range(maximum), maximum * (maximum + 1) // 2)
    assert rule.sum_candidates == (frozenset(range(1, maximum + 1)),)
    grid.add_rule_checked(rule)
    grid.get_candidates(0).intersection_update((1, 2))
    grid.get_candidates(1).intersection_update((1, 2))
    grid.get_candidates(2).intersection_update((1, 2, 3))
    for cell in range(3, maximum):
        grid.get_candidates(cell).intersection_update(range(4, maximum + 1))
    # No initial singleton exists. Exact matching must force cell 2 to 3.
    # Only basic rule propagation is called: no power actions/backtracking.
    assert propagate_basic(grid) is SolveStatus.NONE
    assert grid[2] == 3
    assert grid.get_candidates(0) == {1, 2}
    assert grid.get_candidates(1) == {1, 2}
    assert all(grid.get_candidates(cell) == set(range(4, maximum + 1))
               for cell in range(3, maximum))


@pytest.mark.parametrize('maximum', range(1, 9))
def test_iterative_product_feasibility_matches_complete_small_oracle(maximum):
    for count in range(5):
        attainable = {prod(values) for values in combinations_with_replacement(range(1, maximum + 1), count)}
        for target in range(maximum ** count + 2):
            assert _product_target_is_possible(count, maximum, target) == (target in attainable)


def test_greedy_product_failure_still_runs_exact_search():
    # Greedy: 8*3*3*3 needs four cells; 6*6*6 fits in three.
    assert _product_target_is_possible(3, 8, 216)
    assert not _product_target_is_possible(2, 8, 216)
    assert _product_target_is_possible(5000, 2, 1)
    assert _product_target_is_possible(2000, 2, 2 ** 2000)
    assert not _product_target_is_possible(625, 25, 29)


@pytest.mark.parametrize('side', (20, 25))
def test_large_valid_product_cages_load_without_recursion(side):
    target = factorial(side) ** side
    grid = Kenken(None, side)
    grid.load('a' * (side * side) + ':a*' + str(target))
    cages = [rule for rule in grid.rules if isinstance(rule, ProdRule)]
    assert len(cages) == 1
    assert cages[0].prod == target
    assert cages[0].len_cells == side * side


# Stack safety on large cages. The partitions themselves are checked against
# ordered combinations in test_partition_memory.py and by
# test_staircase_preserves_every_partition_and_its_order above.
@pytest.mark.parametrize("count", (1000, 2500))
def test_large_near_extreme_partition_has_no_recursion(count):
    grid = GridSizeContainer(1, count, max_elem=count + 1)
    cage = Cage(grid, range(count), count * (count + 1) // 2 + 1)
    assert cage.sum_candidates == (frozenset((*range(1, count), count + 1)),)


def test_full_large_cage_matching_is_stack_safe():
    # One exact full-domain partition, but candidate edges form an
    # alternating cycle whose final augmenting path is longer than a
    # deliberately lowered recursion limit. The former recursive
    # matcher failed here even though partition generation was iterative.
    count = 400
    grid = GridSizeContainer(1, count, max_elem=count)
    cage = Cage(grid, range(count), count * (count + 1) // 2)
    values = cage.sum_candidates[0]
    order = list(values)
    candidates = tuple(
        [{order[0], order[-1]}]
        + [{order[index - 1], order[index]} for index in range(1, count)]
    )
    known = [0] * count

    original_limit = sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(250)
        changed, replacement_rules, guarantees = cage.apply(
            known,
            candidates,
            (),
        )
    finally:
        sys.setrecursionlimit(original_limit)

    assert changed is False
    assert replacement_rules is None
    assert len(guarantees) == count
    assert all(len(possible) == 2 for possible in candidates)


def test_arithmetic_rule_targets_and_symmetric_identity_are_canonical():
    grid_size = GridSizeContainer(1, 2, max_elem=4)

    with pytest.raises(TypeError, match="integers"):
        SumRule(grid_size, cells=[0, 1], mysum=1.5)
    with pytest.raises(TypeError, match="integers"):
        ProdRule(grid_size, cells=[0, 1], target=True)
    with pytest.raises(TypeError, match="integers"):
        DiffRule(grid_size, cells=[0, 1], target="1")
    with pytest.raises(TypeError, match="integers"):
        DivRule(grid_size, cells=[0, 1], target=2.0)
    with pytest.raises(ValueError, match="positive"):
        ProdRule(grid_size, cells=[0, 1], target=0)

    forward_diff = DiffRule(grid_size, cells=[0, 1], target=1)
    reverse_diff = DiffRule(grid_size, cells=[1, 0], target=1)
    forward_div = DivRule(grid_size, cells=[0, 1], target=2)
    reverse_div = DivRule(grid_size, cells=[1, 0], target=2)

    assert forward_diff == reverse_diff
    assert hash(forward_diff) == hash(reverse_diff)
    assert forward_div == reverse_div
    assert hash(forward_div) == hash(reverse_div)


def test_division_rule_does_not_accept_a_rounded_float_ratio():
    base = 2 ** 60
    almost_three_times = 3 * base + 1
    rule = DivRule(GridSizeContainer(1, 2, almost_three_times), cells=[0, 1], target=3)
    candidates = ({almost_three_times}, {base})

    with pytest.raises(InvalidGrid):
        rule.apply([almost_three_times, base], candidates)


def test_arithmetic_rules_validate_public_inputs():
    grid_size = GridSizeContainer(1, 2, 2)
    with pytest.raises(ValueError, match="positive"):
        DivRule(grid_size, cells=[0, 1], target=0)
    with pytest.raises(ValueError, match="exactly two"):
        DivRule(grid_size, cells=[0], target=2)
    with pytest.raises(ValueError, match="non-negative"):
        DiffRule(grid_size, cells=[0, 1], target=-1)
