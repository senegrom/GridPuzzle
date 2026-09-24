import collections
import functools
import itertools
import operator
import reprlib
import threading
from array import array
from functools import cached_property, lru_cache
from numbers import Integral
from typing import Tuple, Set, Sequence, List, Iterable, Deque, MutableSequence, Iterator, Optional, FrozenSet

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Rule, Guarantee, RuleAlwaysSatisfied, InvalidGrid, IdxType, _format_coord
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.util import iter_bits


def _integer_target(name: str, target: object) -> int:
    if isinstance(target, bool) or not isinstance(target, Integral):
        raise TypeError(f"{name} targets must be integers, got {target!r}")
    return int(target)


class SumRule(Rule):
    __slots__ = ("sum",)

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], mysum: int):
        if gsz is not None and cells is not None:
            super().__init__(gsz, cells, None)
            self.cells = tuple(sorted(self.cells))
        self.sum = _integer_target("Sum", mysum)

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        my_known: List[int] = []
        for cell in self.cells:
            k = known[cell]
            if k > 0:
                my_known.append(k)

        lk = len(my_known)
        current_sum = sum(my_known)
        if lk == self.len_cells and current_sum == self.sum:
            raise RuleAlwaysSatisfied()
        if lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.sum - current_sum
            last_cell = next(cell for cell in self.cells if known[cell] == 0)
            if k in candidates[last_cell]:
                candidates[last_cell].intersection_update((k,))
                raise RuleAlwaysSatisfied()
            candidates[last_cell].clear()
            raise InvalidGrid()

        remaining_unknowns = self.len_cells - lk
        remaining_sum = self.sum - current_sum
        tmax = remaining_sum - remaining_unknowns + 1  # max if all other unknowns are min 1
        tmin = remaining_sum - (remaining_unknowns - 1) * self._max_elem  # min if all others are max
        for cell in self.cells:
            if known[cell] == 0:
                for c in list(candidates[cell]):
                    if c > tmax or c < tmin:
                        candidates[cell].discard(c)
                if not candidates[cell]:
                    raise InvalidGrid()

        if lk:
            # remaining_sum < 0 is impossible here: the tmin/tmax pruning
            # above already emptied every unknown cell and raised
            return False, [
                SumRule(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=[cell for cell in self.cells if known[cell] == 0], mysum=remaining_sum
                )
            ], []

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumRule
        return self.sum == other.sum

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.sum}: {cell_str}]"


class DiffRule(Rule):
    __slots__ = ("diff",)

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        target = _integer_target("Difference", target)
        if target < 0:
            raise ValueError("Difference targets must be non-negative")
        if gsz is not None and cells is not None:
            cells = list(cells)
            if len(cells) != 2:
                raise ValueError("Difference cages must contain exactly two cells")
            super().__init__(gsz, cells, None)
            if self.cells[0] > self.cells[1]:
                self.cells = tuple(reversed(self.cells))
        self.diff = target

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        first = known[self.cells[0]]
        second = known[self.cells[1]]
        if first > 0 and second > 0 and (first - second == self.diff or second - first == self.diff):
            raise RuleAlwaysSatisfied()
        if first > 0 and second > 0:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif first > 0:
            new_cand = {first - self.diff, first + self.diff}
            candidates[self.cells[1]].intersection_update(new_cand)
            if len(candidates[self.cells[1]]) == 1:
                raise RuleAlwaysSatisfied()
            if len(candidates[self.cells[1]]) == 0:
                raise InvalidGrid()
        elif second > 0:
            new_cand = {second - self.diff, second + self.diff}
            candidates[self.cells[0]].intersection_update(new_cand)
            if len(candidates[self.cells[0]]) == 1:
                raise RuleAlwaysSatisfied()
            if len(candidates[self.cells[0]]) == 0:
                raise InvalidGrid()

        for cell in self.cells:
            for c in list(candidates[cell]):
                t1 = c + self.diff
                t2 = c - self.diff
                t2 = t2 if t2 > 0 else -1
                for cell2 in self.cells:
                    if cell == cell2:
                        continue
                    if t1 in candidates[cell2]:
                        t1 = 0
                    if t2 in candidates[cell2]:
                        t2 = 0
                    if t1 == 0 or t2 == 0:
                        break
                if t1 != 0 and t2 != 0:
                    candidates[cell].discard(c)
        if any(not candidates[cell] for cell in self.cells):
            raise InvalidGrid()

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.diff))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: DiffRule
        return self.diff == other.diff

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.diff}: {cell_str}]"


