import copy
from itertools import permutations
import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule
from gridsolver.rules.topology import ConsecutiveAdjacencyRule
from gridsolver.rules.unique import (
    ElementsAtLeastOnce,
    ElementsAtMostOnce,
    value_presence_guarantees,
)
from gridsolver.solver import propagation, solver
from gridsolver.solver.solve_guarantees import filter_guarantees
from gridsolver.solver.validation import (
    InvalidSolutionError,
    _first_missing_guarantee,
    _group_guarantees,
    validate_solution,
)


def _path_oracle(rows: int, cols: int) -> set[tuple[int, ...]]:
    keys = tuple(
        (row, col)
        for row in range(rows)
        for col in range(cols)
    )
    result: set[tuple[int, ...]] = set()
    for values in permutations(range(1, len(keys) + 1)):
        positions = {
            value: keys[cell]
            for cell, value in enumerate(values)
        }
        if all(
            abs(positions[value][0] - positions[value + 1][0])
            + abs(positions[value][1] - positions[value + 1][1])
            == 1
            for value in range(1, len(keys))
        ):
            result.add(values)
    return result


@pytest.mark.parametrize("grid_type", (Hidato, Numbrix))
def test_path_grids_start_with_one_presence_guarantee_per_value(grid_type):
    grid = grid_type(2, 2)
    cells = frozenset(range(grid.len))

    assert grid.guarantees == {
        Guarantee(value, cells, grid.rows, grid.cols)
        for value in range(1, grid.max_elem + 1)
    }
    assert not grid.guarantees_ia
    assert len({id(guarantee.cells) for guarantee in grid.guarantees}) == 1

    assert not any(
        isinstance(rule, ElementsAtLeastOnce)
        for rule in grid.rules
    )
    assert sum(
        type(rule) is ElementsAtMostOnce
        for rule in grid.rules
    ) == 1
    assert sum(
        type(rule) is ConsecutiveAdjacencyRule
        for rule in grid.rules
    ) == 1


def test_path_rules_remain_independent_constraints_and_validators():
    grid = Numbrix(2, 2)
    at_most_once = next(
        rule
        for rule in grid.rules
        if type(rule) is ElementsAtMostOnce
    )
    path_rule = next(
        rule
        for rule in grid.rules
        if type(rule) is ConsecutiveAdjacencyRule
    )

    assert not isinstance(path_rule, ElementsAtMostOnce)
    with pytest.raises(InvalidGrid):
        at_most_once.apply(
            [1, 1, 0, 0],
            tuple({1, 2, 3, 4} for _ in range(4)),
        )
    with pytest.raises(InvalidGrid):
        path_rule.apply(
            [1, 0, 0, 2],
            tuple({1, 2, 3, 4} for _ in range(4)),
        )


def test_value_presence_families_share_cached_immutable_state():
    first = value_presence_guarantees(
        range(4),
        max_elem=4,
        rows=1,
        cols=4,
    )
    second = value_presence_guarantees(
        (3, 2, 1, 0),
        max_elem=4,
        rows=1,
        cols=4,
    )

    assert first is second
    assert all(guarantee.cells is first[0].cells for guarantee in first)


@pytest.mark.parametrize(
    "call",
    (
        lambda: value_presence_guarantees(
            (),
            max_elem=1,
            rows=1,
            cols=1,
        ),
        lambda: value_presence_guarantees(
            (True,),
            max_elem=1,
            rows=1,
            cols=1,
        ),
        lambda: value_presence_guarantees(
            (1,),
            max_elem=1,
            rows=1,
            cols=1,
        ),
    ),
)
def test_value_presence_factory_rejects_malformed_cell_families(call):
    with pytest.raises((TypeError, ValueError)):
        call()


def test_elements_at_least_once_reuses_the_presence_factory():
    grid = Grid(2)
    rule = ElementsAtLeastOnce(grid, cells=range(grid.len))
    changed, replacement_rules, guarantees = rule.apply(
        grid._known,
        grid._candidates,
    )

    assert changed is False
    assert replacement_rules == ()
    assert guarantees is value_presence_guarantees(
        rule.cells,
        max_elem=grid.max_elem,
        rows=grid.rows,
        cols=grid.cols,
    )


def test_path_clones_preserve_guarantees_and_shared_topology():
    source = Numbrix(2, 2)

    for clone in (
        source.deepcopy(),
        copy.deepcopy(source),
        pickle.loads(pickle.dumps(source)),
    ):
        assert clone.guarantees == source.guarantees
        assert clone.guarantees is not source.guarantees
        assert not any(
            isinstance(rule, ElementsAtLeastOnce)
            for rule in clone.rules
        )
        path_rule = next(
            rule
            for rule in clone.rules
            if type(rule) is ConsecutiveAdjacencyRule
        )
        assert clone.adjacency is path_rule.adjacency


