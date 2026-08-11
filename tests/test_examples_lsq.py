from pathlib import Path

import pytest

from helpers import solve_all_in_path

example_path = Path("../Examples/LatinSquares/")


def test_ex_latin_squares():
    solve_all_in_path(example_path / "LatinSquares", False)


@pytest.mark.slow  # ~3-5 min (3h before June 2026, 22 min before the August engine work)
def test_ex_diag_latin_squares():
    solve_all_in_path(example_path / "Pandiagonals", False, max_count=3)
