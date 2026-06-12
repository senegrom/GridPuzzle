import itertools
from typing import List, Dict, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules import unique, uneq, sumrules
from gridsolver.rules.rules import InvalidGrid

_MAX_INNIE = 4  # emit derived sums only for leftovers up to this many cells
_MAX_HOUSE_UNION = 3  # consider unions of up to this many disjoint houses


def rulehelper_atmostonce(grid: Grid) -> None:
    unique_rule_cells = grid.unique_rule_cells

    for cells in unique_rule_cells:
        if len(cells) > 1:
            for cell in cells:
                new_rule = uneq.UneqRule(grid, cell, cells - {cell})
                grid.add_rule_checked(new_rule)

    uneq_rules: List[uneq.UneqRule] = grid.get_rules_of_type(uneq.UneqRule)

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


def rulehelper_house_sums(grid: Grid) -> None:
    """Rule of 45 (innies): every complete house sums to n(n+1)/2.

    For unions of up to _MAX_HOUSE_UNION pairwise-disjoint complete houses
    (single houses, row bands, column stacks, box groups, ...), pick disjoint
    sum cages contained in the union; together with the known cells they force
    the sum of the few leftover cells. Unlike the pairwise cage merging in
    rulehelper_sum_atmostonce this derives the full innie in one pass and can
    cross house boundaries (cages spanning two rows of a band).

    Re-derivation is cheap but pointless while nothing changed, so the whole
    pass runs once per rule generation (cage updates clear the struct cache,
    which re-arms it; pure candidate changes never affect the arithmetic).
    """
    sum_rules = [r for r in grid.rules if isinstance(r, (sumrules.SumRule, sumrules.SumAndElementsAtMostOnce))]
    if not sum_rules:
        return

    done_flag = grid.cached_struct("house_sums_done", lambda: [False])
    if done_flag[0]:
        return
    done_flag[0] = True

    n = grid.max_elem
    house_total = n * (n + 1) // 2

    # complete houses: full-size at-most-once groups that also carry at-least-once
    at_least = {frozenset(r.cells) for r in itertools.chain(grid.rules, grid.rules_ia)
                if isinstance(r, unique.ElementsAtLeastOnce)}
    houses = [fs for fs in grid.unique_rule_cells if len(fs) == n and fs in at_least]
    if not houses:
        return
    houses.sort(key=sorted)

    known = grid._known
    # smallest first: original cages win over derived merged ones in the greedy pick
    cages = sorted(((frozenset(r.cells), r.sum) for r in sum_rules), key=lambda t: (len(t[0]), sorted(t[0])))
    all_caged = frozenset().union(*(c for c, _ in cages))
    cages_by_cell: Dict[int, List] = {}
    for c_cells, c_sum in cages:
        for cell in c_cells:
            cages_by_cell.setdefault(cell, []).append((c_cells, c_sum))

    def uncoverable(hs) -> int:
        # cells that no cage could ever cover — a lower bound on the leftover size
        return sum(1 for cell in hs if known[cell] == 0 and cell not in all_caged)

    eligible = [(h, uncoverable(h)) for h in houses]
    eligible = [(h, u) for h, u in eligible if u <= _MAX_INNIE]

    for k in range(1, _MAX_HOUSE_UNION + 1):
        for combo in itertools.combinations(eligible, k):
            if sum(u for _, u in combo) > _MAX_INNIE:
                continue
            hs = [h for h, _ in combo]
            if k > 1 and any(not h1.isdisjoint(h2) for h1, h2 in itertools.combinations(hs, 2)):
                continue
            target = hs[0] if k == 1 else frozenset().union(*hs)

            chosen_sum = 0
            covered: set = set()
            for c_cells, c_sum in cages:
                if not (c_cells & covered) and c_cells <= target:
                    covered |= c_cells
                    chosen_sum += c_sum
            leftover = frozenset(cell for cell in target
                                 if cell not in covered and known[cell] == 0)
            known_sum = sum(known[cell] for cell in target
                            if cell not in covered and known[cell] > 0)
            derived = k * house_total - chosen_sum - known_sum

            if not leftover:
                if derived != 0:
                    grid._candidates[next(iter(target))].clear()
                    raise InvalidGrid()
                continue
            if len(leftover) <= _MAX_INNIE:
                if any(leftover <= h for h in houses):
                    new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=leftover, mysum=derived)
                else:
                    new_rule = sumrules.SumRule(gsz=grid, cells=leftover, mysum=derived)
                grid.add_rule_checked(new_rule)

            # outies: cover the leftover with disjoint cages sticking out of the
            # target; the cells overflowing the target then have a forced sum:
            # overflow = sum(covering cages) - leftover sum - knowns they contain
            new_sum = 0
            new_cells: set = set()
            coverable_out = True
            for cell in sorted(leftover):
                if cell in new_cells:
                    continue
                for c_cells, c_sum in cages_by_cell.get(cell, ()):
                    if not (c_cells & covered) and not (c_cells & new_cells):
                        new_cells |= c_cells
                        new_sum += c_sum
                        break
                else:
                    coverable_out = False
                    break
            if coverable_out and new_cells:
                overflow = new_cells - target
                known_target_new = sum(known[cell] for cell in (new_cells & target) if known[cell] > 0)
                known_overflow = sum(known[cell] for cell in overflow if known[cell] > 0)
                overflow_unknown = frozenset(cell for cell in overflow if known[cell] == 0)
                o_sum = new_sum - derived - known_target_new - known_overflow
                if not overflow_unknown:
                    if o_sum != 0:
                        grid._candidates[next(iter(target))].clear()
                        raise InvalidGrid()
                elif len(overflow_unknown) <= _MAX_INNIE:
                    if any(overflow_unknown <= h for h in houses):
                        new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=overflow_unknown, mysum=o_sum)
                    else:
                        new_rule = sumrules.SumRule(gsz=grid, cells=overflow_unknown, mysum=o_sum)
                    grid.add_rule_checked(new_rule)


def rulehelper_sum_atmostonce(grid: Grid) -> None:
    most_one_rule_cells = [frozenset(rule.cells) for rule in grid.rules if
                           isinstance(rule, unique.ElementsAtMostOnce)
                           and not isinstance(rule, sumrules.SumAndElementsAtMostOnce)]

    sum_once_rules = grid.get_rules_of_type(sumrules.SumAndElementsAtMostOnce)
    if not sum_once_rules:
        return

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
