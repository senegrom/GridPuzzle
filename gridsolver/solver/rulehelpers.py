import itertools
from typing import List, Dict, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules import unique, uneq, sumrules


def rulehelper_atmostonce(grid: Grid) -> bool:
    unique_rule_cells = grid.unique_rule_cells

    for cells in unique_rule_cells:
        if len(cells) > 1:
            for cell in cells:
                new_rule = uneq.UneqRule(grid, cell, cells - {cell})
                grid.add_rule_checked(new_rule)

    uneq_rules = grid.get_rules_of_type(uneq.UneqRule)

    for oc in range(grid.len):
        uneq_rule_cells_oc = {(frozenset(rule.rel_cells), rule) for rule in uneq_rules if
                              rule.origin_cell == oc}
        if len(uneq_rule_cells_oc) > 1:
            uni = frozenset.union(*(cells for cells, _ in uneq_rule_cells_oc))

            for cells, rl in uneq_rule_cells_oc.copy():
                if cells < uni:
                    grid.deactivate_rule(rl)
                    uneq_rule_cells_oc.remove((cells, rl))

            if not uneq_rule_cells_oc:
                new_rule = uneq.UneqRule(grid, oc, uni)
                grid.add_rule_checked(new_rule)
    return False


def rulehelper_sum_atmostonce(grid: Grid) -> bool:
    most_one_rule_cells = [frozenset(rule.cells) for rule in grid.rules if
                           isinstance(rule, unique.ElementsAtMostOnce)
                           and not isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

    sum_once_rules = grid.get_rules_of_type(sumrules.SumAndElementsAtMostOnce)

    set_dic: Dict[sumrules.SumAndElementsAtMostOnce, FrozenSet[int]] = {}
    rule_cntn_dic: Dict[FrozenSet[int], List[sumrules.SumAndElementsAtMostOnce]] = {key: [] for key in
                                                                                    most_one_rule_cells}

    for rule_sum in sum_once_rules:
        cells = frozenset(rule_sum.cells)
        set_dic[rule_sum] = cells
        for rule_most_cells in most_one_rule_cells:
            if cells <= rule_most_cells:
                rule_cntn_dic[rule_most_cells].append(rule_sum)

    for rule_most_cells in most_one_rule_cells:
        for rule1, rule2 in itertools.combinations(rule_cntn_dic[rule_most_cells], 2):
            cells1 = set_dic[rule1]
            cells2 = set_dic[rule2]

            if cells1 & cells2:
                continue

            union_cells = cells1 | cells2
            luc = len(union_cells)
            if luc != len(rule_most_cells):
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=union_cells,
                                                             mysum=rule1.sum + rule2.sum)
                grid.add_rule_checked(new_rule)

    for rule_most_cells in most_one_rule_cells:
        lrmc = len(rule_most_cells)
        for rule in rule_cntn_dic[rule_most_cells]:
            cells = set_dic[rule]
            lc = len(cells)
            if lc != len(rule_most_cells) and grid.max_elem == lrmc:
                new_sum = int(grid.max_elem * (grid.max_elem + 1) / 2) - rule.sum
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=rule_most_cells - cells, mysum=new_sum)
                grid.add_rule_checked(new_rule)
    return False
