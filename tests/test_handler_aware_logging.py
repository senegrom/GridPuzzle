import io
import logging

import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
from gridsolver.solver.logger import CoordToString, GridLogger, MAX_LVL


def test_null_handler_is_not_treated_as_visible_output(monkeypatch):
    raw = logging.getLogger("gridpuzzle-null-handler-test")
    raw.handlers[:] = [logging.NullHandler()]
    raw.propagate = False
    logger = GridLogger(raw, 0)

    with logger.solve_context(0):
        assert not logger.is_enabled(0)


def test_real_handler_remains_visible():
    raw = logging.getLogger("gridpuzzle-real-handler-test")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    raw.handlers[:] = [handler]
    raw.propagate = False
    logger = GridLogger(raw, 0)

    with logger.solve_context(0):
        assert logger.is_enabled(0)
        logger.logs(0, "visible")
    assert "visible" in stream.getvalue()


def test_silent_solver_does_not_sort_solutions_for_rendering(
    monkeypatch,
):
    raw = solver._lg.lg
    old_handlers = list(raw.handlers)
    old_propagate = raw.propagate
    raw.handlers[:] = [logging.NullHandler()]
    raw.propagate = False

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
        raw.handlers[:] = old_handlers
        raw.propagate = old_propagate
    assert len(solutions) == 1


@pytest.mark.parametrize("bad_level", (True, False, 1.5, "1", object()))
def test_public_log_levels_reject_coercive_values(bad_level):
    raw = logging.getLogger(f"gridpuzzle-invalid-level-{id(bad_level)}")
    with pytest.raises(TypeError, match="log level must be an integer"):
        GridLogger(raw, bad_level)

    logger = GridLogger(raw, 0)
    with pytest.raises(TypeError, match="log level must be an integer"):
        logger.set_lvl(bad_level)
    with pytest.raises(TypeError, match="log level must be an integer"):
        with logger.solve_context(bad_level):
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
    raw = logging.getLogger("gridpuzzle-logr-passthrough-test")
    stream = io.StringIO()
    raw.handlers[:] = [logging.StreamHandler(stream)]
    raw.propagate = False
    grid_logger = GridLogger(raw, MAX_LVL)

    grid_logger.logr("BrandNewTechnique@7", "eliminated", "(0, 0)")

    assert "BrandNewTechnique@7" in stream.getvalue()