class ProdRule(Rule):
    __slots__ = ("prod",)

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        target = _integer_target("Product", target)
        if target <= 0:
            raise ValueError("Product targets must be positive")
        if gsz is not None and cells is not None:
            super().__init__(gsz, cells, None)
            self.cells = tuple(sorted(self.cells))
        self.prod = target

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
        my_known: List[int] = []
        for cell in self.cells:
            k = known[cell]

            if k > 0:
                my_known.append(k)

        lk = len(my_known)
        current_prod = 1
        for k in my_known:
            current_prod *= k
        if lk == self.len_cells and current_prod == self.prod:
            raise RuleAlwaysSatisfied()
        if lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            # integer arithmetic: float division silently loses exactness once
            # the product exceeds 2**53 (large cages)
            k, rem = divmod(self.prod, current_prod)
            last_cell = next(cell for cell in self.cells if known[cell] == 0)
            if rem:
                candidates[last_cell].clear()
                raise InvalidGrid()
            if k in candidates[last_cell]:
                candidates[last_cell].intersection_update((k,))
                raise RuleAlwaysSatisfied()
            candidates[last_cell].clear()
            raise InvalidGrid()

        remaining_prod, rem = divmod(self.prod, current_prod)
        if rem:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        for cell in self.cells:
            if known[cell] == 0:
                # Max value: remaining_prod with all other unknowns at their min (1);
                # and every value must divide the remaining product exactly.
                for c in list(candidates[cell]):
                    if c > remaining_prod or remaining_prod % c:
                        candidates[cell].discard(c)

        if any(not candidates[cell] for cell in self.cells):
            raise InvalidGrid()

        if lk:
            new_target = remaining_prod
            return False, [
                ProdRule(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=[cell for cell in self.cells if known[cell] == 0], target=new_target
                )
            ], []

        return False, None, []

    def __hash__(self):
        return hash((super().__hash__(), self.prod))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: ProdRule
        return self.prod == other.prod

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.prod}: {cell_str}]"


class DivRule(Rule):
    __slots__ = ("div",)

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        target = _integer_target("Division", target)
        if target <= 0:
            raise ValueError("Division targets must be positive")
        if gsz is not None and cells is not None:
            cells = list(cells)
            if len(cells) != 2:
                raise ValueError("Division cages must contain exactly two cells")
            super().__init__(gsz, cells, None)
            if self.cells[0] > self.cells[1]:
                self.cells = tuple(reversed(self.cells))
        self.div = target

    def __hash__(self):
        return hash((super().__hash__(), self.div))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: DivRule
        return self.div == other.div

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:
        first_cell, second_cell = self.cells
        first = known[first_cell]
        second = known[second_cell]

        if first > 0 and second > 0:
            if first == second * self.div or second == first * self.div:
                raise RuleAlwaysSatisfied()
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)

        if first > 0:
            allowed = {first * self.div}
            quotient, remainder = divmod(first, self.div)
            if remainder == 0:
                allowed.add(quotient)
            candidates[second_cell].intersection_update(allowed)
            if not candidates[second_cell]:
                raise InvalidGrid()
            if len(candidates[second_cell]) == 1:
                raise RuleAlwaysSatisfied()

        elif second > 0:
            allowed = {second * self.div}
            quotient, remainder = divmod(second, self.div)
            if remainder == 0:
                allowed.add(quotient)
            candidates[first_cell].intersection_update(allowed)
            if not candidates[first_cell]:
                raise InvalidGrid()
            if len(candidates[first_cell]) == 1:
                raise RuleAlwaysSatisfied()

        for cell, other_cell in ((first_cell, second_cell), (second_cell, first_cell)):
            other_candidates = candidates[other_cell]
            for value in tuple(candidates[cell]):
                multiplied = value * self.div
                quotient, remainder = divmod(value, self.div)
                if multiplied not in other_candidates and (remainder != 0 or quotient not in other_candidates):
                    candidates[cell].discard(value)
            if not candidates[cell]:
                raise InvalidGrid()

        return False, None, []

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.div}: {cell_str}]"


# todo combine to sum rules for large areas
# todo subtract from guarantees to make new subrules


