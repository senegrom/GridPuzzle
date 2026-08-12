from collections import deque
from concurrent.futures import ThreadPoolExecutor

from gridsolver.grid_classes.kakuro import Kakuro, KakuroRun
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


def test_internal_partition_cache_returns_immutable_shared_results():
    first = SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9)
    second = SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9)

    assert first is second
    assert first
    assert isinstance(first, tuple)
    assert all(isinstance(partition, tuple) for partition in first)


def test_internal_partition_cache_is_safe_for_concurrent_callers():
    expected = SumAndElementsAtMostOnce._partition_tuples(24, 4, 1, 9)

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = tuple(
            executor.map(
                lambda _: SumAndElementsAtMostOnce._partition_tuples(
                    24,
                    4,
                    1,
                    9,
                ),
                range(128),
            )
        )

    assert all(result is expected for result in results)


def test_partition2_preserves_detached_mutable_historical_api():
    expected = SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9)
    first = SumAndElementsAtMostOnce.partition2(15, 3, 1, 9)
    second = SumAndElementsAtMostOnce.partition2(15, 3, 1, 9)

    assert isinstance(first, list)
    assert first is not second
    assert all(isinstance(partition, deque) for partition in first)
    assert tuple(map(tuple, first)) == expected
    assert tuple(map(tuple, second)) == expected

    first[0].append(99)
    first.clear()
    assert tuple(
        map(tuple, SumAndElementsAtMostOnce.partition2(15, 3, 1, 9))
    ) == expected
    assert SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9) is expected


def test_partition_generator_returns_detached_mutable_deques():
    expected = SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9)
    exposed = list(SumAndElementsAtMostOnce.partition(15, 3, 1, 9))
    assert tuple(map(tuple, exposed)) == expected

    exposed[0].append(99)
    exposed.clear()
    assert SumAndElementsAtMostOnce._partition_tuples(15, 3, 1, 9) is expected


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
