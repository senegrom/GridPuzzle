import itertools
from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# todo endo fins


# noinspection PyProtectedMember
def fish(grid: Grid, max_fish=2) -> None:
    assert max_fish >= 2
    c = CoordToString(grid.rows)
    unique_rules = grid.unique_rule_cells
    if not unique_rules:
        return
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_dic = grid.guarantee_cells_by_value
    cands = grid._candidates

    # Precompute: for each guarantee, which unique rules contain it
    gt_to_urs: dict[FrozenSet[int], List[FrozenSet[int]]] = {}
    for i in range(1, grid.max_elem + 1):
        for gt in gt_dic[i]:
            containing = [ur for ur in unique_rules if gt <= ur]
            if containing:
                gt_to_urs[gt] = containing

    for f in range(max_fish, 1, -1):
        # Value-first: for each value, find relevant unique rule combinations
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue

            # Find unique rules that contain at least one guarantee for this value
            relevant_urs = set()
            for gt in gts_for_val:
                if gt in gt_to_urs:
                    for ur in gt_to_urs[gt]:
                        relevant_urs.add(id(ur))

            # Map id -> frozenset for relevant rules only
            id_to_ur = {id(ur): ur for ur in unique_rules if id(ur) in relevant_urs}
            relevant_ur_list = list(id_to_ur.values())

            if len(relevant_ur_list) < f:
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
                                for ur in urs:
                                    for cell in ur:
                                        if cell not in all_gts:
                                            cd = cands[cell]
                                            if i in cd:
                                                _lg.logr(f"Fish@{f}",
                                                         f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                         c(cell))
                                                cd.remove(i)
                                for cell in all_gts:
                                    counter = 0
                                    for ur in urs:
                                        if cell in ur:
                                            counter += 1
                                        if counter == 2:
                                            cd = cands[cell]
                                            if i in cd:
                                                _lg.logr(f"FishCannibal@{f}",
                                                         f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                         c(cell))
                                                cd.remove(i)
                                            break
            else:
                for urs in itertools.combinations(relevant_ur_list, f):
                    all_urs = frozenset().union(*urs)
                    my_gt_temp = [gt for gt in gts_for_val if gt <= all_urs]
                    if len(my_gt_temp) < f:
                        continue
                    for gts in itertools.combinations(my_gt_temp, f):
                        seen = set()
                        disjoint = True
                        for gt in gts:
                            if seen & gt:
                                disjoint = False
                                break
                            seen |= gt
                        if not disjoint:
                            continue
                        all_gts = frozenset(seen)
                        for ur in urs:
                            for cell in ur:
                                if cell not in all_gts:
                                    cd = cands[cell]
                                    if i in cd:
                                        _lg.logr(f"Fish@{f}",
                                                 f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                 c(cell))
                                        cd.remove(i)
                        for cell in all_gts:
                            counter = 0
                            for ur in urs:
                                if cell in ur:
                                    counter += 1
                                if counter == 2:
                                    cd = cands[cell]
                                    if i in cd:
                                        _lg.logr(f"FishCannibal@{f}",
                                                 f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                 c(cell))
                                        cd.remove(i)
                                    break


def finned_fish(grid: Grid, max_fish=2) -> None:
    assert max_fish >= 2
    c = CoordToString(grid.rows)
    unique_rules = grid.unique_rule_cells
    if not unique_rules:
        return
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_dic = grid.guarantee_cells_by_value
    cands = grid._candidates

    # Precompute: for each guarantee, which unique rules contain it
    gt_to_urs: dict[FrozenSet[int], List[FrozenSet[int]]] = {}
    for i in range(1, grid.max_elem + 1):
        for gt in gt_dic[i]:
            containing = [ur for ur in unique_rules if gt <= ur]
            if containing:
                gt_to_urs[gt] = containing

    for f in range(max_fish, 1, -1):
        for i in range(1, grid.max_elem + 1):
            gts_for_val = gt_dic[i]
            if len(gts_for_val) < f:
                continue

            relevant_urs = set()
            for gt in gts_for_val:
                if gt in gt_to_urs:
                    for ur in gt_to_urs[gt]:
                        relevant_urs.add(id(ur))

            id_to_ur = {id(ur): ur for ur in unique_rules if id(ur) in relevant_urs}
            relevant_ur_list = list(id_to_ur.values())

            if len(relevant_ur_list) < f + 1:
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
                                    for isect in ur_intersections:
                                        for cell in isect:
                                            if cell not in all_gts:
                                                cd = cands[cell]
                                                if i in cd:
                                                    _lg.logr(f"FishFinned@{f}",
                                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                             c(cell))
                                                    cd.remove(i)
                                    for cell in all_gts:
                                        counter = 0
                                        for ur in urs:
                                            if cell in ur:
                                                counter += 1
                                            if counter == 3:
                                                cd = cands[cell]
                                                if i in cd:
                                                    _lg.logr(f"FishFinnedCannibal@{f}",
                                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                             c(cell))
                                                    cd.remove(i)
                                                break
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
                        seen = set()
                        disjoint = True
                        for gt in gts:
                            if seen & gt:
                                disjoint = False
                                break
                            seen |= gt
                        if not disjoint:
                            continue
                        all_gts = frozenset(seen)
                        for isect in ur_intersections:
                            for cell in isect:
                                if cell not in all_gts:
                                    cd = cands[cell]
                                    if i in cd:
                                        _lg.logr(f"FishFinned@{f}",
                                                 f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                 c(cell))
                                        cd.remove(i)
                        for cell in all_gts:
                            counter = 0
                            for ur in urs:
                                if cell in ur:
                                    counter += 1
                                if counter == 3:
                                    cd = cands[cell]
                                    if i in cd:
                                        _lg.logr(f"FishFinnedCannibal@{f}",
                                                 f"{i} removed from {cd} w/ fish-set {c(all_gts)}",
                                                 c(cell))
                                        cd.remove(i)
                                    break
