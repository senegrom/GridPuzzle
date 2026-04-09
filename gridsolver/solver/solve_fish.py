import itertools

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
    for f in range(max_fish, 1, -1):
        for urs in itertools.combinations(unique_rules, f):
            all_urs = frozenset().union(*urs)
            for i in range(1, grid.max_elem + 1):
                my_gt_temp = [gt for gt in gt_dic[i] if gt <= all_urs]
                n = len(my_gt_temp)
                if n < f:
                    continue
                if f == 2:
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
                                if cell in all_gts:
                                    continue
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

    for f in range(max_fish, 1, -1):
        for urs in itertools.combinations(unique_rules, f + 1):
            all_urs = frozenset().union(*urs)
            # Precompute pairwise intersections for this urs combination
            ur_intersections = []
            for u1, u2 in itertools.combinations(urs, 2):
                isect = u1 & u2
                if isect:
                    ur_intersections.append(isect)
            if not ur_intersections:
                continue
            for i in range(1, grid.max_elem + 1):
                my_gt_temp = [gt for gt in gt_dic[i] if gt <= all_urs]
                n = len(my_gt_temp)
                if n < f:
                    continue
                if f == 2:
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
                            for cell in isect - all_gts:
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
