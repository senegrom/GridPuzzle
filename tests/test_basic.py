from gridsolver.grid_classes import solver
from gridsolver.grid_classes.sudoku import Sudoku


def test_sudo0():
    g = Sudoku(1, 1, 1, 1)
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 1


def test_sudo1():
    g = Sudoku(2, 2, 2, 2)
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 288


def test_sudo2():
    g = Sudoku(2, 2, 2, 2)
    g.load("12344321........")
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 4


def test_sudo3():
    g = Sudoku(2, 2, 2, 2)
    g.load("1234432131......")
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 1


def test_sudo_none():
    g = Sudoku(2, 2, 2, 2)
    g.load("12344321.312....")
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 0


def test_sudo_nonsq():
    g = Sudoku(2, 3, 3, 2)
    g.load("123456654321........................")
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 16


def test_sudo_m10():
    g = Sudoku()
    sol = solver.solve(g, max_sols=10, print_info=-1)
    assert len(sol) == 10


def test_sudo_big_m10():
    g = Sudoku(4, 4, 4, 4)
    sol = solver.solve(g, max_sols=1, print_info=-1)
    assert len(sol) == 10