def _admissible_assignments(values: Sequence[int], cand_sets: Sequence[Set[int]],
                            restrict: dict) -> Iterator[Tuple[int, int]]:
    """All (position, value) pairs occurring in at least one bijection of
    `values` onto the positions, where position i admits value v iff
    v in cand_sets[i] and (v unrestricted or i in restrict[v]).

    Regin (1994): a maximum bipartite matching decides feasibility; a non-matched
    edge participates in some perfect matching iff its endpoints share a strongly
    connected component of the residual digraph (unmatched value->position,
    matched position->value). Polynomial in the cage size, replacing k!
    permutation enumeration.

    NOTE: restrict keys outside `values` are ignored here — the caller must skip
    partitions that omit a guaranteed value (a bare `return` would read as "this
    partition admits nothing", silently losing solutions)."""
    k = len(cand_sets)
    vals = list(values)
    if len(vals) != k:
        raise ValueError(
            "Expected one candidate set for every assignment value"
        )
    edges = {}
    for v in vals:
        allowed = restrict.get(v)
        edges[v] = [i for i in range(k)
                    if v in cand_sets[i] and (allowed is None or i in allowed)]

    match_pos: dict = {}  # position -> value
    match_val: dict = {}  # value -> position

    def try_augment(start: int) -> bool:
        """Find one augmenting path without consuming Python stack."""
        visited: set[int] = set()
        # Each child frame records the matched position that led to it.
        # Iterators preserve the recursive DFS edge order exactly.
        parent: dict[int, tuple[int, int] | None] = {start: None}
        work = [(start, iter(edges[start]))]
        while work:
            value, choices = work[-1]
            for position in choices:
                if position in visited:
                    continue
                visited.add(position)
                owner = match_pos.get(position)
                if owner is None:
                    # Match the free edge, then flip every alternating
                    # edge on the path back to the unmatched root value.
                    match_pos[position] = value
                    match_val[value] = position
                    while parent[value] is not None:
                        parent_value, parent_position = parent[value]
                        match_pos[parent_position] = parent_value
                        match_val[parent_value] = parent_position
                        value = parent_value
                    return True
                parent[owner] = (value, position)
                work.append((owner, iter(edges[owner])))
                break
            else:
                work.pop()
        return False

    for v in vals:
        if not try_augment(v):
            return  # no perfect matching: this partition admits no assignment

    # residual digraph: nodes = values (0..k-1 by index) and positions (k..2k-1)
    val_index = {v: j for j, v in enumerate(vals)}
    succ: List[List[int]] = [[] for _ in range(2 * k)]
    for v in vals:
        vn = val_index[v]
        for i in edges[v]:
            if match_val[v] == i:
                succ[k + i].append(vn)
            else:
                succ[vn].append(k + i)

    comp = _tarjan_scc(succ)
    for v in vals:
        vn = val_index[v]
        for i in edges[v]:
            if match_val[v] == i or comp[vn] == comp[k + i]:
                yield i, v


