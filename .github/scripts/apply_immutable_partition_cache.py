"""Replace the mutable global cage-partition cache with immutable LRU results."""

from pathlib import Path


SUMRULES = Path("gridsolver/rules/sumrules.py")
TEST = Path("tests/test_partition_cache.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    SUMRULES,
    "from functools import cached_property\n",
    "from functools import cached_property, lru_cache\n",
    "lru_cache import",
)
replace_once(
    SUMRULES,
    '''    @cached_property
    def sum_candidates(self) -> Tuple[FrozenSet[int]]:
        len_cell = self.len_cells
        return tuple(
            frozenset(p) for p in SumAndElementsAtMostOnce.partition2(self.sum, len_cell, 1, self._max_elem)
            if len(set(p)) == len_cell
        )
''',
    '''    @cached_property
    def sum_candidates(self) -> Tuple[FrozenSet[int]]:
        len_cell = self.len_cells
        return tuple(
            frozenset(partition)
            for partition in self.partition2(
                self.sum,
                len_cell,
                1,
                self._max_elem,
            )
            if len(set(partition)) == len_cell
        )
''',
    "sum candidate formatting",
)
start_marker = "    _partition_dic = {}\n"
end_marker = "    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):\n"
text = SUMRULES.read_text(encoding="utf-8")
start = text.index(start_marker)
end = text.index(end_marker, start)
replacement = '''    @staticmethod
    @lru_cache(maxsize=65535)
    def partition2(
        n: int,
        count: int,
        mini: int = 1,
        maxi: Optional[int] = None,
    ) -> tuple[tuple[int, ...], ...]:
        """Return immutable nondecreasing bounded partitions.

        The former process-global dictionary exposed cached mutable lists of
        deques. Any caller could corrupt every later cage using the same key,
        and clearing that dictionary at an arbitrary size boundary could race
        with free-threaded callers. ``lru_cache`` owns the bound and every
        cached value is immutable.
        """
        if maxi is None:
            maxi = n
        if maxi < mini or count <= 0:
            return ()
        if count == 1:
            return ((n,),) if mini <= n <= maxi else ()

        partitions: list[tuple[int, ...]] = []
        upper = min(n // count, maxi) + 1
        for value in range(mini, upper):
            partitions.extend(
                (value, *suffix)
                for suffix in SumAndElementsAtMostOnce.partition2(
                    n - value,
                    count - 1,
                    value,
                    maxi,
                )
            )
        return tuple(partitions)

    @staticmethod
    def partition(
        n: int,
        count: int,
        mini: int,
        maxi: int,
    ) -> Iterator[Deque[int]]:
        """Compatibility iterator yielding detached mutable deques."""
        for partition in SumAndElementsAtMostOnce.partition2(
            n,
            count,
            mini,
            maxi,
        ):
            yield collections.deque(partition)

'''
SUMRULES.write_text(text[:start] + replacement + text[end:], encoding="utf-8")

TEST.write_text(
    '''from concurrent.futures import ThreadPoolExecutor

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
''',
    encoding="utf-8",
)
