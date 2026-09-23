import io
import logging
import os
from pathlib import Path
import subprocess
import sys

import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
from gridsolver.solver.logger import CoordToString, GridLogger, MAX_LVL, QUIET, get_log


def _isolated_logger(name, *handlers, level=logging.DEBUG):
    """A logger that sees only its own handlers, at an explicit level.

    Solver loggers no longer force a level of their own, so a test that needs
    output must admit it itself instead of relying on the root logger's level.
    """
    raw = logging.getLogger(name)
    raw.handlers[:] = list(handlers)
    raw.propagate = False
    raw.setLevel(level)
    return raw


def test_null_handler_is_not_treated_as_visible_output(monkeypatch):
    raw = _isolated_logger("gridpuzzle-null-handler-test", logging.NullHandler())
    logger = GridLogger(raw, 0)

    with logger.solve_context(0):
        assert not logger.is_enabled(0)


def test_real_handler_remains_visible():
    stream = io.StringIO()
    raw = _isolated_logger(
        "gridpuzzle-real-handler-test", logging.StreamHandler(stream)
    )
    logger = GridLogger(raw, 0)

    with logger.solve_context(0):
        assert logger.is_enabled(0)
        logger.logs(0, "visible")
    assert "visible" in stream.getvalue()


def test_solver_loggers_share_the_gridsolver_namespace_without_forced_levels():
    assert solver._lg.lg.name == "gridsolver.solver"
    assert solver._lg.lg.level == logging.NOTSET
    assert get_log("Probe", 0).lg.name == "gridsolver.Probe"
    assert get_log("gridsolver.cli", 0).lg.name == "gridsolver.cli"
    assert get_log("gridsolver", 0).lg.name == "gridsolver"


def test_detail_levels_map_to_standard_logging_levels():
    records = []

    class Collect(logging.Handler):
        def emit(self, record):
            records.append((record.levelno, record.getMessage()))

    raw = _isolated_logger("gridsolver.tests.levels", Collect())
    logger = GridLogger(raw, MAX_LVL)
    with logger.solve_context(None):
        for level in (0, 1, 11, MAX_LVL):
            logger.logs(level, f"detail {level}")
    assert records == [
        (logging.INFO, "detail 0"),
        (logging.DEBUG, "detail 1"),
        (logging.DEBUG, "detail 11"),
        (logging.DEBUG, f"detail {MAX_LVL}"),
    ]

    # An INFO configuration keeps results and skips every deeper detail.
    records.clear()
    raw.setLevel(logging.INFO)
    with logger.solve_context(None):
        assert logger.is_enabled(0)
        assert not logger.on
        for level in (0, 1, MAX_LVL):
            logger.logs(level, f"detail {level}")
    assert records == [(logging.INFO, "detail 0")]


# An application that configured logging for its own warnings. Before the
# solver's loggers moved into the standard level range, detail 0 logged at
# level 1001 (above CRITICAL) through a logger forced to level 1, so this
# printed "Level 1001 SOLVE Solution 0" and, with log_level=-1, every step.
_APPLICATION = """
import io, logging, sys
stream = io.StringIO()
logging.basicConfig(
    level=getattr(logging, sys.argv[1]), stream=stream,
    format="%(levelname)s %(name)s %(message)s",
)
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
given = Sudoku(2, 2, 2, 2)
given.load("1234341221434321")
assert len(solver.solve(given)) == 1
branching = Sudoku(2, 2, 2, 2)
branching.load("12344321........")
assert len(solver.solve(branching, max_sols=2, log_level=-1)) == 2
sys.stdout.write(stream.getvalue())
"""


@pytest.mark.parametrize("level", ("WARNING", "CRITICAL"))
def test_application_logging_at_warning_or_above_hears_nothing_from_solves(level):
    root = Path(__file__).resolve().parents[1]
    environment = dict(os.environ, PYTHONPATH=str(root), PYTHONIOENCODING="utf-8")
    result = subprocess.run(
        [sys.executable, "-c", _APPLICATION, level],
        cwd=root, env=environment, capture_output=True, encoding="utf-8",
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""


def _branching_sudoku():
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")
    return grid


def test_quiet_silences_solves_even_with_a_debug_handler():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.DEBUG)
    raw = solver._lg.lg
    saved = list(raw.handlers), raw.propagate, raw.level
    _isolated_logger(raw.name, handler)
    try:
        # The handler hears a max-detail solve, so silence below is QUIET's.
        solver.solve(_branching_sudoku(), max_sols=2, log_level=-1)
        assert "Trial" in stream.getvalue()
        assert "Solution 1" in stream.getvalue()
        stream.seek(0)
        stream.truncate()

        solutions = solver.solve(
            _branching_sudoku(), max_sols=2, log_level=solver.QUIET
        )
    finally:
        raw.handlers[:], raw.propagate = saved[0], saved[1]
        raw.setLevel(saved[2])
    assert len(solutions) == 2
    assert stream.getvalue() == ""


