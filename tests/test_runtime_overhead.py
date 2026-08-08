from contextvars import Context

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver import atomic_solver, solver as grid_solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.solver_log import lg


def _contradict() -> None:
    raise InvalidGrid()


def test_singleton_assignment_does_not_journal_noop_candidate_change():
    grid = Grid(1, 1, max_elem=2)
    grid.get_candidates(0).intersection_update({1})
    mark = grid.trail_mark()

    grid[0] = 1

    assert [entry[0] for entry in grid._trail_state.entries] == ["known"]
    grid.trail_undo(mark)
    assert grid[0] == 0
    assert grid.get_candidates(0) == {1}


def test_power_statistics_are_opt_in_and_context_local():
    assert atomic_solver.current_power_stats() is None
    solver = AtomicSolver(Grid(1), [], set())
    with pytest.raises(InvalidGrid):
        solver._act("probe", _contradict)

    with atomic_solver.collect_power_stats() as outer:
        solver = AtomicSolver(Grid(1), [], set())
        with pytest.raises(InvalidGrid):
            solver._act("probe", _contradict)
        assert outer.tries["probe"] == 1
        assert outer.hits["probe"] == 1
        assert "probe" in outer.timings

        def collect_isolated():
            assert atomic_solver.current_power_stats() is None
            with atomic_solver.collect_power_stats() as inner:
                isolated_solver = AtomicSolver(Grid(1), [], set())
                with pytest.raises(InvalidGrid):
                    isolated_solver._act("isolated", _contradict)
                return inner

        inner = Context().run(collect_isolated)
        assert inner.tries == {"isolated": 1}
        assert "isolated" not in outer.tries

    assert atomic_solver.current_power_stats() is None


def test_power_statistics_merge_independent_results():
    first = atomic_solver.PowerStats()
    first.tries["probe"] = 2
    first.timings["probe"] = 0.5
    second = atomic_solver.PowerStats()
    second.tries["probe"] = 3
    second.hits["probe"] = 1
    second.timings["probe"] = 0.25

    first.merge(second)

    assert first.tries["probe"] == 5
    assert first.hits["probe"] == 1
    assert first.timings["probe"] == pytest.approx(0.75)


def test_parallel_workers_return_and_merge_power_statistics():
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")

    with atomic_solver.collect_power_stats() as stats:
        solutions = grid_solver.solve(
            grid,
            log_level=0,
            max_sols=2,
            processes=2,
        )

    assert len(solutions) == 2
    assert stats.tries
    assert stats.timings


def test_logger_state_is_scoped_per_solve_context():
    before_level = lg.detail_level
    buffer_token = lg._grid_buf.set("parent")
    try:
        with lg.solve_context(3):
            assert lg.detail_level == 3
            assert lg._grid_buf.get() is None
            lg._grid_buf.set("solve")

        assert lg.detail_level == before_level
        assert lg._grid_buf.get() == "parent"
    finally:
        lg._grid_buf.reset(buffer_token)


def test_public_solve_restores_the_callers_log_level():
    before = lg.detail_level

    solutions = grid_solver.solve(Grid(1), log_level=3)

    assert len(solutions) == 1
    assert lg.detail_level == before
