"""Real-process source ownership probe; PYTHONPATH is supplied by the test."""

from functools import partial
from itertools import product
import multiprocessing
import sys
import time

from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.rules.rules import Rule
from gridsolver.solver import solve_parallel as parallel
from gridsolver.solver.solver import solve


class BinaryGrid(Grid):
    technique_profile = TechniqueProfile.RULES_ONLY


class CapturedRule(Rule):
    # Inherited Rule hash intentionally exercises the formerly cyclic pickle.
    def __init__(self, source):
        super().__init__(source, cells=(0, 1))
        self.source = source

    def apply(self, known, candidates, guarantees=None):
        if known[1]:
            self.source[0] = known[1]
        return False, None, None


def main():
    method, cap = sys.argv[1], int(sys.argv[2])
    parallel.concurrent.futures.ProcessPoolExecutor = partial(
        parallel.concurrent.futures.ProcessPoolExecutor,
        mp_context=multiprocessing.get_context(method),
    )
    expected = set(product((1, 2), repeat=2))
    previous = None
    for _ in range(2):
        source = BinaryGrid(1, 2, 2)
        source.add_rule_checked(CapturedRule(source))
        solutions = {tuple(s) for s in solve(source, log_level=-1, processes=2, max_sols=cap)}
        assert solutions <= expected
        assert len(solutions) == (4 if cap == -1 else cap)
        if previous is not None:
            assert solutions == previous
        previous = solutions
        assert source.known == (0, 0)
        assert not source.has_been_filled and not source._trail_state.marks
    # CPython terminate_workers() signals processes after shutdown(wait=False).
    # Observe bounded eventual cleanup without joining or killing on its behalf.
    deadline = time.monotonic() + 5
    while multiprocessing.active_children() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not multiprocessing.active_children(), "Worker process leaked"
    print("worker source isolation verified")


if __name__ == "__main__":
    main()
