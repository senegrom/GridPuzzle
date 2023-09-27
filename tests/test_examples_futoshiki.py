from pathlib import Path

from helpers import solve_all_in_path

example_path = Path("../Examples/Futoshiki/")


def test_ex_futo_atk():
    solve_all_in_path(example_path / "ATK", False)


def test_ex_futo_tatham():
    solve_all_in_path(example_path / "Tatham", False)


def test_ex_futo_times():
    solve_all_in_path(example_path / "times", False)
