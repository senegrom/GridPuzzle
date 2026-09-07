"""Subprocess-isolated real worker failure probe (spawn/forkserver)."""

from functools import partial
import multiprocessing
import os
from pathlib import Path
import sys
import time

# This script and its spawn/forkserver workers run in fresh interpreters that
# see only the installed package. Make the checkout importable too, so the
# tests do not depend on `pip install -e` like no other test in the suite.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gridsolver.abstract_grids.grid import Grid  # noqa: E402
from gridsolver.solver import solve_parallel as parallel


def failing_branch(payload):
    directory = Path(os.environ["GRIDPUZZLE_FAILURE_PROBE"])
    _, value, _ = payload
    if value == int(os.environ.get("GRIDPUZZLE_FAILING_VALUE", "1")):
        deadline = time.monotonic() + 10
        while not (directory / "started").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("Sibling did not start")
            time.sleep(0.01)
        raise RuntimeError("Deliberate branch failure")
    (directory / "started").touch()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and not (directory / "release").exists():
        time.sleep(0.01)
    return set()


def main():
    method = sys.argv[1]
    parallel.concurrent.futures.ProcessPoolExecutor = partial(
        parallel.concurrent.futures.ProcessPoolExecutor,
        mp_context=multiprocessing.get_context(method),
    )
    parallel._solve_branch = failing_branch
    try:
        parallel.solve_parallel_trials(Grid(1, 1, 2), [(0, 1), (0, 2)], int(os.environ.get("GRIDPUZZLE_PROBE_CAP", "1")), 2)
    except RuntimeError as error:
        assert str(error) == "Deliberate branch failure", repr(error)
    else:
        raise AssertionError("Expected the worker's original error")
    deadline = time.monotonic() + 5
    while multiprocessing.active_children() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not multiprocessing.active_children(), "Sibling process leaked"
    print("original error preserved; no live workers")


if __name__ == "__main__":
    main()
