from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.propagation import propagate_basic
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def nishio(grid: Grid) -> None:
    """Eliminate candidates whose basic-propagation branch contradicts."""
    if _solve_fc._in_forcing_chain:
        return

    candidates = grid._candidates
    known = grid._known
    coord = CoordToString(grid.rows)

    for cell in range(grid.len):
        if known[cell] > 0 or len(candidates[cell]) <= 1:
            continue

        made_progress = False
        for value in sorted(candidates[cell]):
            clone = grid.deepcopy()
            try:
                clone[cell] = value
                status = propagate_basic(clone)
            except InvalidGrid:
                status = SolveStatus.INVALID

            if status is not SolveStatus.INVALID and clone.is_valid:
                continue

            empty_cells = [index for index, possible in enumerate(clone._candidates) if not possible]
            reason = f"empty candidates at {coord(empty_cells[0])}" if empty_cells else "invalid grid"
            _lg.on and _lg.logr(
                "Nishio",
                f"{value} removed ({reason})",
                coord(cell),
            )
            candidates[cell].discard(value)
            if not candidates[cell]:
                raise InvalidGrid()
            made_progress = True

        if made_progress:
            return
