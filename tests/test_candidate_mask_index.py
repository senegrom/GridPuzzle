import copy
import pickle

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.path_puzzles import Numbrix
from gridsolver.solver import atomic_solver
from gridsolver.solver.candidate_topology import CandidateTopology


def _recomputed_masks(grid: Grid) -> tuple[int, ...]:
    masks = [0] * (grid.max_elem + 1)
    for cell, possible in enumerate(grid._candidates):
        cell_bit = 1 << cell
        for value in possible:
            masks[value] |= cell_bit
    return tuple(masks)


def _assert_exact(grid: Grid) -> None:
    assert grid.candidate_masks == _recomputed_masks(grid)
    assert grid._trail_state.candidate_mask_dirty == 0


def test_index_is_absent_until_requested():
    grid = Grid(9, max_elem=9)
    grid._candidates[0].discard(1)
    grid._candidates[1].intersection_update({2, 3})

    assert grid._trail_state.candidate_masks is None
    assert grid._trail_state.candidate_value_masks is None
    assert grid._trail_state.candidate_mask_dirty == 0

    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not None


def test_changed_cells_are_coalesced_until_next_consumer():
    grid = Grid(2, max_elem=4)
    _assert_exact(grid)
    original_masks = grid._trail_state.candidate_masks

    grid._candidates[0].discard(1)
    grid._candidates[0].discard(2)
    grid._candidates[0].add(1)
    grid._candidates[3].intersection_update({2, 4})

    assert grid._trail_state.candidate_masks is original_masks
    assert grid._trail_state.candidate_mask_dirty == (1 << 0) | (1 << 3)
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is original_masks


def test_every_trailed_set_mutator_synchronizes_exactly():
    operations = (
        lambda values: values.discard(5),
        lambda values: values.remove(4),
        lambda values: values.difference_update({2, 3}),
        lambda values: values.intersection_update({1, 5}),
        lambda values: values.update({2, 4}),
        lambda values: values.symmetric_difference_update({1, 3}),
        lambda values: values.add(5),
        lambda values: values.pop(),
        lambda values: values.clear(),
    )
    grid = Grid(1, 1, max_elem=5)
    _assert_exact(grid)
    for operation in operations:
        operation(grid._candidates[0])
        _assert_exact(grid)
        grid._candidates[0].update(range(1, 6))
        _assert_exact(grid)


def test_nested_trails_copy_on_first_sync_and_restore_parent_references():
    grid = Grid(2, max_elem=4)
    root_masks = grid.candidate_masks
    root_mask_object = grid._trail_state.candidate_masks
    root_cells_object = grid._trail_state.candidate_value_masks

    outer = grid.trail_mark()
    grid._candidates[0].difference_update({1, 2})
    assert grid._trail_state.candidate_masks is root_mask_object
    _assert_exact(grid)
    outer_mask_object = grid._trail_state.candidate_masks
    assert outer_mask_object is not root_mask_object

    inner = grid.trail_mark()
    grid._candidates[1].intersection_update({2, 3})
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not outer_mask_object

    grid.trail_undo(inner)
    assert grid._trail_state.candidate_masks is outer_mask_object
    _assert_exact(grid)

    grid.trail_undo(outer)
    assert grid._trail_state.candidate_masks is root_mask_object
    assert grid._trail_state.candidate_value_masks is root_cells_object
    assert grid.candidate_masks == root_masks
    _assert_exact(grid)


def test_activation_inside_trail_is_discarded_on_undo():
    grid = Grid(1, 2, max_elem=2)
    mark = grid.trail_mark()
    grid._candidates[0].discard(2)
    _assert_exact(grid)
    assert grid._trail_state.candidate_masks is not None

    grid.trail_undo(mark)
    assert grid._trail_state.candidate_masks is None
    assert grid._trail_state.candidate_value_masks is None
    assert grid._trail_state.candidate_mask_dirty == 0


def test_deepcopy_starts_with_a_detached_inactive_derived_index():
    grid = Grid(2, max_elem=4)
    grid._candidates[0].difference_update({1, 4})
    expected = grid.candidate_masks

    for clone in (grid.deepcopy(), copy.deepcopy(grid)):
        assert clone._trail_state is not grid._trail_state
        assert clone._trail_state.candidate_masks is None
        assert clone.candidate_masks == expected
        clone._candidates[0].add(1)
        _assert_exact(clone)
        assert clone.candidate_masks != grid.candidate_masks


def test_pickle_preserves_an_exact_detached_index():
    grid = Grid(2, max_elem=4)
    grid._candidates[0].difference_update({1, 4})
    expected = grid.candidate_masks

    clone = pickle.loads(pickle.dumps(grid))
    assert clone._trail_state is not grid._trail_state
    assert clone.candidate_masks == expected
    clone._candidates[0].add(1)
    _assert_exact(clone)
    assert clone.candidate_masks != grid.candidate_masks


def test_topology_masks_known_cells_without_mutating_index():
    grid = Grid(1, 2, max_elem=2)
    grid._candidates[0].intersection_update({2})
    before = grid.candidate_masks
    grid[0] = 2

    topology = CandidateTopology.build(grid)

    assert grid.candidate_masks == before
    assert topology.candidate_value_masks[0] == 0  # solved cell masked out
    assert not topology.candidate_masks[2] & 1


def test_rules_only_profile_does_not_activate_candidate_index():
    grid = Numbrix.from_board(((0, 0), (0, 0)))

    assert list(
        atomic_solver.AtomicSolver(grid, [0], set())._solve_power_actions()
    ) == []
    assert grid._trail_state.candidate_masks is None
