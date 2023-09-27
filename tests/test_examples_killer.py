from pathlib import Path

from helpers import solve_all_in_path


def test_ex_hard():
    from mypuz.p20201001hard290 import g
    from gridsolver.solver import solver
    sol = solver.solve(g, log_level=-1)
    assert len(sol) == 1


def test_ex_killer():
    solve_all_in_path(Path("../Examples/KillerSudoku"), False)
