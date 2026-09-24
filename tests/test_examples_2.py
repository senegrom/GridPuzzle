from gridsolver.solver import solver


def test_ex_sudoku():
    from gridsolver.examples import sudoku

    sol = solver.solve(sudoku.g)
    assert len(sol) == 1


def test_ex_futoshiki():
    from gridsolver.examples import futoshiki

    sol = solver.solve(futoshiki.g)
    assert len(sol) == 1


def test_ex_killer_sudoku():
    from gridsolver.examples import killer_sudoku

    sol = solver.solve(killer_sudoku.g)
    assert len(sol) == 1


def test_ex_miracle_sudoku():
    from gridsolver.examples import miracle_sudoku

    sol = solver.solve(miracle_sudoku.g)
    assert len(sol) == 1
