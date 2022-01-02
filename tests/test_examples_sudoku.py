from pathlib import Path

from helpers import solve_all_in_path

example_path = Path("../Examples/Sudoku/")


def test_ex_sudoku_16x16():
    solve_all_in_path(example_path / "16x16", True)


def test_ex_sudoku_25x25():
    solve_all_in_path(example_path / "25x25+", True)


def test_ex_sudoku_cbg000():
    solve_all_in_path(example_path / "cbg-000", False)


def test_ex_sudoku_clips():
    solve_all_in_path(example_path / "CLIPS-puzzles", False)


def test_ex_sudoku_clips_big():
    solve_all_in_path(example_path / "CLIPS-puzzles-big", True)


def test_ex_sudoku_fewers():
    solve_all_in_path(example_path / "Fewer-steps", False)


def test_ex_sudoku_hls2():
    solve_all_in_path(example_path / "HLS2-Examples", False)


def test_ex_sudoku_magictour():
    solve_all_in_path(example_path / "Magictour-top1465", False)


def test_ex_sudoku_misc():
    solve_all_in_path(example_path / "Misc", False)


def test_ex_sudoku_mith():
    solve_all_in_path(example_path / "Mith-puzzles", False)


def test_ex_sudoku_oddagons():
    solve_all_in_path(example_path / "Oddagons", False)


def test_ex_sudoku_subsets2():
    solve_all_in_path(example_path / "Subsets" / "S2", False)


def test_ex_sudoku_subsets3():
    solve_all_in_path(example_path / "Subsets" / "S3", False)


def test_ex_sudoku_subsets4():
    solve_all_in_path(example_path / "Subsets" / "S4", False)


def test_ex_sudoku_zchains():
    solve_all_in_path(example_path / "z-chains", False)
