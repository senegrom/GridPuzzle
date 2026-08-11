import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.unique import (
    ElementsAtLeastOnce,
    ElementsAtMostOnce,
    value_presence_guarantees,
)
from gridsolver.solver import solver
from gridsolver.solver.validation import (
    _first_missing_guarantee,
    _group_guarantees,
)


@pytest.mark.parametrize("grid_type", (Hidato, Numbrix))
def test_path_grids_start_with_one_guarantee_per_value(grid_type):
    grid = grid_type(2, 2)
    cells = frozenset(range(grid.len))

    assert grid.guarantees == {
        Guarantee(value, cells, grid.rows, grid.cols)
        for value in range(1, grid.max_elem + 1)
    }
    assert not any(
        isinstance(rule, ElementsAtLeastOnce)
        for rule in grid.rules
    )
    assert sum(
        isinstance(rule, ElementsAtMostOnce)
        for rule in grid.rules
    ) == 1


def test_value_presence_guarantee_families_are_shared_and_bounded():
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


def test_elements_at_least_once_uses_the_same_guarantee_factory():
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


def test_path_guarantees_survive_clone_and_pickle_without_shared_sets():
    grid = Numbrix.from_board(((1, 0), (4, 0)))

    for clone in (grid.deepcopy(), pickle.loads(pickle.dumps(grid))):
        assert clone.guarantees == grid.guarantees
        assert clone.guarantees is not grid.guarantees
        assert not any(
            isinstance(rule, ElementsAtLeastOnce)
            for rule in clone.rules
        )


def test_seeded_path_guarantees_preserve_independent_oracle_solution():
    grid = Numbrix.from_board(((1, 0), (4, 0)))

    assert {tuple(solution) for solution in solver.solve(grid)} == {
        (1, 2, 4, 3)
    }


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
    groups = _group_guarantees(guarantees)
    values = _CountingValues(range(1, 9))

    assert _first_missing_guarantee(groups, values) is None
    assert values.reads == 8


def test_grouped_guarantee_validation_reports_a_missing_value():
    guarantees = value_presence_guarantees(
        range(4),
        max_elem=4,
        rows=1,
        cols=4,
    )
    groups = _group_guarantees(guarantees)

    assert _first_missing_guarantee(groups, (1, 2, 3, 3)) == (
        4,
        frozenset(range(4)),
    )
