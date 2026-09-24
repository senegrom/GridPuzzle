"""Kakuro run totals: a load-time contradiction instead of a search.

Every white cell lies in exactly one across and one down run, so within a
connected group of runs the across targets and the down targets add up the
same cells. A group whose totals differ is unsatisfiable. It still solves
to zero solutions rather than raising, but now at the first propagation.
"""
from gridsolver.abstract_grids.grid import SolveStatus, TechniqueProfile
from gridsolver.grid_classes.kakuro import Kakuro
from gridsolver.rules.rules import UnsatisfiableRule
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver


class _KakuroRulesOnly(Kakuro):
    technique_profile = TechniqueProfile.RULES_ONLY


class _KakuroFull(Kakuro):
    technique_profile = TechniqueProfile.FULL


def _root_status(grid):
    """Status of the first propagation pass, before any branching."""
    return AtomicSolver(grid.deepcopy(), [], set()).solve_atomic()


def _all_white_kakuro(cls, row_totals, col_totals):
    white = [(r, c) for r in range(4) for c in range(4)]
    runs = [(row_totals[r], [(r, c) for c in range(4)]) for r in range(4)]
    runs += [(col_totals[c], [(r, c) for r in range(4)]) for c in range(4)]
    return cls(4, 4, white, runs)


def test_kakuro_with_unequal_run_totals_fails_before_search():
    # Rows total 95, columns 96: master needed 6 s (rules only) to 96 s
    # (full profile) of search to report no solution.
    rows, cols = (19, 30, 21, 25), (22, 26, 26, 22)
    grid = _all_white_kakuro(Kakuro, rows, cols)  # still no construction error
    assert [rule.reason for rule in grid.rules if isinstance(rule, UnsatisfiableRule)] == [
        "across runs total 95, down runs total 96"
    ]
    assert _root_status(grid) is SolveStatus.INVALID
    for cls in (Kakuro, _KakuroRulesOnly, _KakuroFull):
        assert solver.solve(_all_white_kakuro(cls, rows, cols)) == set()


def test_kakuro_run_totals_are_compared_per_connected_group():
    # Two separate 2x2 blocks: overall the across and down totals agree
    # (9 + 11 == 10 + 10), but within each block they differ by one.
    white = [(0, 0), (0, 1), (1, 0), (1, 1), (0, 3), (0, 4), (1, 3), (1, 4)]
    runs = [
        (3, [(0, 0), (0, 1)]), (6, [(1, 0), (1, 1)]),
        (4, [(0, 0), (1, 0)]), (6, [(0, 1), (1, 1)]),
        (3, [(0, 3), (0, 4)]), (8, [(1, 3), (1, 4)]),
        (4, [(0, 3), (1, 3)]), (6, [(0, 4), (1, 4)]),
    ]
    grid = Kakuro(2, 5, white, runs)
    assert sorted(rule.reason for rule in grid.rules if isinstance(rule, UnsatisfiableRule)) == [
        "across runs total 11, down runs total 10",
        "across runs total 9, down runs total 10",
    ]
    assert _root_status(grid) is SolveStatus.INVALID
    assert solver.solve(grid) == set()


def test_kakuro_with_equal_run_totals_gets_no_contradiction():
    grid = _all_white_kakuro(Kakuro, (10, 26, 10, 26), (13, 23, 13, 23))
    assert not any(isinstance(rule, UnsatisfiableRule) for rule in grid.rules)
