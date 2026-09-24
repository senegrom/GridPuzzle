from gridsolver.grid_classes.kakuro import Kakuro, KakuroRun
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


# The process-wide partition cache itself (byte bound, eviction, concurrent
# misses, release) is tested in test_partition_memory.py.


def test_kakuro_sum_candidates_use_immutable_partition_cache():
    grid = Kakuro(
        3,
        3,
        white_cells=((1, 1), (1, 2), (2, 1), (2, 2)),
        runs=(
            KakuroRun(3, ((1, 1), (1, 2))),
            KakuroRun(7, ((2, 1), (2, 2))),
            KakuroRun(4, ((1, 1), (2, 1))),
            KakuroRun(6, ((1, 2), (2, 2))),
        ),
    )
    cages = tuple(
        rule
        for rule in grid.rules
        if isinstance(rule, SumAndElementsAtMostOnce)
    )
    assert all(cage.sum_candidates for cage in cages)
