"""Complete Killer solves while the partition cache can hold almost nothing.

The 2026-09-24 fuzz pass solved Killer boards with the process-wide
partition cache capped at 0/0 and 64/32 bytes, so that nearly every lookup
regenerates or evicts, and found every result exact. Nothing else in the
suite runs whole solves under such a cap: a rule must keep its own
partitions however soon the cache lets them go.
"""
import pytest

from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules import sumrules
from gridsolver.solver import solver
from tests.test_family_oracles import _decode_4x4, _killer_instances


@pytest.mark.parametrize(("max_bytes", "max_entry_bytes"), ((0, 0), (64, 32)))
def test_killer_solves_are_exact_under_a_tiny_partition_cache(monkeypatch, max_bytes, max_entry_bytes):
    tiny = sumrules._PartitionMaskCache(max_bytes=max_bytes, max_entry_bytes=max_entry_bytes)
    monkeypatch.setattr(sumrules, "_PARTITION_MASKS", tiny)
    counts = []
    # Different boards one after another in one process: nothing a previous
    # solve left in (or evicted from) the cache may change the next one.
    for make, expected in _killer_instances(20260926, 8):
        for cap in (-1, 1, 2):
            grid = make(KillerSudoku)
            found = {_decode_4x4(grid, solution)
                     for solution in solver.solve(grid, max_sols=cap, log_level=solver.QUIET)}
            if cap == -1:
                assert found == expected
            else:
                assert len(found) == min(cap, len(expected))
                assert found <= expected
            assert tiny.info()[1] <= max_bytes
        counts.append(len(expected))
    assert 0 in counts and 1 in counts
