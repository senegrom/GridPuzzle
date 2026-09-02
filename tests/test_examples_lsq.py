from pathlib import Path

import pytest

from helpers import solve_all_in_path

example_path = Path("../Examples/LatinSquares/")


def test_ex_latin_squares():
    solve_all_in_path(example_path / "LatinSquares", False)


@pytest.mark.slow  # ~1 min locally (FULL profile, 2026-09-02): 7x7 Z2 trio 0.3s, 11x11 3s, 13x13-1to9only 54s CPU
def test_ex_diag_latin_squares():
    # Deterministic bounded selection. Excluded on purpose: 13x13-DB#2 (113s),
    # 13x13-DB#1, 13x13-DB#10, the 13x13 Mith variant and 7x7-Z3-NT, which run
    # for minutes or do not finish in any profile; "any three" files by
    # directory order used to include them and time the weekly job out.
    solve_all_in_path(
        example_path / "Pandiagonals",
        False,
        names=(
            "7x7-1to9only#4-Z2-SHT.clp",
            "7x7-1to9only#6-Z2-SHT.clp",
            "7x7-1to9only#7-Z2-SHT.clp",
            "11x11-1to9only-W4.clp",
            "13x13-1to9only-W5.clp",
        ),
    )
