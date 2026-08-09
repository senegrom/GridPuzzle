"""Include explicit weak links in shared candidate-topology visibility."""

from pathlib import Path


path = Path("gridsolver/solver/candidate_topology.py")
text = path.read_text(encoding="utf-8")
old = '''        def build_peer_masks() -> tuple[int, ...]:
            peers = [0] * grid.len
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    peers[cell] |= house_mask & ~(1 << cell)
            return tuple(peers)
'''
new = '''        def build_peer_masks() -> tuple[int, ...]:
            # Complete houses remain authoritative even when their pairwise
            # UneqRule materialisation has not run yet. Explicit UneqRule
            # relations add equally valid non-house visibility (anti-king,
            # anti-knight, custom extensions, and similar constraints).
            peers = [cells_mask(links) for links in grid.weak_links]
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    peers[cell] |= house_mask & ~(1 << cell)
            return tuple(peers)
'''
if text.count(old) != 1:
    raise SystemExit("candidate peer-mask builder marker changed")
path.write_text(text.replace(old, new, 1), encoding="utf-8")


test_path = Path("tests/test_topology_cache_lifecycle.py")
tests = test_path.read_text(encoding="utf-8")
imports_old = '''from gridsolver.rules.rules import Guarantee
from gridsolver.rules.unique import ElementsAtMostOnce
'''
imports_new = '''from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
'''
if tests.count(imports_old) != 1:
    raise SystemExit("topology test import marker changed")
tests = tests.replace(imports_old, imports_new, 1)
appendix = '''


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
'''
if "test_candidate_topology_includes_explicit_non_house_weak_links" in tests:
    raise SystemExit("candidate visibility tests already exist")
test_path.write_text(tests.rstrip() + appendix, encoding="utf-8")


differential_path = Path("tests/test_differential.py")
differential = differential_path.read_text(encoding="utf-8")
import_old = '''from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
'''
import_new = '''from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.uneq import UneqRule
from gridsolver.solver import solver
'''
if differential.count(import_old) != 1:
    raise SystemExit("differential import marker changed")
differential = differential.replace(import_old, import_new, 1)
appendix = '''


def test_power_actions_preserve_completions_with_non_house_weak_link():
    completions = tuple(
        solution
        for solution in _sudoku4_solutions()
        if solution[0] != solution[6]
    )[:2]
    assert len(completions) == 2

    grid = _grid_from_completions(completions)
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[6]))
    atomic = AtomicSolver(grid, [], set())

    with _quiet_solver_logs():
        for label in atomic._solve_power_actions():
            _assert_completions_survive(
                grid,
                completions,
                stage=f"non-house weak link after {label}",
            )
            status = propagate_basic(grid)
            assert status is not SolveStatus.INVALID, label
            _assert_completions_survive(
                grid,
                completions,
                stage=f"non-house weak link after {label} + basic",
            )
'''
if "test_power_actions_preserve_completions_with_non_house_weak_link" in differential:
    raise SystemExit("non-house differential test already exists")
differential_path.write_text(differential.rstrip() + appendix, encoding="utf-8")
