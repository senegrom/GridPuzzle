import copy
import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.rule_container import RuleContainer


def _assert_index_exact(grid: Grid) -> None:
    expected = [0] * (grid.max_elem + 1)
    for cell, possible in enumerate(grid._candidates):
        bit = 1 << cell
        for value in possible:
            expected[value] |= bit
    assert grid.candidate_masks == tuple(expected)


@pytest.mark.parametrize("value", (0, -1, 5))
def test_candidate_add_rejects_values_outside_the_grid_domain(value):
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    before = possible.copy()

    with pytest.raises(ValueError, match=r"outside 1\.\.4"):
        possible.add(value)

    assert possible == before


@pytest.mark.parametrize("value", (True, False, 1.5, "2", None))
def test_candidate_add_rejects_non_integer_values(value):
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    before = possible.copy()

    with pytest.raises(TypeError, match="Candidate values must be integers"):
        possible.add(value)

    assert possible == before


def test_bulk_candidate_additions_validate_atomically():
    grid = Grid(1, 1, max_elem=4)
    possible = grid.get_candidates(0)
    possible.intersection_update({1})

    with pytest.raises(ValueError, match=r"outside 1\.\.4"):
        possible.update((2, 5))
    assert possible == {1}

    with pytest.raises(TypeError, match="Candidate values must be integers"):
        possible.symmetric_difference_update((2, False))
    assert possible == {1}


def test_candidate_domain_survives_clone_deepcopy_and_pickle():
    grid = Grid(1, 1, max_elem=4)
    clones = (grid.deepcopy(), copy.deepcopy(grid), pickle.loads(pickle.dumps(grid)))
    for clone in clones:
        possible = clone.get_candidates(0)
        with pytest.raises(ValueError, match=r"outside 1\.\.4"):
            possible.add(5)
        with pytest.raises(TypeError, match="Candidate values must be integers"):
            possible.add(True)
        assert possible == {1, 2, 3, 4}


def test_rejected_candidate_mutation_preserves_active_index_and_trail():
    grid = Grid(1, 1, max_elem=4)
    _assert_index_exact(grid)
    masks = grid._trail_state.candidate_masks
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match=r"outside 1\.\.4"):
        grid.get_candidates(0).update((2, 5))

    assert grid._trail_state.entries == []
    assert grid._trail_state.candidate_masks is masks
    assert grid._trail_state.candidate_mask_dirty == 0
    _assert_index_exact(grid)
    grid.trail_undo(mark)


def test_rule_container_equality_is_type_symmetric():
    class ExtendedRuleContainer(RuleContainer):
        pass

    base = RuleContainer()
    extended = ExtendedRuleContainer()

    assert (base == extended) is False
    assert (extended == base) is False
    assert (base != extended) is True
    assert (extended != base) is True
