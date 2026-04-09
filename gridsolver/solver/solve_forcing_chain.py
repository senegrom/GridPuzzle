from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

_in_forcing_chain = False


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique.

    For each bivalue cell, test both candidates by running the full atomic solver
    (minus forcing_chain itself, prevented by the _in_forcing_chain flag):

    Case 3: If one branch is INVALID, the other must be true.
    Both INVALID: Grid is truly invalid — raise InvalidGrid.
    Case 1: If both branches assign the same value to a cell, force it.
    Case 2: If both branches eliminate the same candidate, remove it.
    """
    global _in_forcing_chain
    if _in_forcing_chain:
        return

    from gridsolver.solver.atomic_solver import AtomicSolver

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
                clone = grid.deep_deepcopy()
                clone[cell] = val
                status = AtomicSolver(clone, [], set()).solve_atomic()
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
                # Both branches return INVALID from the atomic solver. This does NOT
                # necessarily mean the grid is invalid — the atomic solver uses
                # power actions (fish, chains, etc.) that can detect contradictions
                # the basic solver wouldn't find. The backtracking solver might resolve
                # this by choosing a DIFFERENT cell to assign first, which changes
                # the state enough to make this cell's branches viable.
                continue

            # Cases 1 & 2: only if both branches are non-INVALID
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
