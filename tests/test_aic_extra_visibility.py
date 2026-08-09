from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_aic import _extra_same_value_weak_pairs


def _pairs(topology: CandidateTopology) -> set[tuple[int, int, int]]:
    return {
        (first[0], second[0], first[1])
        for first, second in _extra_same_value_weak_pairs(topology)
    }


def test_standard_sudoku_has_no_extra_aic_peer_edges():
    topology = CandidateTopology.build(Sudoku(2, 2, 2, 2))

    assert not any(topology.extra_peer_masks)
    assert list(_extra_same_value_weak_pairs(topology)) == []


def test_explicit_non_house_relation_becomes_extra_aic_edge():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[2]))

    topology = CandidateTopology.build(grid)

    assert topology.extra_peer_masks[0] & (1 << 2)
    assert topology.extra_peer_masks[2] & (1 << 0)
    assert {(0, 2, value) for value in range(1, 4)} <= _pairs(topology)


def test_partial_uniqueness_group_becomes_extra_aic_edge():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 2]))

    topology = CandidateTopology.build(grid)

    assert topology.houses == ()
    assert topology.peer_masks[0] & (1 << 2)
    assert topology.peer_masks[2] & (1 << 0)
    assert {(0, 2, value) for value in range(1, 4)} <= _pairs(topology)


def test_extra_aic_pairs_are_emitted_once_for_overlapping_constraints():
    grid = Grid(1, 4, max_elem=4)
    grid.add_rules_checked(
        (
            ElementsAtMostOnce(grid, cells=[0, 3]),
            UneqRule(grid, origin_cell=0, rel_cells=[3]),
        )
    )

    pairs = list(_extra_same_value_weak_pairs(CandidateTopology.build(grid)))

    assert len(pairs) == 4
    assert len(pairs) == len(set(pairs))
