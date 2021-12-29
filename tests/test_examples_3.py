from pathlib import Path

from gridsolver.solver import solver
from gridsolver.abstract_grids.grid_loading import create_from_file

example_path = Path("../Examples/Sudoku/")


# def test_x():
#     for d in example_path.iterdir():
#         if not d.is_dir():
#             continue
#         print(d)
#         for file in d.iterdir():
#             if not file.is_file():
#                 continue
#             print(f"\nLoading {file}")
#
#             read_lines = file.read_text().splitlines(keepends=False)
#             lines = (line.strip() for line in read_lines)
#             lines = ["#" + line for line in lines]
#             file.write_text("Sudoku::\n" + "\n".join(lines))

def _solve_all_in_path(path: Path, space_sep: bool):
    for file in path.iterdir():
        if not file.is_file():
            continue
        print(f"\nLoading {file}")
        g = create_from_file(file, space_sep=space_sep)
        print(f"\nSolving {file}")
        sol = solver.solve(g, 100)
        assert len(sol) == 1


def test_ex_sudoku_16x16():
    #     _solve_all_in_path(example_path / "16x16", True)
    pass


def test_ex_sudoku_25x25():
    #     _solve_all_in_path(example_path / "25x25", True)
    pass


def test_ex_sudoku_cbg000():
    _solve_all_in_path(example_path / "cbg-000", False)


def test_ex_sudoku_clips():
    # _solve_all_in_path(example_path / "CLIPS-puzzles", False)
    pass


def test_ex_sudoku_fewers():
    _solve_all_in_path(example_path / "Fewer-steps", False)


def test_ex_sudoku_hls2():
    _solve_all_in_path(example_path / "HLS2-Examples", False)


def test_ex_sudoku_magictour():
    _solve_all_in_path(example_path / "Magictour-top1465", False)


def test_ex_sudoku_misc():
    _solve_all_in_path(example_path / "Misc", False)


def test_ex_sudoku_mith():
    _solve_all_in_path(example_path / "Mith-puzzles", False)


def test_ex_sudoku_oddagons():
    _solve_all_in_path(example_path / "Oddagons", False)


def test_ex_sudoku_subsets():
    # _solve_all_in_path(example_path / "Subsets", False)
    pass


def test_ex_sudoku_zchains():
    _solve_all_in_path(example_path / "z-chains", False)
