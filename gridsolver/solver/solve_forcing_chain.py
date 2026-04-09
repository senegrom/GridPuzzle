from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

# Global flag to prevent recursive forcing chain calls
_in_forcing_chain = False


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique.

    Pick a cell with exactly 2 candidates. For each candidate, deepcopy the grid,
    assign the value, and run the full atomic solver (no backtracking). Then:

    Case 3 (contradiction): If one branch returns INVALID, the other must be true.
    Case 1 (common assignment): If both branches assign the same value to the same
            cell, that assignment is forced.
    Case 2 (common elimination): If both branches eliminate the same candidate from
            a cell, that candidate can be eliminated.

    All three cases are sound because the atomic solver's deductions are complete
    within its constraint propagation capabilities. The recursion guard prevents
    forcing_chain from being called inside the inner atomic solver.
    """
    global _in_forcing_chain
    if _in_forcing_chain:
        return

    from gridsolver.solver.atomic_solver import AtomicSolver

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
                status = AtomicSolver(clone, [], set()).solve_atomic()
                statuses.append(status)
                clones.append(clone)

            # Case 3: One branch contradicts → the other must be true
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

            # Both branches are valid (SOLVED or NONE). Compare their results.
            known_a, cands_a = clones[0]._known, clones[0]._candidates
            known_b, cands_b = clones[1]._known, clones[1]._candidates
            made_progress = False

            # Case 1: Both branches force the same value in the same cell
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

            # Case 2: Both branches eliminate the same candidate from a cell
            for i in range(grid.len):
                if i == cell or known[i] > 0:
                    continue
                orig = cands[i]
                if len(orig) <= 1:
                    continue
                # Find candidates present in original but absent in BOTH branches
                eliminated_a = orig - cands_a[i]
                if not eliminated_a:
                    continue
                eliminated_b = orig - cands_b[i]
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