def _tarjan_scc(succ: Sequence[Sequence[int]]) -> List[int]:
    """Strongly connected component id per node (iterative Tarjan)."""
    n = len(succ)
    index = [-1] * n
    low = [0] * n
    on_stack = [False] * n
    stack: List[int] = []
    comp = [-1] * n
    counter = 0
    comp_id = 0

    for root in range(n):
        if index[root] != -1:
            continue
        work = [(root, iter(succ[root]))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack[root] = True
        while work:
            node, it = work[-1]
            advanced = False
            for nb in it:
                if index[nb] == -1:
                    index[nb] = low[nb] = counter
                    counter += 1
                    stack.append(nb)
                    on_stack[nb] = True
                    work.append((nb, iter(succ[nb])))
                    advanced = True
                    break
                if on_stack[nb]:
                    low[node] = min(low[node], index[nb])
            if advanced:
                continue
            work.pop()
            if low[node] == index[node]:
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    comp[w] = comp_id
                    if w == node:
                        break
                comp_id += 1
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
    return comp


# Values encoded by a partition bitmask (bit v = value v), ascending.
_mask_values = iter_bits


def _mask_of(values: Iterable[int]) -> int:
    mask = 0
    for value in values:
        mask |= 1 << value
    return mask


def _or_all(masks: Iterable[int]) -> int:
    return functools.reduce(operator.or_, masks, 0)


def _and_all(masks: Sequence[int]) -> int:
    return functools.reduce(operator.and_, masks)


def _distinct_partition_masks(count: int, target: int, max_elem: int) -> List[int]:
    """Every set of ``count`` distinct values in 1..max_elem summing to
    ``target``, as bitmasks in lexicographic order of the sorted values.

    Explicit DFS over the next (strictly larger) value with exact bounds: the
    rest must fit between the next consecutive values and the largest ones.
    Nothing is truncated or approximated; the last two values of each set are
    placed directly instead of through one more stack frame each.
    """
    masks: List[int] = []
    if count <= 0 or count > max_elem:
        return masks
    append = masks.append
    work = [(count, 0, target, 0)]  # (values left, previous value, sum left, mask)
    while work:
        left, previous, remaining, mask = work.pop()
        if left == 1:
            if previous < remaining <= max_elem:
                append(mask | 1 << remaining)
            continue
        rest = left - 1
        # rest values above x sum to at most rest*max_elem - rest*(rest-1)/2
        # and at least rest*x + rest*(rest+1)/2.
        first = max(previous + 1, remaining - rest * max_elem + rest * (rest - 1) // 2)
        last = min((remaining - rest * (rest + 1) // 2) // left, max_elem - rest)
        if left == 2:
            for value in range(first, last + 1):
                append(mask | 1 << value | 1 << (remaining - value))
            continue
        # Reverse pushes pop the smallest next value first (lexicographic).
        for value in range(last, first - 1, -1):
            work.append((rest, value, remaining - value, mask | 1 << value))
    return masks


def _compact_masks(masks: List[int], max_elem: int) -> Sequence[int]:
    """Store masks in the smallest unsigned array that holds bit max_elem."""
    for typecode in ("I", "L", "Q"):
        if array(typecode).itemsize * 8 > max_elem:
            return array(typecode, masks)
    return tuple(masks)


def _masks_nbytes(masks: Sequence[int]) -> int:
    if isinstance(masks, array):
        return masks.itemsize * len(masks)
    # Tuple slot plus an int object of ceil(bits/30) 4-byte digits.
    return sum(8 + 28 + 4 * (mask.bit_length() // 30) for mask in masks)


class _PartitionMaskCache:
    """Process-wide store of distinct-value partitions, bounded by bytes.

    The former ``lru_cache(maxsize=65535)`` of partition tuples was bounded
    by entry count only: one 12-cell cage on a 25x25 board kept about 94 MiB
    of frozensets and tuples alive. Partitions are now compact bitmask arrays
    (4 bytes each up to value 31). Results larger than ``max_entry_bytes`` are
    never retained here; the rules that need them hold their own reference,
    so they are released with the grid. The least recently used entries are
    evicted once ``max_bytes`` is exceeded. Values are immutable (arrays are
    never handed out for mutation) and shared by every rule with the same
    (count, target, max_elem).
    """

    __slots__ = ("_entries", "_nbytes", "_lock", "max_bytes", "max_entry_bytes")

    def __init__(self, max_bytes: int, max_entry_bytes: int) -> None:
        self._entries: collections.OrderedDict = collections.OrderedDict()
        self._nbytes = 0
        self._lock = threading.Lock()
        self.max_bytes = max_bytes
        self.max_entry_bytes = max_entry_bytes

    def get(self, count: int, target: int, max_elem: int) -> Sequence[int]:
        key = (count, target, max_elem)
        with self._lock:
            masks = self._entries.get(key)
            if masks is not None:
                self._entries.move_to_end(key)
                return masks
        # Generate outside the lock: concurrent callers may duplicate work but
        # always agree, and only one result is published.
        masks = _compact_masks(_distinct_partition_masks(count, target, max_elem), max_elem)
        nbytes = _masks_nbytes(masks)
        if nbytes > self.max_entry_bytes:
            return masks
        with self._lock:
            published = self._entries.get(key)
            if published is not None:
                return published
            self._entries[key] = masks
            self._nbytes += nbytes
            while self._nbytes > self.max_bytes and self._entries:
                _, evicted = self._entries.popitem(last=False)
                self._nbytes -= _masks_nbytes(evicted)
        return masks

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._nbytes = 0

    def info(self) -> Tuple[int, int]:
        """(entries, bytes) currently retained."""
        with self._lock:
            return len(self._entries), self._nbytes


_PARTITION_MASKS = _PartitionMaskCache(max_bytes=8 << 20, max_entry_bytes=2 << 20)


def release_partition_caches() -> None:
    """Drop every process-wide partition cache.

    Long-lived interpreters that solve one puzzle after another (the browser
    worker reuses one Pyodide interpreter) call this after each solve. Rules
    still alive keep their own partitions, so this never changes a result.
    """
    _PARTITION_MASKS.clear()
    SumAndElementsAtMostOnce._partition_tuples.cache_clear()


class SumAndElementsAtMostOnce(ElementsAtMostOnce, SumRule):
    def __init__(self, gsz: GridSizeContainer, cells: Iterable[IdxType], mysum: int):
        ElementsAtMostOnce.__init__(self, gsz, cells, None)
        SumRule.__init__(self, None, None, mysum)

    @cached_property
    def _partition_masks(self) -> Sequence[int]:
        # Every admissible set of distinct values as one bitmask (bit v set
        # for value v), in lexicographic order. Shared through the bounded
        # process cache; this instance keeps its own reference so evicting a
        # cache entry never forces a rebuild while the rule is alive. Generate
        # only admissible distinct partitions; do not approximate or defer the
        # full matching/guarantee filter.
        return _PARTITION_MASKS.get(self.len_cells, self.sum, self._max_elem)

    @property
    def sum_candidates(self) -> Tuple[FrozenSet[int], ...]:
        """Every admissible value set, decoded on demand from the bitmasks.

        Kept for inspection and compatibility; propagation consumes the
        compact ``_partition_masks`` directly and never materialises these.
        """
        return tuple(frozenset(_mask_values(mask)) for mask in self._partition_masks)

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumAndElementsAtMostOnce
        return self.sum == other.sum

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        # reprlib shows at most maxlist items, so decode only one more than that.
        shown = [set(_mask_values(mask))
                 for mask in itertools.islice(self._partition_masks, reprlib.aRepr.maxlist + 1)]
        return f"{type(self).__name__}[{self.sum}: {cell_str}; {reprlib.repr(shown)}]"

    @staticmethod
    @lru_cache(maxsize=65535)
    def _partition_tuples(
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
        if maxi < mini or count <= 0 or not count * mini <= n <= count * maxi:
            return ()

        # Explicit lexicographic DFS. The old recursive call graph could exceed
        # Python's recursion limit even when a thousand-cell cage had ONE
        # admissible partition. Frames store only scalars; a single prefix is
        # reused instead of copying it at each depth. No partitions or matching
        # deductions are truncated, deferred or replaced by bounds-only logic.
        partitions: list[tuple[int, ...]] = []
        prefix: list[int] = []
        work = [(n, count, mini, 0)]
        while work:
            remaining, left, lower, depth = work.pop()
            if depth:
                prefix[depth - 1:] = [lower]
            if remaining == left * lower:
                partitions.append((*prefix, *((lower,) * left)))
                continue
            if remaining == left * maxi:
                partitions.append((*prefix, *((maxi,) * left)))
                continue
            if left == 1:
                partitions.append((*prefix, remaining))
                continue
            first = max(lower, remaining - (left - 1) * maxi)
            last = min(remaining // left, maxi)
            # Reverse pushes retain the former ascending recursion order.
            for value in range(last, first - 1, -1):
                work.append((remaining - value, left - 1, value, depth + 1))
        return tuple(partitions)

    @staticmethod
    def partition2(
        n: int,
        count: int,
        mini: int = 1,
        maxi: Optional[int] = None,
    ) -> List[Deque[int]]:
        """Return detached mutable partitions using the historical API.

        Solver code uses the compact distinct-value ``_partition_masks``
        instead; this general (repetition-allowing) API and its
        ``_partition_tuples`` cache serve external callers only. They retain
        the established ``list[deque]`` result and cannot mutate the cache.
        """
        return [
            collections.deque(partition)
            for partition in SumAndElementsAtMostOnce._partition_tuples(
                n,
                count,
                mini,
                maxi,
            )
        ]

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        guarantees = () if guarantees is None else guarantees
        my_known, new_candidates, new_candidate_cells = self._process_new_candidate_cells(known, candidates)

        lk = len(my_known)
        if lk == self.len_cells and sum(my_known) == self.sum:
            raise RuleAlwaysSatisfied()
        if lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.sum - sum(my_known)
            np0 = new_candidates[0]
            if k in np0 and k not in my_known:
                np0.intersection_update((k,))
                raise RuleAlwaysSatisfied()
            np0.clear()
            raise InvalidGrid()

        # Keep the partitions that contain every known value and otherwise
        # only values some unknown cell can still take; drop the known values.
        known_mask = _mask_of(my_known)
        outside = ~(known_mask | _mask_of(set.union(*new_candidates)))
        if known_mask:
            new_sum_masks = [mask ^ known_mask for mask in self._partition_masks
                             if mask & known_mask == known_mask and not mask & outside]
        else:
            new_sum_masks = [mask for mask in self._partition_masks if not mask & outside]
        if not new_sum_masks:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        new_candidate_sets = frozenset(_mask_values(_or_all(new_sum_masks)))
        for p in new_candidates:
            p &= new_candidate_sets
            if not p:
                raise InvalidGrid()

        new_gts = self._filter_new_sum_candidates(new_candidate_cells, new_candidates,
                                                  new_sum_masks, guarantees, known_mask)
        SumAndElementsAtMostOnce._update_from_guarantees(candidates, new_candidate_cells, guarantees)

        if lk:
            # a surviving partition strictly contains my_known, so the new
            # target sum(partition) - sum(my_known) is always positive
            new_target = self.sum - sum(my_known)
            return False, [
                SumAndElementsAtMostOnce(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=new_candidate_cells, mysum=new_target
                )
            ], new_gts

        return False, None, new_gts

    def _filter_new_sum_candidates(self, new_cells: Sequence[int], new_candidates: Sequence[Set[int]],
                                   new_sum_masks: Sequence[int], gts: Iterable[Guarantee],
                                   known_mask: int = 0) -> List[Guarantee]:
        # For each partition (a set of k distinct values for the k unknown
        # cells, as a bitmask) the assignable (cell, value) pairs are computed
        # via bipartite matching (Regin's alldifferent filtering) instead of
        # enumerating all k! permutations. Guarantees whose cells lie inside
        # this cage restrict their value's admissible positions (a partition
        # not containing such a value admits no assignment at all) — equivalent
        # to the old permutation filter, verified by fuzzing
        # (test_saeamo_regin_matches_bruteforce).
        nc_set = frozenset(new_cells)
        position_restrict: dict = {}
        for gt in gts:
            if nc_set >= gt.cells:
                positions = frozenset(i for i, cell in enumerate(new_cells) if cell in gt.cells)
                prev = position_restrict.get(gt.val)
                position_restrict[gt.val] = positions if prev is None else prev & positions
        required = _mask_of(position_restrict)

        candidate_masks = [_mask_of(p) for p in new_candidates]
        supported = [0] * len(new_cells)
        # Values still unsupported at some position where they are candidates.
        # A partition can only support pairs (position, value) with its own
        # values, so skipping one that holds none of these, or stopping once
        # every candidate pair is supported, leaves the result exactly as the
        # full loop computes it. Every partition that could add a pair is
        # still matched in full.
        unsupported = _or_all(candidate_masks)
        for sp in new_sum_masks:
            if not sp & unsupported:
                continue
            if sp & required != required:
                continue  # a guaranteed value is missing: no assignment of sp survives
            for pos, val in _admissible_assignments(tuple(_mask_values(sp)), new_candidates, position_restrict):
                supported[pos] |= 1 << val
            unsupported = 0
            for candidate_mask, supported_mask in zip(candidate_masks, supported):
                unsupported |= candidate_mask & ~supported_mask
            if not unsupported:
                break

        for i, p in enumerate(new_candidates):
            p &= frozenset(_mask_values(supported[i]))
            if not p:
                raise InvalidGrid()

        if len(new_sum_masks) == 1:
            # Build the one partition exactly as the frozenset implementation
            # did (a copy of partition - known values): its table layout, and
            # hence the order the guarantees below are emitted and inserted,
            # stays identical. Several partitions intersect into a fresh table
            # whose order the ascending construction reproduces.
            known_values = set(_mask_values(known_mask))
            only = frozenset(_mask_values(new_sum_masks[0] | known_mask)) - known_values
            intersect = frozenset.intersection(only)
        else:
            intersect = frozenset(_mask_values(_and_all(new_sum_masks)))

        return [Guarantee(
            val=i, cells=frozenset(c for (c, p) in zip(new_cells, new_candidates) if i in p),
            rows=self._rows, cols=self._cols
        ) for i in intersect]
