import collections
import itertools
import reprlib
from functools import cached_property
from typing import Tuple, Set, Sequence, List, Iterable, Deque, MutableSequence, Iterator, Optional, FrozenSet

from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.rules.rules import Rule, Guarantee, RuleAlwaysSatisfied, InvalidGrid, IdxType, _format_coord
from gridsolver.rules.unique import ElementsAtMostOnce


class SumRule(Rule):
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'sum')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], mysum: int):
        if gsz is not None and cells is not None:
            cells = sorted(list(cells))
            super().__init__(gsz, cells, None)
        self.sum: int = mysum

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
        elif lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.sum - current_sum
            last_cell = next(cell for cell in self.cells if known[cell] == 0)
            if k in candidates[last_cell]:
                candidates[last_cell].clear()
                candidates[last_cell].add(k)
                raise RuleAlwaysSatisfied()
            else:
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
            new_target = self.sum - current_sum
            if new_target < 0:
                self.invalidate_current_cells_and_raise_invalid_grid(candidates)
            return False, [
                SumRule(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=[cell for cell in self.cells if known[cell] == 0], mysum=new_target
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
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'diff')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if gsz is not None and cells is not None:
            cells = list(cells)
            assert len(cells) == 2
            super().__init__(gsz, cells, None)
        self.diff: int = target

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        first = known[self.cells[0]]
        second = known[self.cells[1]]
        if first > 0 and second > 0 and (first - second == self.diff or second - first == self.diff):
            raise RuleAlwaysSatisfied()
        elif first > 0 and second > 0:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif first > 0:
            new_cand = {first - self.diff, first + self.diff}
            candidates[self.cells[1]].intersection_update(new_cand)
            if len(candidates[self.cells[1]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[1]]) == 0:
                raise InvalidGrid()
        elif second > 0:
            new_cand = {second - self.diff, second + self.diff}
            candidates[self.cells[0]].intersection_update(new_cand)
            if len(candidates[self.cells[0]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[0]]) == 0:
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
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'prod')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if gsz is not None and cells is not None:
            cells = sorted(list(cells))
            super().__init__(gsz, cells, None)
        self.prod: int = target

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
        elif lk == self.len_cells:
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
                candidates[last_cell].clear()
                candidates[last_cell].add(k)
                raise RuleAlwaysSatisfied()
            else:
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
    __slots__ = ('cells', '_rows', '_cols', '_max_elem', 'len_cells', 'div')

    def __init__(self, gsz: Optional[GridSizeContainer], cells: Optional[Iterable[IdxType]], target: int):
        if gsz is not None and cells is not None:
            cells = list(cells)
            assert len(cells) == 2
            super().__init__(gsz, cells, None)
        self.div: int = target

    def __hash__(self):
        return hash((super().__hash__(), self.div))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: DivRule
        return self.div == other.div

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None) -> \
            Tuple[bool, Optional[Iterable[Rule]], Optional[Iterable[Guarantee]]]:

        first = known[self.cells[0]]
        second = known[self.cells[1]]
        if first > 0 and second > 0 and (first / second == self.div or second / first == self.div):
            raise RuleAlwaysSatisfied()
        elif first > 0 and second > 0:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif first > 0:
            new_cand = {first * self.div}
            if int(first / self.div) == first / self.div:
                new_cand.add(int(first / self.div))
            candidates[self.cells[1]].intersection_update(new_cand)
            if len(candidates[self.cells[1]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[1]]) == 0:
                raise InvalidGrid()
        elif second > 0:
            new_cand = {second * self.div}
            if int(second / self.div) == second / self.div:
                new_cand.add(int(second / self.div))
            candidates[self.cells[0]].intersection_update(new_cand)
            if len(candidates[self.cells[0]]) == 1:
                raise RuleAlwaysSatisfied()
            elif len(candidates[self.cells[0]]) == 0:
                raise InvalidGrid()

        for cell in self.cells:
            for c in list(candidates[cell]):
                t1 = c * self.div
                t2 = c / self.div
                t2 = int(t2) if int(t2) == t2 else -1
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

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.div}: {cell_str}]"


