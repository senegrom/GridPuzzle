"""Branch choice: MRV with peer pressure and the implicit global peer scope.

Implicit global peers reproduce the exact explicit branch order, follow rule
changes and rollback, never materialise a clique on large Slitherlink
boards, and MRV ties prefer the cell with more candidate pressure.
"""

import pickle
import random

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.rules.topology import AllowedValueCountRule
from gridsolver.rules.uneq import UneqRule


def _reference_branch_choice(grid):
    """Direct pairwise definition; deliberately independent of cached peers."""
    choices = []
    for cell, possible in enumerate(grid._candidates):
        if len(possible) <= 1:
            continue
        peers = set()
        for rule in grid.rules:
            if cell in rule.cells:
                peers.update(rule.cells)
        peers.discard(cell)
        pressure = sum(
            len(possible & grid._candidates[peer])
            for peer in peers if grid._known[peer] == 0
        )
        choices.append(((len(possible), -pressure, cell), cell))
    if not choices:
        raise ValueError("No cell has more than one candidate")
    return min(choices)[1]


def _assert_branch_choice(grid):
    expected = _reference_branch_choice(grid)
    actual, possible = grid.get_smallest_candidate_set_gt1()
    assert actual == expected
    assert possible is grid._candidates[actual]


def _global_count_rule(grid):
    return AllowedValueCountRule(
        grid, range(grid.len), 1, range(grid.len + 1),
    )


@pytest.mark.parametrize("seed", range(16))
def test_implicit_global_peers_preserve_exact_branch_order(seed):
    rng = random.Random(seed)
    grid = Grid(1, 12, max_elem=5)
    grid.add_rule_checked(_global_count_rule(grid))
    for cell in range(grid.len):
        possible = set(rng.sample(range(1, 6), rng.randint(1, 5)))
        grid.get_candidates(cell).intersection_update(possible)
        if len(possible) == 1 and rng.randrange(2):
            grid[cell] = next(iter(possible))
    _assert_branch_choice(grid)
    assert grid._rule_cache["branch_peers"] is None
    mark = grid.trail_mark()
    try:
        grid[0] = min(grid.get_candidates(0))
        grid.get_candidates(1).intersection_update({1, 2})
        _assert_branch_choice(grid)
    finally:
        grid.trail_undo(mark)
    _assert_branch_choice(grid)
    for clone in (grid.deepcopy(), pickle.loads(pickle.dumps(grid))):
        _assert_branch_choice(clone)


def test_implicit_global_peers_follow_rule_changes_and_rollback():
    grid = Grid(1, 5, max_elem=3)
    local = AllowedValueCountRule(grid, (0, 1), 1, (0, 1, 2))
    grid.add_rule_checked(local)
    _assert_branch_choice(grid)
    local_cache = grid._rule_cache["branch_peers"]
    mark = grid.trail_mark()
    try:
        global_rule = _global_count_rule(grid)
        grid.add_rule_checked(global_rule)
        _assert_branch_choice(grid)
        assert grid._rule_cache["branch_peers"] is None
        grid.deactivate_rule(global_rule)
        _assert_branch_choice(grid)
        assert grid._rule_cache["branch_peers"] == local_cache
    finally:
        grid.trail_undo(mark)
    assert grid._rule_cache["branch_peers"] is local_cache
    _assert_branch_choice(grid)


def test_large_slitherlink_branching_does_not_materialize_a_clique():
    grid = Slitherlink([[None] * 30 for _ in range(30)])
    cell, possible = grid.get_smallest_candidate_set_gt1()
    assert (cell, possible) == (0, {1, 2})
    assert grid._rule_cache["branch_peers"] is None


def test_global_peer_branching_preserves_no_choice_error():
    grid = Grid(1, 2, max_elem=2)
    grid.add_rule_checked(_global_count_rule(grid))
    grid[0] = 1
    grid[1] = 2
    with pytest.raises(ValueError, match="No cell"):
        grid.get_smallest_candidate_set_gt1()


def test_mrv_ties_prefer_the_cell_with_more_candidate_pressure():
    grid = Grid(2)
    grid.add_rule_checked(UneqRule(grid, 0, [1]))
    grid.add_rule_checked(UneqRule(grid, 0, [2]))

    cell, possible = grid.get_smallest_candidate_set_gt1()

    assert cell == 0
    assert possible == {1, 2}
