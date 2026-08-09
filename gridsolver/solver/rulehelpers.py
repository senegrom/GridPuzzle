import itertools
from typing import List, Dict, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.trail import TrailedDict
from gridsolver.rules import unique, uneq, sumrules
from gridsolver.rules.rules import InvalidGrid

_MAX_INNIE = 4  # emit derived sums only for leftovers up to this many cells
_MAX_HOUSE_UNION = 3  # consider unions of up to this many disjoint houses
_MAX_SAEAMO_CELLS = 8  # cap derived sum-cages: partition enumeration grows
# combinatorially with cell count (provably a no-op up to 9x9 houses, since
# derived cages there are at most 8 cells anyway; starts biting at 10x10)


_ATMOSTONCE_COMPLETE = "rulehelper_atmostonce_complete"


def rulehelper_atmostonce(grid: Grid) -> None:
    """Materialise the union of all active inequalities per origin cell.

    The result depends only on the active rule graph. Candidate, known-value,
    and guarantee churn therefore reuse a rule-cache completion marker; every
    rule addition or deactivation invalidates that cache automatically.
    """
    if grid._rule_cache.get(_ATMOSTONCE_COMPLETE) is True:
        return

    desired: list[set[int]] = [set() for _ in range(grid.len)]
    for cells in grid.unique_rule_cells:
        if len(cells) <= 1:
            continue
        for cell in cells:
            desired[cell].update(cells)
            desired[cell].discard(cell)

    existing_by_origin: dict[int, list[uneq.UneqRule]] = {}
    for rule in grid.get_rules_of_type(uneq.UneqRule):
        existing_by_origin.setdefault(rule.origin_cell, []).append(rule)

    additions: list[uneq.UneqRule] = []
    to_deactivate: list[uneq.UneqRule] = []
    for origin, required in enumerate(desired):
        existing = existing_by_origin.get(origin, [])
        merged = set(required)
        for rule in existing:
            merged.update(rule.rel_cells)
        if not merged:
            continue

        target = frozenset(merged)
        keeper = next(
            (rule for rule in existing if rule.rel_cells == target),
            None,
        )
        to_deactivate.extend(
            rule for rule in existing if rule is not keeper
        )
        if keeper is None:
            additions.append(uneq.UneqRule(grid, origin, target))

    for rule in to_deactivate:
        grid.deactivate_rule(rule)
    grid.add_rules_checked(additions)
    # Structural mutations above may have swapped/cleared the rule cache, so
    # publish completion only after the final graph is installed.
    grid._rule_cache[_ATMOSTONCE_COMPLETE] = True


def _house_sums_memo(grid: Grid) -> TrailedDict:
    """Trail-journaled memo for the house-sums pass, mirroring the fish
    per-value memo: parent entries survive speculative branches, branch-only
    entries roll back, and a deepcopy starts fresh and recomputes."""
    memo = getattr(grid, "_house_sums_memo", None)
    if (
        not isinstance(memo, TrailedDict)
        or memo._trail_state is not grid._trail_state
    ):
        memo = TrailedDict(() if memo is None else memo, grid._trail_state)
        grid._house_sums_memo = memo
    return memo


def rulehelper_house_sums(grid: Grid) -> None:
    """Rule of 45 (innies): every complete house sums to n(n+1)/2.

    For unions of up to _MAX_HOUSE_UNION pairwise-disjoint complete houses
    (single houses, row bands, column stacks, box groups, ...), pick disjoint
    sum cages contained in the union; together with the known cells they force
    the sum of the few leftover cells. Unlike the pairwise cage merging in
    rulehelper_sum_atmostonce this derives the full innie in one pass and can
    cross house boundaries (cages spanning two rows of a band).

    Re-derivation is cheap but pointless while nothing changed, so the pass
    runs once per distinct cage configuration: a fingerprint of the active sum
    rules is kept in a trail-journaled memo (like the fish per-value memo), so
    speculative branches that derive with branch-local cages roll back to the
    parent's fingerprint instead of poisoning it, and cage updates (remnant
    emission, new merged cages) re-arm the pass by changing the fingerprint.
    Pure candidate changes never affect the arithmetic.
    """
    sum_rules = [r for r in grid.rules if isinstance(r, (sumrules.SumRule, sumrules.SumAndElementsAtMostOnce))]
    if not sum_rules:
        return

    fingerprint = frozenset((frozenset(r.cells), r.sum) for r in sum_rules)
    memo = _house_sums_memo(grid)
    if memo.get("cages") == fingerprint:
        return
    memo["cages"] = fingerprint

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
            if luc != len(rule_most_cells) and luc <= _MAX_SAEAMO_CELLS:
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=union_cells,
                                                             mysum=rule1.sum + rule2.sum)
                grid.add_rule_checked(new_rule)

    for rule_most_cells in most_one_rule_cells:
        lrmc = len(rule_most_cells)
        for rule in rule_cntn_dic[rule_most_cells]:
            cells = set_dic[rule]
            lc = len(cells)
            if lc != len(rule_most_cells) and grid.max_elem == lrmc and lrmc - lc <= _MAX_SAEAMO_CELLS:
                new_sum = grid.max_elem * (grid.max_elem + 1) // 2 - rule.sum
                new_rule = sumrules.SumAndElementsAtMostOnce(gsz=grid, cells=rule_most_cells - cells, mysum=new_sum)
                grid.add_rule_checked(new_rule)