# todo combine to sum rules for large areas
# todo subtract from guarantees to make new subrules


def _admissible_assignments(values: FrozenSet[int], cand_sets: Sequence[Set[int]],
                            restrict: dict) -> Iterator[Tuple[int, int]]:
    """All (position, value) pairs occurring in at least one bijection of
    `values` onto the positions, where position i admits value v iff
    v in cand_sets[i] and (v unrestricted or i in restrict[v]).

    Regin (1994): a maximum bipartite matching decides feasibility; a non-matched
    edge participates in some perfect matching iff its endpoints share a strongly
    connected component of the residual digraph (unmatched value->position,
    matched position->value). Polynomial in the cage size, replacing k!
    permutation enumeration."""
    k = len(cand_sets)
    vals = list(values)
    if len(vals) != k:
        return
    edges = {}
    for v in vals:
        allowed = restrict.get(v)
        edges[v] = [i for i in range(k)
                    if v in cand_sets[i] and (allowed is None or i in allowed)]

    match_pos: dict = {}  # position -> value
    match_val: dict = {}  # value -> position

    def try_augment(v, visited) -> bool:
        for i in edges[v]:
            if i in visited:
                continue
            visited.add(i)
            if i not in match_pos or try_augment(match_pos[i], visited):
                match_pos[i] = v
                match_val[v] = i
                return True
        return False

    for v in vals:
        if not try_augment(v, set()):
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
                elif on_stack[nb]:
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


