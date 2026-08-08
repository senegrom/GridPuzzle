import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver import atomic_solver
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


def test_power_statistics_are_opt_in():
    atomic_solver.reset_power_stats()
    atomic_solver.disable_power_stats()
    before_tries = atomic_solver.POWER_TRIES.copy()
    before_times = lg.time_stats.copy()

    solver = AtomicSolver(Grid(1), [], set())
    with pytest.raises(InvalidGrid):
        solver._act("probe", _contradict)
    assert atomic_solver.POWER_TRIES == before_tries
    assert lg.time_stats == before_times

    try:
        atomic_solver.reset_power_stats()
        solver = AtomicSolver(Grid(1), [], set())
        with pytest.raises(InvalidGrid):
            solver._act("probe", _contradict)
        assert atomic_solver.POWER_TRIES["probe"] == 1
        assert atomic_solver.POWER_HITS["probe"] == 1
        assert "probe" in lg.time_stats
    finally:
        atomic_solver.disable_power_stats()
