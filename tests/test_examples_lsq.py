from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.grid_classes.latins_square import LatinSquare, PandiagonalLatinSquare
from helpers import solve_all_in_path

example_path = Path("../Examples/LatinSquares/")
_CORPUS = Path(__file__).resolve().parents[1] / "Examples" / "LatinSquares"


@pytest.mark.parametrize(
    "folder, expected",
    (("LatinSquares", LatinSquare), ("Pandiagonals", PandiagonalLatinSquare)),
)
def test_latin_square_corpus_files_declare_their_folders_class(folder, expected):
    # 7x7-1to9only-Z3-NT.clp declared LatinSquare:: inside Pandiagonals: read
    # as a plain Latin square it has several solutions and ran for minutes.
    files = sorted(file for file in (_CORPUS / folder).iterdir() if file.is_file())
    assert files
    for file in files:
        assert type(create_from_file(file)) is expected, file.name


@pytest.mark.slow  # 20.9 s of the bounded suite (2026-09-24); Extended CI runs it with the other corpora
def test_ex_latin_squares():
    solve_all_in_path(example_path / "LatinSquares", False)


@pytest.mark.slow  # ~1 min locally (FULL profile, 2026-09-02): 7x7 Z2 trio 0.3s, 7x7 Z3-NT 0.06s, 11x11 3s, 13x13-1to9only 54s CPU
def test_ex_diag_latin_squares():
    # Deterministic bounded selection. Excluded on purpose: 13x13-DB#2 (113s),
    # 13x13-DB#1, 13x13-DB#10 and the 13x13 Mith variant, which run for
    # minutes or do not finish in any profile; "any three" files by
    # directory order used to include them and time the weekly job out.
    solve_all_in_path(
        example_path / "Pandiagonals",
        False,
        names=(
            "7x7-1to9only#4-Z2-SHT.clp",
            "7x7-1to9only#6-Z2-SHT.clp",
            "7x7-1to9only#7-Z2-SHT.clp",
            "7x7-1to9only-Z3-NT.clp",
            "11x11-1to9only-W4.clp",
            "13x13-1to9only-W5.clp",
        ),
    )
