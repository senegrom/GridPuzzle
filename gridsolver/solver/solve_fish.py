import itertools
from numbers import Integral
from typing import FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.trail import TrailedDict
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# todo endo fins


def _fish_size(max_fish: object) -> int:
    if isinstance(max_fish, bool) or not isinstance(max_fish, Integral):
        raise TypeError("max_fish must be an integer")
    max_fish = int(max_fish)
    if max_fish < 2:
        raise ValueError("max_fish must be at least 2")
    return max_fish


def _relevant_urs_by_val(grid: Grid, unique_rules, gt_dic) -> dict:
    """For each value, the unique rules containing at least one of its guarantees.
    Shared by fish/finned_fish and cached on the grid (cleared on rule/guarantee changes)."""

    def build():
        result: dict[int, list[FrozenSet[int]]] = {}
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if not gts_for_val:
                continue
            seen = set()
            rel_list = []
            for ur in unique_rules:
                # dedup by value: distinct rules over identical cells (e.g. a
                # full-house cage) would otherwise produce degenerate combos
                if ur not in seen and any(gt <= ur for gt in gts_for_val):
                    seen.add(ur)
                    rel_list.append(ur)
            if rel_list:
                result[i] = rel_list
        return result

    return grid.cached_struct("fish_relevant_urs", build)


def _value_memo(grid: Grid) -> TrailedDict:
    """Return per-value fish fingerprints tied to the grid trail.

    Parent memo entries survive speculative branches, while branch-only
    fingerprints roll back with candidates, rules, and guarantees. A
    deepcopy still starts without this optional cache and recomputes it.
    """
    memo = getattr(grid, "_fish_value_memo", None)
    if (
        not isinstance(memo, TrailedDict)
        or memo._trail_state is not grid._trail_state
    ):
        memo = TrailedDict(() if memo is None else memo, grid._trail_state)
        grid._fish_value_memo = memo
    return memo

def _fish_context(grid: Grid, max_fish):
    """Shared fish/finned prologue; ``None`` when no unique rules exist."""
    max_fish = _fish_size(max_fish)
    unique_rules = grid.unique_rule_cells
    if not unique_rules:
        return None
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_dic = grid.guarantee_cells_by_value
    return (
        max_fish,
        CoordToString(grid.rows),
        gt_dic,
        grid._candidates,
        _relevant_urs_by_val(grid, unique_rules, gt_dic),
        _value_memo(grid),
    )


def _disjoint_union(gts):
    """Union of pairwise-disjoint guarantee sets, or ``None`` on overlap."""
    seen: set = set()
    for gt in gts:
        if seen & gt:
            return None
        seen |= gt
    return frozenset(seen)


def _eliminate_outside(cands, cell_groups, all_gts, value, label, c) -> None:
    """Remove ``value`` from cells covered by ``cell_groups`` outside the fish set."""
    for group in cell_groups:
        for cell in group:
            if cell not in all_gts:
                cd = cands[cell]
                if value in cd:
                    _lg.on and _lg.logr(label,
                             f"{value} removed from {cd} w/ fish-set {c(all_gts)}",
                             c(cell))
                    cd.remove(value)
                    if not cd:
                        raise InvalidGrid()


def _eliminate_cannibals(cands, urs, all_gts, threshold, value, label, c) -> None:
    """Remove ``value`` from fish-set cells covered by ``threshold`` base sets."""
    for cell in all_gts:
        counter = 0
        for ur in urs:
            if cell in ur:
                counter += 1
            if counter == threshold:
                cd = cands[cell]
                if value in cd:
                    _lg.on and _lg.logr(label,
                             f"{value} removed from {cd} w/ fish-set {c(all_gts)}",
                             c(cell))
                    cd.remove(value)
                    if not cd:
                        raise InvalidGrid()
                break


