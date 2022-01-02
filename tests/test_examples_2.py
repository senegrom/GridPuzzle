from gridsolver.solver import solver


def test_ex_sudoku():
    from Examples import exampleSudoku
    sol = solver.solve(exampleSudoku.g)
    assert len(sol) == 1


def test_ex_blank_sudoku():
    pass
    from Examples import blankSudoku
    sol = solver.solve(blankSudoku.g, max_sols=2)
    assert len(sol) == 2


def test_ex_futoshiki():
    from Examples import exampleFutoshiki
    sol = solver.solve(exampleFutoshiki.g)
    assert len(sol) == 1


def test_ex_killer_sudoku():
    from Examples import killerSudoku
    sol = solver.solve(killerSudoku.g)
    assert len(sol) == 1


def test_ex_miracle_sudoku():
    from Examples import miracleSudoku
    sol = solver.solve(miracleSudoku.g)
    assert len(sol) == 1
