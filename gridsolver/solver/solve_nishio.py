from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.solve_forcing_net import _propagate_basic
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
    if _solve_fc._in_forcing_chain:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    for cell in range(grid.len):
        if known[cell] > 0 or len(cands[cell]) <= 1:
            continue

        made_progress = False
        for val in list(cands[cell]):
            clone = grid.deepcopy()
            clone[cell] = val
            cc = clone._candidates
            _propagate_basic(clone)

            if not clone.is_valid:
                # Find what went wrong for the log message
                empty = [i for i in range(grid.len) if not cc[i]]
                reason = f"empty candidates at {c(empty[0])}" if empty else "invalid grid"
                _lg.on and _lg.logr("Nishio",
                         f"{val} removed ({reason})",
                         c(cell))
                cands[cell].discard(val)
                if not cands[cell]:
                    raise InvalidGrid()
                made_progress = True

        if made_progress:
            return
