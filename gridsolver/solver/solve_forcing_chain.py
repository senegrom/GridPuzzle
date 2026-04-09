from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

# Global flag to prevent recursive forcing chain calls
_in_forcing_chain = False


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique (contradiction-only).

    Pick a cell with exactly 2 candidates. For each candidate, deepcopy the grid,
    assign the value, and run the full atomic solver. If one candidate leads to
    INVALID, the other must be true.

    Uses a global flag to prevent recursion — the inner atomic solver's power
    actions will skip forcing_chain.
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
            statuses = []

            for val in vals:
                clone = grid.deepcopy()
                clone[cell] = val
                status = AtomicSolver(clone, [], set()).solve_atomic()
                statuses.append(status)

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
    finally:
        _in_forcing_chain = False
