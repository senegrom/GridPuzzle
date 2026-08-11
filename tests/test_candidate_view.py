import ast
from collections.abc import MutableSet
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid


INVALID_VALUES = (True, False, 0, -1, 5, 1.5, "2", None)


def _assert_untouched(grid, mark, before, masks, dirty, token):
    assert grid.get_candidates(0) == before
    assert grid._trail_state.entries == []
    assert grid._trail_state.candidate_masks is masks
    assert grid._trail_state.candidate_mask_dirty == dirty
    assert grid._trail_state.candidate_index_token == token
    grid.trail_undo(mark)


@pytest.mark.parametrize("method", ("add", "discard", "remove"))
@pytest.mark.parametrize("value", INVALID_VALUES)
def test_public_candidate_single_value_mutators_reject_invalid_inputs(
    method, value
):
    grid = Grid(1, 1, max_elem=4)
    grid.candidate_masks
    view = grid.get_candidates(0)
    before = view.copy()
    masks = grid._trail_state.candidate_masks
    dirty = grid._trail_state.candidate_mask_dirty
    token = grid._trail_state.candidate_index_token
    mark = grid.trail_mark()

    with pytest.raises((TypeError, ValueError)):
        getattr(view, method)(value)

    _assert_untouched(grid, mark, before, masks, dirty, token)


@pytest.mark.parametrize(
    "method, args",
    (
        ("update", ((2, 5),)),
        ("difference_update", ((2, False),)),
        ("intersection_update", ((1, "2"),)),
        ("symmetric_difference_update", ((2, 0),)),
    ),
)
def test_public_candidate_bulk_mutators_validate_atomically(method, args):
    grid = Grid(1, 1, max_elem=4)
    grid.candidate_masks
    view = grid.get_candidates(0)
    before = view.copy()
    masks = grid._trail_state.candidate_masks
    dirty = grid._trail_state.candidate_mask_dirty
    token = grid._trail_state.candidate_index_token
    mark = grid.trail_mark()

    with pytest.raises((TypeError, ValueError)):
        getattr(view, method)(*args)

    _assert_untouched(grid, mark, before, masks, dirty, token)


def test_public_candidate_view_preserves_live_set_operations():
    grid = Grid(1, 1, max_elem=4)
    view = grid.get_candidates(0)

    assert isinstance(view, MutableSet)
    assert view == {1, 2, 3, 4}
    assert view != {True, 2, 3, 4}
    assert view.copy() == {1, 2, 3, 4}
    assert view & {2, 5} == {2}
    assert {2, 5} & view == {2}
    assert view | {4} == {1, 2, 3, 4}
    assert view - {1, 3} == {2, 4}
    assert {1, 5} - view == {5}
    assert view ^ {3, 4} == {1, 2}
    assert True not in view
    assert 0 not in view

    view &= {1, 2, 3}
    view -= {3}
    view |= {4}
    view ^= {2, 3}
    assert view == {1, 3, 4}
    assert grid._candidates[0] == {1, 3, 4}


def test_public_candidate_view_remains_live_across_trail_rollback():
    grid = Grid(1, 1, max_elem=4)
    view = grid.get_candidates(0)
    mark = grid.trail_mark()
    view.discard(4)
    assert view == {1, 2, 3}
    grid.trail_undo(mark)
    assert view == {1, 2, 3, 4}


def test_solver_sources_do_not_use_public_candidate_view_in_hot_paths():
    solver_root = Path(__file__).resolve().parents[1] / "gridsolver" / "solver"
    offenders = []
    for path in solver_root.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get_candidates"
            for node in ast.walk(tree)
        ):
            offenders.append(path.name)
    assert offenders == []
