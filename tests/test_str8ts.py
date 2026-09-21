from gridsolver.grid_classes.str8ts import Str8ts
from gridsolver.solver.solver import solve


def newspaper_grid():
    board = [
        [9, None, "#", 6, None, None, None, "#", "#"],
        [None, None, None, 1, 4, None, 6, 5, None],
        ["#", "#", None, 2, "#", "#", None, None, None],
        [3, None, None, "#", 9, None, None, None, 5],
        [None, None, "#", 8, None, None, "#", None, None],
        ["#", None, None, None, None, 1, None, None, None],
        [None, 7, None, 9, "#", None, 3, 2, "#"],
        [None, None, None, 4, None, 5, None, None, 8],
        [7, "#", None, None, None, "#", "#", None, None],
    ]
    black = {
        (0, 2), (0, 3), (0, 7), (0, 8),
        (2, 0), (2, 1), (2, 4), (2, 5),
        (3, 3), (3, 8), (4, 2), (4, 6),
        (5, 0), (5, 5), (6, 3), (6, 4), (6, 7), (6, 8),
        (8, 0), (8, 1), (8, 5), (8, 6),
    }
    return Str8ts.from_board(board, black=black)


def test_newspaper_str8ts_is_unique():
    grid = newspaper_grid()
    solutions = solve(grid, processes=0, max_sols=2, log_level=-1)
    assert len(solutions) == 1
    values = grid.values_by_key(next(iter(solutions)))
    expected = [
        [9, 8, None, 6, 5, 3, 4, None, None],
        [8, 9, 3, 1, 4, 2, 6, 5, 7],
        [None, None, 1, 2, None, None, 5, 7, 6],
        [3, 4, 2, None, 9, 8, 7, 6, 5],
        [4, 5, None, 8, 7, 9, None, 3, 2],
        [None, 6, 5, 7, 8, 1, 2, 4, 3],
        [5, 7, 6, 9, None, 4, 3, 2, None],
        [6, 3, 7, 4, 2, 5, 1, 9, 8],
        [7, None, 4, 5, 3, None, None, 8, 9],
    ]
    for row in range(9):
        for col in range(9):
            if expected[row][col] is not None:
                assert values[(row, col)] == expected[row][col]


def test_numbered_black_cells_break_streets_but_count_for_uniqueness():
    grid = Str8ts.from_board(
        [[1, 2, 3], [2, 3, 1], [3, 1, None]],
        black={(1, 1)},
    )
    solutions = solve(grid, processes=0, max_sols=2, log_level=-1)
    assert len(solutions) == 1
    assert grid.values_by_key(next(iter(solutions)))[(2, 2)] == 2
    assert (1, 1) in grid.numbered_black


def test_malformed_numbered_black_is_rejected():
    try:
        Str8ts(3, black={(1, 1)}, numbered_black={(0, 0)})
    except ValueError as exc:
        assert "also be black" in str(exc)
    else:
        raise AssertionError("expected invalid numbered-black cell")
