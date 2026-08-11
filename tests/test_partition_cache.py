from concurrent.futures import ThreadPoolExecutor

from gridsolver.grid_classes.kakuro import Kakuro, KakuroRun
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


def test_partition_cache_returns_immutable_shared_results():
    first = SumAndElementsAtMostOnce.partition2(15, 3, 1, 9)
    second = SumAndElementsAtMostOnce.partition2(15, 3, 1, 9)

    assert first is second
    assert first
    assert isinstance(first, tuple)
    assert all(isinstance(partition, tuple) for partition in first)


def test_partition_cache_is_safe_for_concurrent_callers():
    expected = SumAndElementsAtMostOnce.partition2(24, 4, 1, 9)

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = tuple(
            executor.map(
                lambda _: SumAndElementsAtMostOnce.partition2(24, 4, 1, 9),
                range(128),
            )
        )

    assert all(result is expected for result in results)


def test_partition_generator_returns_detached_mutable_deques():
    cached = SumAndElementsAtMostOnce.partition2(15, 3, 1, 9)
    exposed = list(SumAndElementsAtMostOnce.partition(15, 3, 1, 9))
    assert tuple(map(tuple, exposed)) == cached

    exposed[0].append(99)
    exposed.clear()
    assert SumAndElementsAtMostOnce.partition2(15, 3, 1, 9) is cached


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
