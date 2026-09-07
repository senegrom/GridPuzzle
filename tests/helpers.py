from collections.abc import Sequence
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


def solve_all_in_path(
    path: Path,
    space_sep: bool,
    names: Sequence[str] | None = None,
) -> None:
    """Solve every file in a corpus directory, or exactly the named files.

    ``names`` makes a bounded selection deterministic: ``Path.iterdir()`` order
    is filesystem-dependent, so "the first N files" differed between the
    Windows and Linux runners and could pick cases that never finish.
    """
    path = _TESTS_DIR / path
    if names is None:
        files = sorted(file for file in path.iterdir() if file.is_file())
    else:
        files = [path / name for name in names]
        missing = [file.name for file in files if not file.is_file()]
        assert not missing, f"Missing corpus files in {path}: {missing}"
    for file in files:
        solve_path(file, space_sep=space_sep)
    # an existing-but-empty corpus directory must fail, not pass vacuously
    assert files, f"No example files solved in {path}"
