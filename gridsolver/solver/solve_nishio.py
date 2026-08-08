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
            mark = grid.trail_mark()
            branch_valid = False
            reason = "invalid grid"
            try:
                grid[cell] = value
                status = propagate_basic(grid)
                branch_valid = status is not SolveStatus.INVALID and grid.is_valid
                if not branch_valid:
                    empty_cells = [
                        index
                        for index, possible in enumerate(grid._candidates)
                        if not possible
                    ]
                    if empty_cells:
                        reason = f"empty candidates at {coord(empty_cells[0])}"
            except InvalidGrid:
                branch_valid = False
            finally:
                grid.trail_undo(mark)

            if branch_valid:
                continue

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
