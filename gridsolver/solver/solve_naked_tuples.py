import collections
import itertools
from typing import Set, Sequence, FrozenSet, Counter

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def remove_naked_tuples(grid: Grid, max_comb=1000):
    unique_rule_cells = grid.unique_rule_cells
    known = grid._known
    cands = grid._candidates
    c = CoordToString(grid.rows)

    for cells in unique_rule_cells:
        unknown_cells = [cands[cell] for cell in cells if known[cell] == 0]
        _multi_occur_check(len(unknown_cells), unknown_cells, max_comb, cells, c)


def _multi_occur_check(len_unknown: int, candidates: Sequence[Set[int]], max_comb: int,
                       cells: FrozenSet[int], c: CoordToString) -> None:
    candidates_intg = [p for p in candidates if 1 < len(p) < len_unknown]
    candidates_ct: Counter[FrozenSet[int]] = collections.Counter()
    for p in candidates_intg:
        candidates_ct.update({frozenset(p): 1})
    pct_items = candidates_ct.items()

    for key, count in pct_items:
        _do_filter(key, count, candidates, 1, cells, c)

    for comb_ct in range(2, min(len_unknown, max_comb)):
        for combs in itertools.combinations(pct_items, comb_ct):
            count = 0
            key = set()
            for keyx, countx in combs:
                count += countx
                key |= keyx
                if countx > len(keyx):
                    raise RuntimeError("This should be unreachable.")
            if count >= len_unknown:
                continue
            _do_filter(key, count, candidates, comb_ct, cells, c)


def _do_filter(key_, count_, candidates, comb_ct: int, cells: FrozenSet[int], c: CoordToString):
    if count_ == (len_key := len(key_)):
        for p in candidates:
            if not p <= key_ and (p & key_):
                _lg.logr(f"NakedTuple@{comb_ct}",
                         f"{count_} times - removed {set(key_)} from {set(p)}",
                         c(cells))
                p -= key_
            if not p:
                raise InvalidGrid()
    elif count_ > len_key:
        for p in candidates:
            if p <= key_:
                _lg.logr(f"TooManyNakedTuple@{comb_ct}",
                         f"{key_} occuring too often - {count_} times - invalid",
                         c(cells))
                p.clear()
                raise InvalidGrid()
