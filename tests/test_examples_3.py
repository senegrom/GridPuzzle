from pathlib import Path

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.solver import solver, logger

_MAX_LVL = logger.MAX_LVL
_lg = logger.get_log(__name__, _MAX_LVL)

example_path = Path("../Examples/Sudoku/")


# def test_x():
#     for d in (example_path).iterdir():
#         if not d.is_dir():
#             continue
#         print(d)
#         for file in d.iterdir():
#             if not file.is_file():
#                 continue
#             _lg.logs(0, f"\nLoading {file}")
#
#             read_lines = file.read_text().splitlines(keepends=False)
#             lines = [line.strip() for line in read_lines]
#             counter = 0
#             for i, line in enumerate(lines):
#                 if counter == 2 and line.startswith("#("):
#                     lines[i] = line[2:-1]
#                     counter += 1
#                 elif counter == 2 and line.startswith("#"):
#                     lines[i] = line[1:]
#                     counter += 1
#                 if line.startswith("#**************************"):
#                     counter += 1
#
#             # lines = ["#" + line for line in lines]
#             # file.write_text("Sudoku::\n" + "\n".join(lines))
#             # file.write_text("\n".join(lines))

def _solve_all_in_path(path: Path, space_sep: bool):
    for file in path.iterdir():
        if not file.is_file():
            continue
        _lg.logs(0, f"\nLoading {file}")
        g = create_from_file(file, space_sep=space_sep)
        _lg.logs(0, f"\nSolving {file}")
        sol = solver.solve(g, 100)
        assert len(sol) == 1


def test_ex_sudoku_16x16():
    _solve_all_in_path(example_path / "16x16", True)
    pass


def test_ex_sudoku_25x25():
    _solve_all_in_path(example_path / "25x25", True)
    pass


def test_ex_sudoku_cbg000():
    _solve_all_in_path(example_path / "cbg-000", False)


def test_ex_sudoku_clips():
    _solve_all_in_path(example_path / "CLIPS-puzzles", False)
    pass


def test_ex_sudoku_clips_big():
    _solve_all_in_path(example_path / "CLIPS-puzzles-big", True)
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


def test_ex_sudoku_subsets2():
    _solve_all_in_path(example_path / "Subsets" / "S2", False)


def test_ex_sudoku_subsets3():
    _solve_all_in_path(example_path / "Subsets" / "S3", False)


def test_ex_sudoku_subsets4():
    _solve_all_in_path(example_path / "Subsets" / "S4", False)


def test_ex_sudoku_zchains():
    _solve_all_in_path(example_path / "z-chains", False)
