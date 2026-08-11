from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_als import cell_houses as _cell_houses


def _guarantee(grid: Sudoku) -> Guarantee:
    return Guarantee(
        1,
        frozenset({0, 1}),
        grid.rows,
        grid.cols,
    )


def test_topology_caches_survive_guarantee_only_churn():
    grid = Sudoku(2, 2, 2, 2)
    topology = CandidateTopology.build(grid)
    houses = grid.full_houses
    cell_houses = _cell_houses(grid, houses)
    mixed_value = grid.cached_struct("mixed-sentinel", object)

    grid.add_gtee_checked(_guarantee(grid))

    rebuilt = CandidateTopology.build(grid)
    assert rebuilt.peer_masks is topology.peer_masks
    assert _cell_houses(grid, grid.full_houses) is cell_houses
    assert "mixed-sentinel" not in grid._struct_cache
    assert mixed_value is not None


def test_topology_caches_invalidate_when_rules_change():
    grid = Sudoku(2, 2, 2, 2)
    before = CandidateTopology.build(grid)
    before_houses = _cell_houses(grid, grid.full_houses)

    diagonal = (0, 5, 10, 15)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=diagonal))

    after = CandidateTopology.build(grid)
    after_houses = _cell_houses(grid, grid.full_houses)
    assert after.peer_masks is not before.peer_masks
    assert after_houses is not before_houses
    for first in diagonal:
        for second in diagonal:
            if first != second:
                assert after.peer_masks[first] & (1 << second)


def test_rule_only_topology_cache_restores_across_trail_rollback():
    grid = Sudoku(2, 2, 2, 2)
    parent_topology = CandidateTopology.build(grid)
    parent_houses = _cell_houses(grid, grid.full_houses)
    mark = grid.trail_mark()

    grid.add_rule_checked(
        ElementsAtMostOnce(grid, cells=(0, 5, 10, 15))
    )
    branch_topology = CandidateTopology.build(grid)
    assert branch_topology.peer_masks is not parent_topology.peer_masks

    grid.trail_undo(mark)

    restored = CandidateTopology.build(grid)
    assert restored.peer_masks is parent_topology.peer_masks
    assert _cell_houses(grid, grid.full_houses) is parent_houses


def test_candidate_topology_includes_explicit_non_house_weak_links():
    grid = Sudoku(2, 2, 2, 2)
    # Cells 0 and 6 share no row, column, or 2x2 box.
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[6]))

    topology = CandidateTopology.build(grid)

    assert topology.peer_masks[0] & (1 << 6)
    assert topology.peer_masks[6] & (1 << 0)
    assert topology.visible_from_mask(1 << 0) & (1 << 6)
    assert topology.visible_from_mask(1 << 6) & (1 << 0)


def test_candidate_topology_keeps_house_visibility_before_rulehelper_materialisation():
    grid = Sudoku(2, 2, 2, 2)
    assert not grid.get_rules_of_type(UneqRule)

    topology = CandidateTopology.build(grid)

    # Same row, same column and same box are visible from the first cell even
    # before rulehelper_atmostonce creates pairwise relation rules.
    for peer in (1, 4, 5):
        assert topology.peer_masks[0] & (1 << peer)
