from gridsolver.solver import solver


def test_ex_sudoku():
    from Examples import exampleSudoku

    sol = solver.solve(exampleSudoku.g)
    assert len(sol) == 1


def test_ex_blank_sudoku():
    from Examples import blankSudoku

    # The root still receives the complete deduction hierarchy; recursive
    # enumeration uses the correctness-gated cheap tier. This turns a formerly
    # eight-minute smoke test into a practical CI check without changing its
    # contract (two independently validated solutions).
    sol = solver.solve(blankSudoku.g, max_sols=2, depth_gate=0)
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