def test_path_presence_guarantees_propagate_before_any_rule_pass():
    grid = Numbrix(2, 2)
    for cell in (1, 2, 3):
        grid._candidates[cell].discard(1)

    filter_guarantees(grid)

    assert grid[0] == 1
    assert not any(
        guarantee.val == 1
        for guarantee in grid.guarantees
    )


def test_seeded_numbrix_matches_independent_blank_2x3_oracle():
    expected = _path_oracle(2, 3)
    grid = Numbrix(2, 3)
    actual = {
        tuple(solution)
        for solution in solver.solve(
            grid,
            max_sols=-1,
            log_level=-1,
            depth_gate=None,
        )
    }

    assert len(expected) == 16
    assert actual == expected


def test_malformed_presence_batch_is_atomic():
    grid = Grid(2)
    cells = frozenset(range(grid.len))

    with pytest.raises(ValueError, match="dimensions"):
        grid.add_gtees_checked(
            (
                Guarantee(1, cells, grid.rows, grid.cols),
                Guarantee(2, cells, 1, 4),
            )
        )

    assert not grid.guarantees


class _CountingGrid(Grid):
    def __init__(self, n: int) -> None:
        super().__init__(n)
        self.guarantee_normalizations = 0

    # Deliberately retain the historical one-argument extension signature.
    def _normalize_guarantee(self, guarantee):
        self.guarantee_normalizations += 1
        return super()._normalize_guarantee(guarantee)


class _EmitValueGuarantees(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, (), value_presence_guarantees(
            self.cells,
            max_elem=self._max_elem,
            rows=self._rows,
            cols=self._cols,
        )


def test_rule_emitted_guarantees_are_normalized_once_via_legacy_hook():
    grid = _CountingGrid(2)
    grid.add_rule_checked(_EmitValueGuarantees(grid, range(grid.len)))

    propagation.apply_rules(grid)

    assert grid.guarantee_normalizations == grid.max_elem
    assert len(grid.guarantees) == grid.max_elem


def test_shared_cell_guarantees_use_one_packed_watcher_family():
    grid = Grid(2)
    guarantees = value_presence_guarantees(
        range(grid.len),
        max_elem=grid.max_elem,
        rows=grid.rows,
        cols=grid.cols,
    )
    grid.add_gtees_checked(guarantees)

    assert set(grid.take_dirty_guarantees()) == set(guarantees)
    grid._candidates[0].discard(grid.max_elem)
    assert set(grid.take_dirty_guarantees()) == set(guarantees)

    groups, by_cell = grid._guarantee_cache[
        "propagation_guarantee_watchers"
    ]
    assert len(groups) == 1
    assert set(groups[0]) == set(guarantees)
    assert all(cell_watchers == (0,) for cell_watchers in by_cell)


class _CountingValues:
    def __init__(self, values):
        self._values = tuple(values)
        self.reads = 0

    def __getitem__(self, index):
        self.reads += 1
        return self._values[index]


def test_shared_cell_guarantees_validate_with_one_cell_scan():
    guarantees = value_presence_guarantees(
        range(8),
        max_elem=8,
        rows=1,
        cols=8,
    )
    values = _CountingValues(range(1, 9))

    assert _first_missing_guarantee(
        _group_guarantees(guarantees),
        values,
    ) is None
    assert values.reads == 8


def test_grouped_guarantee_validation_reports_missing_value():
    guarantees = value_presence_guarantees(
        range(4),
        max_elem=4,
        rows=1,
        cols=4,
    )

    assert _first_missing_guarantee(
        _group_guarantees(guarantees),
        (1, 2, 3, 3),
    ) == (4, frozenset(range(4)))


def test_subset_guarantee_remains_an_independent_final_check():
    grid = Grid(1, 2, max_elem=2)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=(0, 1)))
    grid.add_gtee_checked(Guarantee(1, frozenset({0}), 1, 2))

    with pytest.raises(InvalidSolutionError, match="violates guarantee"):
        validate_solution(
            grid,
            ImmutableGrid((2, 1), 1, 2, 2),
        )


def test_directly_injected_malformed_guarantee_is_still_rejected():
    grid = Grid(1, 1, max_elem=1)
    grid[0] = 1
    grid.guarantees.add(Guarantee(2, frozenset({0}), 1, 1))

    with pytest.raises(
        InvalidSolutionError,
        match="Malformed guarantee in source grid",
    ):
        validate_solution(
            grid,
            ImmutableGrid((1,), 1, 1, 1),
        )
