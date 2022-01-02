from pathlib import Path

from helpers import solve_all_in_path

example_path = Path("../Examples/LatinSquares/")


def test_ex_latin_squares():
    solve_all_in_path(example_path / "LatinSquares", False)
    pass


def test_ex_diag_latin_squares():
    solve_all_in_path(example_path / "Pandiagonals", False)
    pass
