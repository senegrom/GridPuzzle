import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.path_puzzles import Hidato, Numbrix
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.unique import (
    ElementsAtLeastOnce,
    ElementsAtMostOnce,
    value_presence_guarantees,
)
from gridsolver.solver import propagation, solver
from gridsolver.solver.validation import (
    InvalidSolutionError,
    _first_missing_guarantee,
    _group_guarantees,
    validate_solution,
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


def test_value_presence_guarantee_families_share_immutable_state():
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


def test_value_presence_guarantees_reject_empty_cell_sets():
    with pytest.raises(ValueError, match="at least one cell"):
        value_presence_guarantees(
            (),
            max_elem=1,
            rows=1,
            cols=1,
        )


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
    values = _CountingValues(range(1, 9))

    assert _first_missing_guarantee(
        _group_guarantees(guarantees),
        values,
    ) is None
    assert values.reads == 8


def test_grouped_guarantee_validation_reports_a_missing_value():
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


@pytest.mark.parametrize(
    "bad_guarantee",
    (
        Guarantee(3, frozenset(range(4)), 2, 2),
        Guarantee(2, frozenset(range(4)), 1, 4),
    ),
)
def test_shared_cell_batch_still_validates_each_guarantee_atomically(
    bad_guarantee,
):
    grid = Grid(2)
    cells = frozenset(range(grid.len))

    with pytest.raises(ValueError):
        grid.add_gtees_checked(
            (
                Guarantee(1, cells, grid.rows, grid.cols),
                bad_guarantee,
            )
        )

    assert not grid.guarantees


def test_directly_injected_malformed_guarantee_is_still_rejected():
    grid = Grid(1, 1, max_elem=1)
    grid[0] = 1
    grid.guarantees.add(Guarantee(2, frozenset({0}), 1, 1))
    solution = ImmutableGrid((1,), 1, 1, 1)

    with pytest.raises(
        InvalidSolutionError,
        match="Malformed guarantee in source grid",
    ):
        validate_solution(grid, solution)


class _CountingGrid(Grid):
    def __init__(self, n):
        super().__init__(n)
        self.guarantee_normalizations = 0

    def _normalize_guarantee(
        self,
        guarantee,
        validated_cell_sets=None,
    ):
        self.guarantee_normalizations += 1
        return super()._normalize_guarantee(
            guarantee,
            validated_cell_sets,
        )


class _EmitValueGuarantees(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, (), value_presence_guarantees(
            self.cells,
            max_elem=self._max_elem,
            rows=self._rows,
            cols=self._cols,
        )


def test_rule_emitted_guarantees_are_normalized_once():
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

    watchers = grid._guarantee_cache["propagation_guarantees_by_cell"]
    assert all(len(cell_watchers) == 1 for cell_watchers in watchers)
    packed = watchers[0][0]
    assert set(packed) == set(guarantees)
    assert all(cell_watchers[0] is packed for cell_watchers in watchers)