class SumAndElementsAtMostOnce(ElementsAtMostOnce, SumRule):
    def __init__(self, gsz: GridSizeContainer, cells: Iterable[IdxType], mysum: int):
        ElementsAtMostOnce.__init__(self, gsz, cells, None)
        SumRule.__init__(self, None, None, mysum)

    @cached_property
    def sum_candidates(self) -> Tuple[FrozenSet[int]]:
        len_cell = self.len_cells
        return tuple(
            frozenset(p) for p in SumAndElementsAtMostOnce.partition2(self.sum, len_cell, 1, self._max_elem)
            if len(set(p)) == len_cell
        )

    @cached_property
    def candidates(self) -> FrozenSet[int]:
        return frozenset(x for y in self.sum_candidates for x in y)

    def __hash__(self):
        return hash((super().__hash__(), self.sum))

    def __eq__(self, other: Rule):
        if not super().__eq__(other):
            return False
        other: SumAndElementsAtMostOnce
        return self.sum == other.sum

    def __repr__(self):
        cell_str = ', '.join(_format_coord(cell, self._rows) for cell in self.cells)
        return f"{type(self).__name__}[{self.sum}: {cell_str}; {reprlib.repr([set(p) for p in self.sum_candidates])}]"

    _partition_dic = {}

    @staticmethod
    def partition(n: int, count: int, mini: int, maxi: int) -> Iterator[Deque[int]]:
        if maxi < mini or count <= 0:
            return

        if maxi >= n and count == 1:
            yield collections.deque(iterable=(n,))
            return
        elif count == 1:
            return

        mymax = min(n // count, maxi) + 1
        if count == 2:
            for i in range(mini, mymax):
                for p in SumAndElementsAtMostOnce.partition(n - i, count - 1, i, maxi):
                    p.appendleft(i)
                    yield p
        else:
            for i in range(mini, mymax):
                for p in SumAndElementsAtMostOnce.partition2(n - i, count - 1, i, maxi):
                    p = p.copy()
                    p.appendleft(i)
                    yield p

    @staticmethod
    def partition2(n: int, count: int, mini: int = 1, maxi: Optional[int] = None) -> List[Deque[int]]:
        if maxi is None:
            maxi = n

        if maxi < mini or count <= 0:
            return []

        if maxi >= n and count == 1:
            return [collections.deque((n,))]
        elif count == 1:
            return []

        key = (n, count, mini, maxi)
        result = SumAndElementsAtMostOnce._partition_dic.get(key)
        if result is not None:
            return result
        result = list(SumAndElementsAtMostOnce.partition(n, count, mini, maxi))
        if len(SumAndElementsAtMostOnce._partition_dic) >= 65536:
            SumAndElementsAtMostOnce._partition_dic.clear()  # crude bound for long processes
        SumAndElementsAtMostOnce._partition_dic[key] = result
        return result

    def apply(self, known: MutableSequence[int], candidates: Tuple[Set[int]], guarantees: Set[Guarantee] = None):
        my_known, new_candidates, new_candidate_cells = self._process_new_candidate_cells(known, candidates)

        lk = len(my_known)
        if lk == self.len_cells and sum(my_known) == self.sum:
            raise RuleAlwaysSatisfied()
        elif lk == self.len_cells:
            self.invalidate_current_cells_and_raise_invalid_grid(candidates)
        elif lk == self.len_cells - 1:
            k = self.sum - sum(my_known)
            np0 = new_candidates[0]
            if k in np0 and k not in my_known:
                np0.clear()
                np0.add(k)
                raise RuleAlwaysSatisfied()
            else:
                np0.clear()
                raise InvalidGrid()

        candidates_union = set.union(*new_candidates)
        new_sum_candidates = (sp - my_known for sp in self.sum_candidates if my_known <= sp)
        new_sum_candidates = [sp for sp in new_sum_candidates if sp <= candidates_union]
        new_candidate_sets = frozenset().union(*new_sum_candidates)
        for p in new_candidates:
            p &= new_candidate_sets
            if not p:
                raise InvalidGrid()

        new_gts = self._filter_new_sum_candidates(new_candidate_cells, new_candidates,
                                                  new_sum_candidates, guarantees)
        SumAndElementsAtMostOnce._update_from_guarantees(candidates, new_candidate_cells, guarantees)

        if lk:
            new_target = self.sum - sum(my_known)
            if new_target < 0:
                self.invalidate_current_cells_and_raise_invalid_grid(candidates)
            return False, [
                SumAndElementsAtMostOnce(
                    gsz=GridSizeContainer(self._rows, self._cols, self._max_elem),
                    cells=new_candidate_cells, mysum=new_target
                )
            ], new_gts

        return False, None, new_gts

    def _filter_new_sum_candidates(self, new_cells: Sequence[int], new_candidates: Sequence[Set[int]],
                                   new_sum_candidates: Iterable[FrozenSet[int]], gts: Iterable[Guarantee]) \
            -> List[Guarantee]:
        # For each partition (a set of k distinct values for the k unknown
        # cells) the assignable (cell, value) pairs are computed via bipartite
        # matching (Regin's alldifferent filtering) instead of enumerating all
        # k! permutations. Guarantees whose cells lie inside this cage restrict
        # their value's admissible positions (a partition not containing such a
        # value admits no assignment at all) — equivalent to the old
        # permutation filter, verified by fuzzing (test_saeamo_regin_matches_bruteforce).
        nc_set = frozenset(new_cells)
        position_restrict: dict = {}
        for gt in gts:
            if nc_set >= gt.cells:
                positions = frozenset(i for i, cell in enumerate(new_cells) if cell in gt.cells)
                prev = position_restrict.get(gt.val)
                position_restrict[gt.val] = positions if prev is None else prev & positions

        allowed_by_pos: List[Set[int]] = [set() for _ in new_cells]
        for sp in new_sum_candidates:
            if any(v not in sp for v in position_restrict):
                continue  # a guaranteed value is missing: no assignment of sp survives
            for pos, val in _admissible_assignments(sp, new_candidates, position_restrict):
                allowed_by_pos[pos].add(val)

        for i, p in enumerate(new_candidates):
            p &= allowed_by_pos[i]
            if not p:
                raise InvalidGrid()

        intersect = frozenset.intersection(*new_sum_candidates)

        return [Guarantee(
            val=i, cells=frozenset(c for (c, p) in zip(new_cells, new_candidates) if i in p),
            rows=self._rows, cols=self._cols
        ) for i in intersect]
