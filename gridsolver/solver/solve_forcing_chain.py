from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

_in_forcing_chain = False


def _propagate_basic(grid):
    """Basic propagation: rules + guarantees, no power actions."""
    from gridsolver.solver.atomic_solver import _update_known_from_candidates, _update_candidates_from_known
    from gridsolver.solver.solve_guarantees import filter_guarantees
    known = grid._known
    cands = grid._candidates
    changed = True
    while changed and grid.is_valid:
        changed = False
        old_known = list(known)
        _update_known_from_candidates(grid.__setitem__, cands, known)
        try:
            for rule in list(grid.rules):
                try:
                    do_refresh, new_rules, new_gts = rule.apply(known, cands, grid.guarantees)
                    if do_refresh:
                        _update_candidates_from_known(cands, known)
                except RuleAlwaysSatisfied:
                    new_rules = []
                    new_gts = None
                    _update_candidates_from_known(cands, known)
                if new_rules is not None:
                    grid.deactivate_rule(rule)
                    for r in new_rules:
                        grid.add_rule_checked(r)
                if new_gts is not None:
                    for gt in new_gts:
                        grid.add_gtee_checked(gt)
            filter_guarantees(grid)
        except InvalidGrid:
            pass
        if list(known) != old_known:
            changed = True
    if not grid.is_valid:
        return SolveStatus.INVALID
    if grid.is_solved:
        return SolveStatus.SOLVED
    return SolveStatus.NONE


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique.

    For each bivalue cell, test both candidates via basic propagation:
    - Case 3: If one branch is INVALID, the other must be true.
    - Case 1: If both branches assign the same value to a cell, force it.
    - Case 2: If both branches eliminate the same candidate, remove it.

    When BOTH branches are INVALID, we do NOT raise InvalidGrid — we let the
    solver's backtracking handle it, since the contradiction may be resolvable
    at a higher backtracking level.
    """
    global _in_forcing_chain
    if _in_forcing_chain:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    bivalue_cells = [i for i in range(grid.len) if known[i] == 0 and len(cands[i]) == 2]
    if not bivalue_cells:
        return

    _in_forcing_chain = True
    try:
        for cell in bivalue_cells:
            vals = list(cands[cell])
            statuses = []
            clones = []
            for val in vals:
                clone = grid.deepcopy()
                clone[cell] = val
                try:
                    s = _propagate_basic(clone)
                except InvalidGrid:
                    s = SolveStatus.INVALID
                statuses.append(s)
                clones.append(clone)

            # Case 3: One branch contradicts
            if statuses[0] == SolveStatus.INVALID and statuses[1] != SolveStatus.INVALID:
                _lg.logr("ForcingChain",
                         f"contradiction when {c(cell)}={vals[0]}, so {c(cell)}={vals[1]}",
                         c(cell))
                cands[cell].intersection_update((vals[1],))
                return
            if statuses[1] == SolveStatus.INVALID and statuses[0] != SolveStatus.INVALID:
                _lg.logr("ForcingChain",
                         f"contradiction when {c(cell)}={vals[1]}, so {c(cell)}={vals[0]}",
                         c(cell))
                cands[cell].intersection_update((vals[0],))
                return
            # Both INVALID: don't raise — let backtracking handle it

            # Cases 1 & 2: only if both branches are valid
            if statuses[0] != SolveStatus.INVALID and statuses[1] != SolveStatus.INVALID:
                known_a, cands_a = clones[0]._known, clones[0]._candidates
                known_b, cands_b = clones[1]._known, clones[1]._candidates
                made_progress = False

                for i in range(grid.len):
                    if i == cell or known[i] > 0:
                        continue
                    ka, kb = known_a[i], known_b[i]
                    if ka > 0 and ka == kb:
                        _lg.logr("ForcingChain",
                                 f"both branches force {c(i)}={ka} from {c(cell)}",
                                 c(i))
                        cands[i].intersection_update((ka,))
                        made_progress = True

                for i in range(grid.len):
                    if i == cell or known[i] > 0 or len(cands[i]) <= 1:
                        continue
                    eliminated_a = cands[i] - cands_a[i]
                    if not eliminated_a:
                        continue
                    eliminated_b = cands[i] - cands_b[i]
                    common_eliminated = eliminated_a & eliminated_b
                    for v in common_eliminated:
                        if v in cands[i]:
                            _lg.logr("ForcingChain",
                                     f"{v} removed from {c(i)} (both branches eliminate)",
                                     c(i))
                            cands[i].discard(v)
                            if not cands[i]:
                                raise InvalidGrid()
                            made_progress = True

                if made_progress:
                    return
    finally:
        _in_forcing_chain = False
