"""Independent oracles for exact cage optimisation and fixed size metadata."""
import copy
import pickle
import random
from collections import deque
from functools import cached_property
from itertools import combinations, combinations_with_replacement, product
from math import factorial, prod

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.cage_loading import _product_target_is_possible
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, InvalidGrid, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import ProdRule, SumAndElementsAtMostOnce
from gridsolver.rules.topology import SingleLoopRule
from gridsolver.solver.propagation import propagate_basic


class _CombinationOracleCage(SumAndElementsAtMostOnce):
    @cached_property
    def sum_candidates(self):
        return tuple(frozenset(values) for values in combinations(
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


def test_partition2_keeps_repetitions_and_detached_deques():
    cls = SumAndElementsAtMostOnce
    for minimum in (1, 2):
        for maximum in range(minimum, minimum + 4):
            for count in range(1, 5):
                options = tuple(combinations_with_replacement(range(minimum, maximum + 1), count))
                for target in range(count * maximum + 2):
                    expected = [deque(values) for values in options if sum(values) == target]
                    assert cls.partition2(target, count, minimum, maximum) == expected
    result = cls.partition2(6, 3, 1, 4)
    result[0].clear()
    assert cls.partition2(6, 3, 1, 4)[0] == deque((1, 1, 4))


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


@pytest.mark.parametrize('factory', (
    lambda: GridSizeContainer(1, 2, 2),
    lambda: ImmutableGrid([1, 2], 1, 2, 2),
    lambda: Grid(1, 2, 2),
    lambda: Sudoku(2, 2, 2, 2),
    lambda: Slitherlink([[None]]),
))
def test_size_metadata_is_write_once_and_not_deletable(factory):
    original = factory()
    for value in (original, copy.copy(original), copy.deepcopy(original),
                  pickle.loads(pickle.dumps(original))):
        size = (value.rows, value.cols, value.max_elem, value.len)
        for attribute in ('rows', 'cols', 'max_elem', 'len'):
            with pytest.raises(AttributeError, match='read-only'):
                setattr(value, attribute, getattr(value, attribute))
            with pytest.raises(AttributeError, match='read-only'):
                setattr(value, attribute, 999)
            with pytest.raises(AttributeError, match='read-only'):
                delattr(value, attribute)
        assert (value.rows, value.cols, value.max_elem, value.len) == size
        with pytest.raises(AttributeError, match='read-only'):
            GridSizeContainer.__init__(value, 4, 5, 6)
        assert (value.rows, value.cols, value.max_elem, value.len) == size


@pytest.mark.parametrize('protocol', (0, pickle.DEFAULT_PROTOCOL, pickle.HIGHEST_PROTOCOL))
def test_solution_hash_and_membership_survive_copy_pickle_and_rejected_mutation(protocol):
    first = ImmutableGrid([1, 2], 1, 2, 2)
    equivalent = ImmutableGrid([1, 2], 1, 2, 2)
    solutions = {first}
    mapping = {first: 'solution'}
    before = hash(first)
    for attribute in ('rows', 'cols', 'max_elem', 'len'):
        with pytest.raises(AttributeError):
            setattr(first, attribute, 3)
    for other in (equivalent, copy.deepcopy(first), pickle.loads(pickle.dumps(first, protocol))):
        assert first == other and hash(other) == before
        assert other in solutions and mapping[other] == 'solution'
        assert len(solutions | {other}) == 1


def test_mutable_grid_still_accepts_values_and_trail_rollback():
    grid = Grid(1, 2, 2)
    mark = grid.trail_mark()
    grid[0] = 1
    grid.trail_undo(mark)
    assert grid.known == (0, 0)
    grid.load([1, 2])
    assert grid.known == (1, 2)


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


def _is_cycle(edges):
    if not edges:
        return False
    adjacency = {}
    for first, second in edges:
        adjacency.setdefault(first, set()).add(second)
        adjacency.setdefault(second, set()).add(first)
    if any(len(neighbours) != 2 for neighbours in adjacency.values()):
        return False
    pending = [next(iter(adjacency))]
    seen = set(pending)
    while pending:
        for neighbour in adjacency[pending.pop()]:
            if neighbour not in seen:
                seen.add(neighbour)
                pending.append(neighbour)
    return len(seen) == len(adjacency)


def test_single_loop_pruning_preserves_every_small_graph_cycle():
    edges = tuple(combinations(range(4), 2))
    size = GridSizeContainer(1, len(edges), 2)
    rule = SingleLoopRule(size, range(len(edges)), edges)
    cycles = tuple(frozenset(i for i, value in enumerate(values) if value)
                   for values in product((False, True), repeat=len(edges))
                   if _is_cycle([edge for edge, value in zip(edges, values) if value]))
    for state in product((0, 1, 2), repeat=len(edges)):
        possible = {i for i, value in enumerate(state) if value != 0}
        selected = {i for i, value in enumerate(state) if value == 2}
        completions = tuple(cycle for cycle in cycles if selected <= cycle <= possible)
        candidates = tuple({1} if value == 0 else {2} if value == 2 else {1, 2} for value in state)
        try:
            rule.apply([0] * len(edges), candidates)
        except InvalidGrid:
            assert not completions
            continue
        except RuleAlwaysSatisfied:
            assert completions
        for cycle in completions:
            assert all((2 if i in cycle else 1) in candidates[i] for i in range(len(edges)))
