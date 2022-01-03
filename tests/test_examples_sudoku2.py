from pathlib import Path

from helpers import solve_all_in_path

example_path = Path("../Examples/Sudoku/")


def test_ex_sudoku_16x16():
    solve_all_in_path(example_path / "16x16", True)

def test_ex_sudoku_25x25():
    solve_all_in_path(example_path / "25x25+", True)
