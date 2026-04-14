from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def nishio(grid: Grid) -> None:
    """Nishio technique (single-digit forcing).

    For each unsolved cell and each candidate: hypothetically place it,
    propagate basic constraints (rules + guarantees). If the grid becomes
    invalid (some cell has no candidates — which includes guarantee violations
    like "digit D has nowhere to go in house H"), the candidate is eliminated.

    The guarantee system (ElementsAtLeastOnce → filter_guarantees) already
    checks that every digit has at least one cell in every house, so no
    separate house check is needed.
    """
    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    # Skip puzzles with arithmetic rules where propagation to fixpoint
    # can expose rule bugs not yet fixed
    from gridsolver.rules.sumrules import SumRule, ProdRule, DiffRule, DivRule, SumAndElementsAtMostOnce
    if any(isinstance(r, (SumRule, ProdRule, DiffRule, DivRule, SumAndElementsAtMostOnce))
           for r in grid.rules | grid.rules_ia):
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

            # Basic propagation (same as AtomicSolver._update_step in a loop)
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

            if not clone.is_valid:
                # Find what went wrong for the log message
                empty = [i for i in range(grid.len) if not cc[i]]
                reason = f"empty candidates at {c(empty[0])}" if empty else "invalid grid"
                _lg.logr("Nishio",
                         f"{val} removed ({reason})",
                         c(cell))
                cands[cell].discard(val)
                if not cands[cell]:
                    raise InvalidGrid()
                made_progress = True

        if made_progress:
            return
