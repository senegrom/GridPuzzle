import pytest
from pathlib import Path

from helpers import solve_all_in_path


pytestmark = pytest.mark.slow


example_path = Path("../Examples/Sudoku/")


def test_ex_sudoku_16x16():
    solve_all_in_path(example_path / "16x16", True)


def test_ex_sudoku_25x25():
    # Deterministic bounded selection (FULL profile, 2026-09-02, CPU seconds on
    # a Ryzen 7500X3D): a_suyan51 2s, a_ton 54s. The Metcalf 36x36 and 49x49
    # grids in this directory do not finish in any technique profile within
    # minutes and are deliberately excluded; picking "any three" files by
    # directory order used to include one of them and time the weekly job out.
    solve_all_in_path(
        example_path / "25x25+",
        True,
        names=("a_suyan51-25x25-HP.clp", "a_ton-25x25-W3.clp"),
    )
