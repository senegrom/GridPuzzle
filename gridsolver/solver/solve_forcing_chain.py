from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

# Global flag to prevent recursive forcing chain calls
_in_forcing_chain = False


def _propagate_with_cheap_techniques(grid: Grid) -> SolveStatus:
    """Run basic propagation + all cheap techniques (everything that comes
    before forcing_chain in the power actions pipeline).

    This is essentially a mini atomic solver that skips fish, finned_fish,
    hidden_tuples, and naked_tuples (the expensive combinatorial ones).
    """
    from gridsolver.solver.atomic_solver import _update_known_from_candidates, _update_candidates_from_known
    from gridsolver.solver.solve_guarantees import filter_guarantees
    from gridsolver.solver.solve_locked_candidate import locked_candidate
    from gridsolver.solver.solve_skyscraper import skyscraper
    from gridsolver.solver.rulehelpers import rulehelper_atmostonce, rulehelper_sum_atmostonce
    from gridsolver.solver.solve_naked_tuples import remove_naked_tuples
    from gridsolver.solver.solve_wing import xy_wing, xyz_wing
    from gridsolver.solver.solve_chain import w_wing, x_chain, xy_chain
    from gridsolver.solver.solve_coloring import simple_coloring
    from gridsolver.solver.solve_aligned_pair import aligned_pair_exclusion
    from gridsolver.solver.solve_als import als_xz
    from gridsolver.solver.solve_sue_de_coq import sue_de_coq

    known = grid._known
    cands = grid._candidates

    def _update_step():
        _update_known_from_candidates(grid.__setitem__, cands, known)
        try:
            # Apply all rules
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
                    for new_rule in new_rules:
                        grid.add_rule_checked(new_rule)
                if new_gts is not None:
                    for gt in new_gts:
                        grid.add_gtee_checked(gt)
            filter_guarantees(grid)
        except InvalidGrid:
            pass

    cheap_techniques = [
        locked_candidate, skyscraper, rulehelper_atmostonce, rulehelper_sum_atmostonce,
        lambda g: remove_naked_tuples(g, 5),
        xy_wing, xyz_wing, w_wing, x_chain, xy_chain,
        simple_coloring, aligned_pair_exclusion, als_xz, sue_de_coq,
    ]

    old = None
    while grid.is_valid:
        if old is not None and old.all_but_rule_equal(grid):
            # Try cheap techniques
            made_progress = False
            for technique in cheap_techniques:
                try:
                    technique(grid)
                except InvalidGrid:
                    break
                if old is not None and not old.all_but_rule_equal(grid):
                    _update_known_from_candidates(grid.__setitem__, cands, known)
                    made_progress = True
                    break
            if not made_progress:
                break

        if old is None:
            _update_step()
        old = grid.deepcopy()
        _update_step()

    if not grid.is_valid:
        return SolveStatus.INVALID
    if grid.is_solved:
        return SolveStatus.SOLVED
    return SolveStatus.NONE


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique.

    Pick a cell with exactly 2 candidates. For each candidate, deepcopy the grid,
    assign the value, and run propagation with all cheap techniques (everything
    before fish in the pipeline). Then:

    Case 3: If one branch returns INVALID, the other must be true.
    Case 1: If both branches assign the same value to the same cell, force it.
    Case 2: If both branches eliminate the same candidate from a cell, remove it.
    """
    global _in_forcing_chain
    if _in_forcing_chain:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    bivalue_cells = []
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) == 2:
            bivalue_cells.append(cell)

    if not bivalue_cells:
        return

    _in_forcing_chain = True
    try:
        for cell in bivalue_cells:
            vals = list(cands[cell])
            clones = []
            statuses = []

            for val in vals:
                clone = grid.deepcopy()
                clone[cell] = val
                status = _propagate_with_cheap_techniques(clone)
                statuses.append(status)
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
            if statuses[0] == SolveStatus.INVALID and statuses[1] == SolveStatus.INVALID:
                cands[cell].clear()
                raise InvalidGrid()

            # Both branches valid — compare results
            known_a, cands_a = clones[0]._known, clones[0]._candidates
            known_b, cands_b = clones[1]._known, clones[1]._candidates
            made_progress = False

            # Case 1: Both branches force the same value
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

            # Case 2: Both branches eliminate the same candidate
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
