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
    for f in range(max_fish, 1, -1):
        for urs in itertools.combinations(unique_rules, f):
            all_urs = frozenset().union(*(ur for ur in urs))
            for i in range(1, grid.max_elem + 1):
                my_gt_temp = [gt for gt in gt_dic[i] if gt <= all_urs]
                for gts in itertools.combinations(my_gt_temp, f):
                    if any(gt1 & gt2 for gt1, gt2 in itertools.combinations(gts, 2)):  # todo speedup
                        continue
                    all_gts = frozenset().union(*(gt for gt in gts))
                    for ur in urs:
                        for cell in ur:
                            if cell not in all_gts:
                                cd = grid.get_candidates(cell)
                                if i in cd:
                                    _lg.logr(f"Fish@{f}",
                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}", c(cell))
                                    cd.remove(i)
                    for cell in all_gts:
                        counter = 0
                        for ur in urs:
                            if cell in ur:
                                counter += 1
                            if counter == 2:
                                cd = grid.get_candidates(cell)
                                if i in cd:
                                    _lg.logr(f"FishCannibal@{f}",
                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}", c(cell))
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

    for f in range(max_fish, 1, -1):
        for urs in itertools.combinations(unique_rules, f + 1):
            all_urs = frozenset().union(*(ur for ur in urs))
            for i in range(1, grid.max_elem + 1):
                my_gt_temp = [gt for gt in gt_dic[i] if gt <= all_urs]
                for gts in itertools.combinations(my_gt_temp, f):
                    if any(gt1 & gt2 for gt1, gt2 in itertools.combinations(gts, 2)):  # todo speedup
                        continue
                    all_gts = frozenset().union(*(gt for gt in gts))
                    for ur1, ur2 in itertools.combinations(urs, 2):
                        for cell in ur1 & ur2:
                            if cell not in all_gts:
                                cd = grid.get_candidates(cell)
                                if i in cd:
                                    _lg.logr(f"FishFinned@{f}",
                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}", c(cell))
                                    cd.remove(i)
                    for cell in all_gts:
                        counter = 0
                        for ur in urs:
                            if cell in ur:
                                counter += 1
                            if counter == 3:
                                cd = grid.get_candidates(cell)
                                if i in cd:
                                    _lg.logr(f"FishFinnedCannibal@{f}",
                                             f"{i} removed from {cd} w/ fish-set {c(all_gts)}", c(cell))
                                    cd.remove(i)
                                break
