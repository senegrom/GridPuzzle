"""Move topology structures to the rule-only cache and add lifecycle tests."""

from pathlib import Path


candidate_path = Path("gridsolver/solver/candidate_topology.py")
candidate = candidate_path.read_text(encoding="utf-8")
old = '''        peer_masks = grid.cached_struct(
            "cell_peer_masks",
            build_peer_masks,
        )
'''
new = '''        peer_masks = grid.cached_rule_struct(
            "cell_peer_masks",
            build_peer_masks,
        )
'''
if candidate.count(old) != 1:
    raise SystemExit("CandidateTopology peer-mask cache marker changed")
candidate_path.write_text(candidate.replace(old, new, 1), encoding="utf-8")

als_path = Path("gridsolver/solver/solve_als.py")
als = als_path.read_text(encoding="utf-8")
old = '''    return grid.cached_struct(
        "als_cell_houses",
        lambda: {cell: [h for h in all_houses if cell in h] for cell in range(grid.len)})
'''
new = '''    return grid.cached_rule_struct(
        "als_cell_houses",
        lambda: {
            cell: [house for house in all_houses if cell in house]
            for cell in range(grid.len)
        },
    )
'''
if als.count(old) != 1:
    raise SystemExit("ALS cell-house cache marker changed")
als_path.write_text(als.replace(old, new, 1), encoding="utf-8")

Path("tests/test_topology_cache_lifecycle.py").write_text(
    '''from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_als import _cell_houses, _full_houses


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
    houses = _full_houses(grid)
    cell_houses = _cell_houses(grid, houses)
    mixed_value = grid.cached_struct("mixed-sentinel", object)

    grid.add_gtee_checked(_guarantee(grid))

    rebuilt = CandidateTopology.build(grid)
    assert rebuilt.peer_masks is topology.peer_masks
    assert _cell_houses(grid, _full_houses(grid)) is cell_houses
    assert "mixed-sentinel" not in grid._struct_cache
    assert mixed_value is not None


def test_topology_caches_invalidate_when_rules_change():
    grid = Sudoku(2, 2, 2, 2)
    before = CandidateTopology.build(grid)
    before_houses = _cell_houses(grid, _full_houses(grid))

    diagonal = (0, 5, 10, 15)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=diagonal))

    after = CandidateTopology.build(grid)
    after_houses = _cell_houses(grid, _full_houses(grid))
    assert after.peer_masks is not before.peer_masks
    assert after_houses is not before_houses
    for first in diagonal:
        for second in diagonal:
            if first != second:
                assert after.peer_masks[first] & (1 << second)


def test_rule_only_topology_cache_restores_across_trail_rollback():
    grid = Sudoku(2, 2, 2, 2)
    parent_topology = CandidateTopology.build(grid)
    parent_houses = _cell_houses(grid, _full_houses(grid))
    mark = grid.trail_mark()

    grid.add_rule_checked(
        ElementsAtMostOnce(grid, cells=(0, 5, 10, 15))
    )
    branch_topology = CandidateTopology.build(grid)
    assert branch_topology.peer_masks is not parent_topology.peer_masks

    grid.trail_undo(mark)

    restored = CandidateTopology.build(grid)
    assert restored.peer_masks is parent_topology.peer_masks
    assert _cell_houses(grid, _full_houses(grid)) is parent_houses
''',
    encoding="utf-8",
)
