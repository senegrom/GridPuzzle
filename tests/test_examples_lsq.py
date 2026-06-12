from pathlib import Path

import pytest

from helpers import solve_all_in_path

example_path = Path("../Examples/LatinSquares/")


def test_ex_latin_squares():
    solve_all_in_path(example_path / "LatinSquares", False)


@pytest.mark.slow  # ~22 min (was 3h before the June 2026 optimizations); run with -m slow
def test_ex_diag_latin_squares():
    solve_all_in_path(example_path / "Pandiagonals", False, max_count=3)