# noinspection PyProtectedMember
def fish(grid: Grid, max_fish=2) -> None:
    context = _fish_context(grid, max_fish)
    if context is None:
        return
    max_fish, c, gt_dic, cands, relevant_urs_by_val, memo = context

    for f in range(max_fish, 1, -1):
        fish_label = f"Fish@{f}"
        cannibal_label = f"FishCannibal@{f}"
        # Value-first: for each value, find relevant unique rule combinations
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue

            relevant_ur_list = relevant_urs_by_val.get(i, [])
            if len(relevant_ur_list) < f:
                continue

            memo_key = (False, f, i)
            fingerprint = (frozenset(gts_for_val), frozenset(relevant_ur_list))
            if memo.get(memo_key) == fingerprint:
                continue

            if f == 2:
                n_ur = len(relevant_ur_list)
                for ua in range(n_ur):
                    ur_a = relevant_ur_list[ua]
                    for ub in range(ua + 1, n_ur):
                        ur_b = relevant_ur_list[ub]
                        all_urs = ur_a | ur_b
                        my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                        n = len(my_gt_temp)
                        if n < 2:
                            continue
                        urs = (ur_a, ur_b)
                        for a in range(n):
                            gt_a = my_gt_temp[a]
                            for b in range(a + 1, n):
                                gt_b = my_gt_temp[b]
                                if not gt_a.isdisjoint(gt_b):
                                    continue
                                all_gts = gt_a | gt_b
                                _eliminate_outside(cands, urs, all_gts, i, fish_label, c)
                                _eliminate_cannibals(cands, urs, all_gts, 2, i, cannibal_label, c)
            else:
                for urs in itertools.combinations(relevant_ur_list, f):
                    all_urs = frozenset().union(*urs)
                    my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                    if len(my_gt_temp) < f:
                        continue
                    for gts in itertools.combinations(my_gt_temp, f):
                        all_gts = _disjoint_union(gts)
                        if all_gts is None:
                            continue
                        _eliminate_outside(cands, urs, all_gts, i, fish_label, c)
                        _eliminate_cannibals(cands, urs, all_gts, 2, i, cannibal_label, c)
            memo[memo_key] = fingerprint


def finned_fish(grid: Grid, max_fish=2) -> None:
    context = _fish_context(grid, max_fish)
    if context is None:
        return
    max_fish, c, gt_dic, cands, relevant_urs_by_val, memo = context

    for f in range(max_fish, 1, -1):
        finned_label = f"FishFinned@{f}"
        cannibal_label = f"FishFinnedCannibal@{f}"
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue

            relevant_ur_list = relevant_urs_by_val.get(i, [])

            if len(relevant_ur_list) < f + 1:
                continue

            memo_key = (True, f, i)
            fingerprint = (frozenset(gts_for_val), frozenset(relevant_ur_list))
            if memo.get(memo_key) == fingerprint:
                continue

            if f == 2:
                n_ur = len(relevant_ur_list)
                for ua in range(n_ur):
                    ur_a = relevant_ur_list[ua]
                    for ub in range(ua + 1, n_ur):
                        ur_b = relevant_ur_list[ub]
                        for uc in range(ub + 1, n_ur):
                            ur_c = relevant_ur_list[uc]
                            urs = (ur_a, ur_b, ur_c)
                            all_urs = ur_a | ur_b | ur_c
                            # Precompute pairwise intersections
                            ur_intersections = []
                            for u1, u2 in itertools.combinations(urs, 2):
                                isect = u1 & u2
                                if isect:
                                    ur_intersections.append(isect)
                            if not ur_intersections:
                                continue
                            my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                            n = len(my_gt_temp)
                            if n < 2:
                                continue
                            for a in range(n):
                                gt_a = my_gt_temp[a]
                                for b in range(a + 1, n):
                                    gt_b = my_gt_temp[b]
                                    if not gt_a.isdisjoint(gt_b):
                                        continue
                                    all_gts = gt_a | gt_b
                                    _eliminate_outside(cands, ur_intersections, all_gts, i, finned_label, c)
                                    _eliminate_cannibals(cands, urs, all_gts, 3, i, cannibal_label, c)
            else:
                for urs in itertools.combinations(relevant_ur_list, f + 1):
                    all_urs = frozenset().union(*urs)
                    ur_intersections = []
                    for u1, u2 in itertools.combinations(urs, 2):
                        isect = u1 & u2
                        if isect:
                            ur_intersections.append(isect)
                    if not ur_intersections:
                        continue
                    my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                    if len(my_gt_temp) < f:
                        continue
                    for gts in itertools.combinations(my_gt_temp, f):
                        all_gts = _disjoint_union(gts)
                        if all_gts is None:
                            continue
                        _eliminate_outside(cands, ur_intersections, all_gts, i, finned_label, c)
                        _eliminate_cannibals(cands, urs, all_gts, 3, i, cannibal_label, c)
            memo[memo_key] = fingerprint
