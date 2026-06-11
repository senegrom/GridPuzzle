from pathlib import Path

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.solver import solver, logger

# Resolve paths relative to this file's directory (tests/), not CWD
_TESTS_DIR = Path(__file__).resolve().parent

logger.set_colouring(logger.Colouring.Colorama)

_MAX_LVL = logger.MAX_LVL
lg = logger.get_log("TEST", _MAX_LVL)
VERB = 0  # bump (e.g. to 100) when debugging a failing test


def solve_path(file: Path, space_sep: bool):
    lg.logs(0, f"\nLoading {file}")
    g = create_from_file(file, space_sep=space_sep)
    lg.logs(0, f"\nSolving {file}")
    sol = solver.solve(g, VERB)
    assert len(sol) == 1


def solve_all_in_path(path: Path, space_sep: bool, max_count=0):
    path = _TESTS_DIR / path
    counter = 0
    for file in path.iterdir():
        if not file.is_file():
            continue
        if max_count and counter >= max_count:
            break
        solve_path(file, space_sep=space_sep)
        counter += 1
