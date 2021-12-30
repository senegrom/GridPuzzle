from gridsolver.solver import solver


def test_ex_sudoku():
    from examples import exampleSudoku
    sol = solver.solve(exampleSudoku.g)
    assert len(sol) == 1


def test_ex_blank_sudoku():
    pass
    from examples import blankSudoku
    sol = solver.solve(blankSudoku.g, max_sols=2)
    assert len(sol) == 2


def test_ex_futoshiki():
    from examples import exampleFutoshiki
    sol = solver.solve(exampleFutoshiki.g)
    assert len(sol) == 1


def test_ex_killer_sudoku():
    from examples import killerSudoku
    sol = solver.solve(killerSudoku.g)
    assert len(sol) == 1


def test_ex_miracle_sudoku():
    from examples import miracleSudoku
    sol = solver.solve(miracleSudoku.g)
    assert len(sol) == 1
