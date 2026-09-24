"""Worker payloads carry puzzle state only, never solver caches or trails.

Both executors pickle the solver-owned root once under
``worker_serialization()``; ``Grid.__getstate__`` is the single place that
drops the trail journal, the derived caches and the trail-aware memos. These
tests pin that contract, so the executors need no stripping or extra clone of
their own and a future change to ``__getstate__`` cannot regress it silently.
"""
import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.trail import TrailedSet
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.solver import solve_parallel, solve_threaded, solver

_CACHES = ("_struct_cache", "_rule_cache", "_guarantee_cache")
_MEMOS = ("_fish_value_memo", "_house_sums_memo")
_SERIALIZERS = {
    "process": solve_parallel._serialize_worker_root,
    "thread": solve_threaded._serialize_thread_root,
}


def _root_with_solver_state() -> Grid:
    """A solver-owned root after its atomic pass, with every kind of state."""
    grid = Futoshiki(4).deepcopy()
    settled, branches, _ = solver._atomic_pass_or_branches(grid, [0], set())
    assert settled is None and branches, "the root must still need branching"
    for cache in _CACHES:
        getattr(grid, cache)["payload-sentinel"] = "must not reach a worker"
    for memo in _MEMOS:
        setattr(grid, memo, "must not reach a worker")
    # An open trail scope with journal entries, as a captured source can have.
    grid.trail_mark()
    cell = next(index for index, value in enumerate(grid.known) if not value)
    grid.get_candidates(cell).discard(max(grid.get_candidates(cell)))
    assert grid._trail_state.marks and grid._trail_state.entries
    return grid


@pytest.mark.parametrize("backend", sorted(_SERIALIZERS))
def test_worker_payload_carries_no_caches_memos_or_trail(backend):
    source = _root_with_solver_state()
    payload = _SERIALIZERS[backend](source)
    root = pickle.loads(payload)

    assert b"must not reach a worker" not in payload
    assert b"payload-sentinel" not in payload
    for cache in _CACHES:
        assert getattr(root, cache) == {}
    for memo in _MEMOS:
        assert not hasattr(root, memo)
    journal = root._trail_state
    assert journal.marks == [] and journal.entries == []
    assert journal.candidate_masks is None and journal.candidate_value_masks is None
    assert all(
        type(possible) is TrailedSet and possible._trail_state is journal
        for possible in root._candidates
    )

    # The puzzle state itself travels unchanged.
    assert tuple(root.known) == tuple(source.known)
    assert [set(possible) for possible in root._candidates] == [
        set(possible) for possible in source._candidates
    ]
    assert root.rules == source.rules and root.guarantees == source.guarantees
    assert root.rules_ia == source.rules_ia
    # Serialising does not strip the source: the payload is clean because of
    # __getstate__, not because an executor cleared the parent's state.
    for cache in _CACHES:
        assert getattr(source, cache)["payload-sentinel"]
    for memo in _MEMOS:
        assert hasattr(source, memo)
    assert source._trail_state.marks
