from gridsolver.grid_classes import solver
from gridsolver.grid_classes.sudoku import Sudoku


def test_sudo1():
    g = Sudoku(2, 2, 2, 2)
    sol = solver.solve(g)
    assert len(sol) == 288


def test_sudo2():
    g = Sudoku(2, 2, 2, 2)
    g.load("12344321........")
    sol = solver.solve(g)
    assert len(sol) == 4


def test_sudo3():
    g = Sudoku(2, 2, 2, 2)
    g.load("1234432131......")
    sol = solver.solve(g)
    assert len(sol) == 1


def test_sudo_nonsq():
    g = Sudoku(2, 3, 3, 2)
    g.load("123456654321........................")
    sol = solver.solve(g)
    assert len(sol) == 16