@pytest.mark.parametrize("level", (QUIET, QUIET - 1, -(10**9)))
def test_quiet_and_lower_levels_mute_every_detail(level):
    stream = io.StringIO()
    raw = _isolated_logger(
        "gridsolver.tests.quiet", logging.StreamHandler(stream)
    )
    logger = GridLogger(raw, 0)
    with logger.solve_context(level):
        assert not any(logger.is_enabled(detail) for detail in (0, 1, MAX_LVL))
        logger.logs(0, "hidden")
    assert stream.getvalue() == ""
    # -(MAX_LVL + 1), the last value of the countdown, is still detail 0.
    assert GridLogger(raw, -(MAX_LVL + 1)).detail_level == 0


def test_silent_solver_does_not_sort_solutions_for_rendering(
    monkeypatch,
):
    raw = solver._lg.lg
    saved = list(raw.handlers), raw.propagate, raw.level
    # DEBUG admits every level, so only the NullHandler keeps this silent.
    _isolated_logger(raw.name, logging.NullHandler())

    def fail_key(solution):
        raise AssertionError("silent logging must not sort for display")

    monkeypatch.setattr(solver, "_solution_key", fail_key)
    try:
        solutions = solver.solve(
            Sudoku(1, 1, 1, 1),
            log_level=0,
            max_sols=-1,
        )
    finally:
        raw.handlers[:], raw.propagate = saved[0], saved[1]
        raw.setLevel(saved[2])
    assert len(solutions) == 1


@pytest.mark.parametrize("bad_level", (True, False, 1.5, "1", object()))
def test_public_log_levels_reject_coercive_values(bad_level):
    raw = logging.getLogger(f"gridpuzzle-invalid-level-{id(bad_level)}")
    with pytest.raises(TypeError, match="log level must be an integer"):
        GridLogger(raw, bad_level)

    logger = GridLogger(raw, 0)
    with pytest.raises(TypeError, match="log level must be an integer"):
        logger.set_lvl(bad_level)
    with (
        pytest.raises(TypeError, match="log level must be an integer"),
        logger.solve_context(bad_level),
    ):
        pass
    with pytest.raises(TypeError, match="log level must be an integer"):
        solver.solve(Sudoku(1, 1, 1, 1), log_level=bad_level)


def test_negative_log_level_shorthand_is_preserved():
    raw = logging.getLogger("gridpuzzle-negative-level")
    logger = GridLogger(raw, -1)
    assert logger.detail_level == MAX_LVL


def test_coordinate_sets_render_in_stable_numeric_order():
    render = CoordToString(3)
    assert render({8, 0, 4}) == "{(0, 0), (1, 1), (2, 2)}"


def test_colourless_grid_log_shows_current_state_not_diff_overlay():
    # regression: with Colouring.No the change overlay re-emitted removed
    # candidates with empty colour codes, printing a factually stale grid
    from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs
    from gridsolver.grid_classes.latins_square import LatinSquare
    from gridsolver.solver import logger as logger_module

    logger_module.set_colouring(logger_module.Colouring.No)
    try:
        grid_logger = logger_module.get_log("OVERLAY_TEST", MAX_LVL)
        buffer = io.StringIO()
        handler = logging.StreamHandler(buffer)
        grid_logger.lg.addHandler(handler)
        try:
            grid = LatinSquare(2)
            grid_logger.logg(0, grid, print_candidates=True)
            first = buffer.getvalue()
            buffer.truncate(0)
            buffer.seek(0)
            grid[(0, 0)] = 1
            grid_logger.logg(0, grid, print_candidates=True)
            second = buffer.getvalue()
        finally:
            grid_logger.lg.removeHandler(handler)

        true_render = grid.to_str(
            PrettyPrintArgs(args=grid.format_args, print_candidates=True)
        )[1]
        assert second != first
        assert true_render in second
    finally:
        logger_module.set_colouring(logger_module.Colouring.Colorama)


def test_logr_passes_every_rule_name_through():
    # the old allowlist silently dropped any rule name missing a prefix
    stream = io.StringIO()
    raw = _isolated_logger(
        "gridpuzzle-logr-passthrough-test", logging.StreamHandler(stream)
    )
    grid_logger = GridLogger(raw, MAX_LVL)

    grid_logger.logr("BrandNewTechnique@7", "eliminated", "(0, 0)")

    assert "BrandNewTechnique@7" in stream.getvalue()
