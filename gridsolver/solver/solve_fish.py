import itertools
from typing import List, Dict, Set

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def apply_fish(grid: Grid, max_fish=2) -> None:
    assert max_fish >= 2
    unique_rules = [frozenset(rule.cells) for rule in grid.rules if isinstance(rule, ElementsAtMostOnce)]
    if not unique_rules:
        return
    max_fish = min(max_fish, max(len(ur) for ur in unique_rules) - 1)
    gt_temp = [gt for gt in grid.guarantees]  # if len(gt.cells) <= max_fish]
    for f in range(max_fish, 1, -1):
        gt_temp = [gt for gt in gt_temp if len(gt.cells) <= f]
        gt_dic: Dict[int, List[Set[int]]] = {i: [gt.cells for gt in gt_temp if gt.val == i] for i in
                                             range(grid.max_elem)}
        for urs in itertools.combinations(unique_rules, f):
            all_urs = frozenset().union(*(ur for ur in urs))
            for i in range(grid.max_elem):
                my_gt_temp = [gt for gt in gt_dic[i] if gt <= all_urs]
                for gts in itertools.combinations(my_gt_temp, f):
                    if any(gt1 & gt2 for gt1, gt2 in itertools.combinations(gts, 2)):
                        continue
                    all_gts = frozenset().union(*(gt for gt in gts))
                    for ur in urs:
                        for cell in ur:
                            if cell not in all_gts and i in grid._candidates[cell]:
                                _lg.logr(f"Fish@{f}", f"{i} removed from {grid._candidates[cell]}", cell)
                                grid._candidates[cell].remove(i)

# def _apply_fish_inner(f: int, unique_rules: List[Set[int]], gt_temp: List[Guarantee]):
#     gt_temps = [gt_temp] + [None] * f
#     ur_idx = list(range(f))
#     while ur_idx[0] <= len(unique_rules) - f:
#         for k in range(f):
