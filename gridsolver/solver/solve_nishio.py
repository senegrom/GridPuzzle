from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def nishio(grid: Grid) -> None:
    """Nishio technique (single-digit forcing).

    For each unsolved cell and each of its candidates: hypothetically place that
    digit, propagate basic constraints on a clone, then check if any full-size
    house has no remaining cell for some digit. If so, the candidate is invalid.

    Only runs on grids where all ElementsAtMostOnce rules are full-size (no
    small arithmetic cages like KenKen) to avoid false contradictions from
    over-constraining propagation.
    """
    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    # Safety check: skip if the grid has arithmetic rules (SumRule, ProdRule, etc.)
    # where basic propagation can produce false contradictions
    from gridsolver.rules.sumrules import SumRule, ProdRule, DiffRule, DivRule, SumAndElementsAtMostOnce
    if any(isinstance(r, (SumRule, ProdRule, DiffRule, DivRule, SumAndElementsAtMostOnce))
           for r in grid.rules | grid.rules_ia):
        return
    houses = [grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem]
    if not houses:
        return

    from gridsolver.solver.atomic_solver import _update_known_from_candidates, _update_candidates_from_known
    from gridsolver.solver.solve_guarantees import filter_guarantees

    for cell in range(grid.len):
        if known[cell] > 0 or len(cands[cell]) <= 1:
            continue

        made_progress = False
        for val in list(cands[cell]):
            clone = grid.deepcopy()
            clone[cell] = val
            ck = clone._known
            cc = clone._candidates

            # Basic propagation
            changed = True
            while changed and clone.is_valid:
                changed = False
                old_known = list(ck)
                _update_known_from_candidates(clone.__setitem__, cc, ck)
                try:
                    for rule in list(clone.rules):
                        try:
                            do_refresh, new_rules, new_gts = rule.apply(ck, cc, clone.guarantees)
                            if do_refresh:
                                _update_candidates_from_known(cc, ck)
                        except RuleAlwaysSatisfied:
                            new_rules = []
                            new_gts = None
                            _update_candidates_from_known(cc, ck)
                        if new_rules is not None:
                            clone.deactivate_rule(rule)
                            for r in new_rules:
                                clone.add_rule_checked(r)
                        if new_gts is not None:
                            for gt in new_gts:
                                clone.add_gtee_checked(gt)
                    filter_guarantees(clone)
                except InvalidGrid:
                    pass
                if list(ck) != old_known:
                    changed = True

            # Check for contradictions: empty candidate sets or missing digits in houses
            contradiction = not clone.is_valid
            if not contradiction:
                for house in houses:
                    for d in range(1, grid.max_elem + 1):
                        if any(ck[c2] == d for c2 in house):
                            continue
                        if not any(d in cc[c2] for c2 in house if ck[c2] == 0):
                            contradiction = True
                            break
                    if contradiction:
                        break

            if contradiction:
                _lg.logr("Nishio",
                         f"{val} removed (placement leads to contradiction)",
                         c(cell))
                cands[cell].discard(val)
                if not cands[cell]:
                    raise InvalidGrid()
                made_progress = True

        if made_progress:
            return
