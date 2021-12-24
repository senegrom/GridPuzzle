from gridsolver.grid_classes import solver


def test_ex_sudoku():
    from gridsolver.examples import exampleSudoku
    sol = solver.solve(exampleSudoku.g)
    assert len(sol) == 1


def test_ex_futoshiki():
    from gridsolver.examples import exampleFutoshiki
    sol = solver.solve(exampleFutoshiki.g)
    assert len(sol) == 1


def test_ex_killer_sudoku():
    from gridsolver.examples import killerSudoku
    sol = solver.solve(killerSudoku.g)
    assert len(sol) == 1


def test_ex_miracle_sudoku():
    from gridsolver.examples import miracleSudoku
    sol = solver.solve(miracleSudoku.g)
    assert len(sol) == 1
