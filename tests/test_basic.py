from gridsolver.abstract_grids import solver
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.abstract_grids.grid_loading import create_from_str


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
    g2 = create_from_str("12344321........", Sudoku)
    g3 = create_from_str("12344321........", "Sudoku")
    sol = solver.solve(g, print_info=-1)
    sol2 = solver.solve(g2, print_info=0)
    sol3 = solver.solve(g3, print_info=0)
    assert len(sol) == 4
    assert sol == sol2
    assert sol == sol3


def test_sudo3():
    g = create_from_str("1234432131......", Sudoku)
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 1


def test_sudo_none():
    g = create_from_str("123443212......3", Sudoku)
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 0


def test_sudo_nonsq():
    g = Sudoku(2, 3, 3, 2)
    g.load("123456654321........................", row_wise=False)
    sol = solver.solve(g, print_info=-1)
    assert len(sol) == 16


def test_sudo_m10():
    g = Sudoku()
    sol = solver.solve(g, max_sols=10, print_info=-1)
    assert len(sol) == 10


def test_sudo_big_m10():
    g = Sudoku(4, 4, 4, 4)
    # sol = solver.solve(g, max_sols=2, print_info=2)
    # assert len(sol) == 2


def test_sudo_big2_m10():
    g = Sudoku(5, 5, 5, 5)
    ##sol = solver.solve(g, max_sols=1, print_info=-1)
    # assert len(sol) == 10
