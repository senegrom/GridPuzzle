import io
import logging

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver import solver
from gridsolver.solver.logger import GridLogger


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
