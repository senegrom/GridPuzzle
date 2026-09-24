"""Compact, bounded distinct-value partitions for sum cages.

One 12-cell cage on a 25x25 board used to keep about 94 MiB of frozensets and
partition tuples alive, and a process-wide cache bounded only by entry count
kept them after the solve. Partitions are now bitmask arrays, the process
cache is bounded by bytes and skips huge results, and the browser adapter
releases it after every solve. Exactness is checked against brute force.
"""
import random
from array import array
from concurrent.futures import ThreadPoolExecutor
from itertools import combinations, permutations

import pytest

from gridsolver import web_api
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules import sumrules
from gridsolver.rules.rules import Guarantee, InvalidGrid, RuleAlwaysSatisfied
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce


def _masks(values_list):
    return [sum(1 << value for value in values) for values in values_list]


def test_large_cage_partitions_are_compact_bitmasks():
    size = GridSizeContainer(25, 25, 25)
    cage = SumAndElementsAtMostOnce(size, [(0, col) for col in range(10)], 130)
    masks = cage._partition_masks

    assert isinstance(masks, array) and masks.itemsize <= 4
    assert len(masks) == 70922
    # about 0.3 MiB instead of the former ~59 MiB of frozensets and tuples
    assert masks.itemsize * len(masks) < 1 << 20
    assert all(mask.bit_count() == 10 for mask in masks[:1000])
    assert all(sum(sumrules._mask_values(mask)) == 130 for mask in masks[-1000:])
    # the rule keeps its own reference when the process cache is released
    sumrules.release_partition_caches()
    assert cage._partition_masks is masks


@pytest.mark.parametrize("maximum", (1, 2, 5, 9, 12))
def test_partition_masks_equal_ordered_combinations(maximum):
    for count in range(1, maximum + 2):
        by_sum = {}
        for values in combinations(range(1, maximum + 1), count):
            by_sum.setdefault(sum(values), []).append(values)
        for target in range(-1, count * maximum + 2):
            got = sumrules._distinct_partition_masks(count, target, maximum)
            assert got == _masks(by_sum.get(target, ()))


def test_process_cache_is_bounded_by_bytes_and_skips_huge_results():
    cache = sumrules._PartitionMaskCache(max_bytes=4096, max_entry_bytes=1024)
    small = cache.get(3, 15, 9)  # 8 partitions
    assert list(small) == _masks(v for v in combinations(range(1, 10), 3) if sum(v) == 15)
    assert cache.get(3, 15, 9) is small
    assert cache.info() == (1, small.itemsize * len(small))

    huge = cache.get(10, 130, 25)  # far above max_entry_bytes: returned, not kept
    assert len(huge) == 70922
    assert cache.info() == (1, small.itemsize * len(small))
    assert cache.get(10, 130, 25) is not huge

    # least recently used entries go first once max_bytes is exceeded
    for target in range(40, 80):
        cache.get(6, target, 16)
        assert cache.info()[1] <= 4096
    entries, nbytes = cache.info()
    assert entries >= 1 and nbytes <= 4096
    cache.clear()
    assert cache.info() == (0, 0)


def test_process_cache_is_safe_for_concurrent_callers():
    sumrules.release_partition_caches()
    expected = list(sumrules._PARTITION_MASKS.get(6, 60, 16))
    sumrules.release_partition_caches()
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(
            lambda _: sumrules._PARTITION_MASKS.get(6, 60, 16), range(128)
        ))
    assert all(list(result) == expected for result in results)
    published = sumrules._PARTITION_MASKS.get(6, 60, 16)
    assert sumrules._PARTITION_MASKS.get(6, 60, 16) is published


def test_browser_solve_releases_partition_caches():
    solution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1]
    cages = [[0, 1], [2, 3], [4, 8], [5, 6, 7], [9, 10, 11], [12, 13], [14, 15]]
    payload = {
        "version": 1, "type": "killersudoku", "rows": 4, "cols": 4,
        "boxRows": 2, "boxCols": 2, "cells": [None] * 16,
        "cages": [{"cells": cells, "target": sum(solution[i] for i in cells)} for cells in cages],
    }
    result = web_api.solve_payload(payload)
    assert result["status"] in ("unique", "multiple")
    assert sumrules._PARTITION_MASKS.info() == (0, 0)
    assert SumAndElementsAtMostOnce._partition_tuples.cache_info().currsize == 0


def _bruteforce(maximum, target, known, candidates, guarantees):
    """Candidate sets every complete cage assignment supports, or None."""
    count = len(known)
    unknown = [i for i in range(count) if not known[i]]
    fixed = [known[i] for i in range(count) if known[i]]
    if len(set(fixed)) != len(fixed):
        return None
    restrictions = [
        (g.val, {unknown.index(cell) for cell in g.cells})
        for g in guarantees if set(g.cells) <= set(unknown)
    ]
    supported = [set() for _ in unknown]
    free_values = [v for v in range(1, maximum + 1) if v not in fixed]
    for values in permutations(free_values, len(unknown)):
        if sum(values) + sum(fixed) != target:
            continue
        if any(v not in candidates[cell] for v, cell in zip(values, unknown)):
            continue
        if any(value not in values or values.index(value) not in positions
               for value, positions in restrictions):
            continue
        for position, value in enumerate(values):
            supported[position].add(value)
    if not all(supported):
        return None
    return supported


def test_cage_filter_equals_bruteforce_assignments():
    # Independent of partition generation, the matching and its early exit:
    # every surviving candidate must occur in a complete valid assignment
    # and every value some valid assignment uses must survive.
    rng = random.Random(20260923)
    checked = 0
    while checked < 400:
        maximum = rng.randint(2, 9)
        count = rng.randint(2, min(maximum, 5))
        size = GridSizeContainer(1, count, maximum)
        target = rng.randint(count * (count + 1) // 2 - 1, count * (2 * maximum - count + 1) // 2 + 1)
        candidates = tuple({v for v in range(1, maximum + 1) if rng.random() < 0.7} or {1}
                           for _ in range(count))
        known = [0] * count
        for cell in rng.sample(range(count), rng.randint(0, count - 2)):
            known[cell] = rng.choice(sorted(candidates[cell]))
        guarantees = tuple(
            Guarantee(rng.randint(1, maximum), frozenset(rng.sample(range(count), rng.randint(1, count))), 1, count)
            for _ in range(rng.randrange(3))
        )
        expected = _bruteforce(maximum, target, known, candidates, guarantees)
        state = tuple(set(values) for values in candidates)
        for cell, value in enumerate(known):
            if value:
                state[cell].intersection_update((value,))
        rule = SumAndElementsAtMostOnce(size, range(count), target)
        try:
            rule.apply(list(known), state, guarantees)
        except InvalidGrid:
            assert expected is None, (maximum, target, known, candidates, guarantees)
            checked += 1
            continue
        except RuleAlwaysSatisfied:
            continue
        assert expected is not None, (maximum, target, known, candidates, guarantees)
        unknown = [i for i in range(count) if not known[i]]
        assert [state[cell] for cell in unknown] == expected
        checked += 1
