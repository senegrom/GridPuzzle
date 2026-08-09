from contextvars import ContextVar, Token

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.propagation import BranchConsensus
from gridsolver.solver.solver_log import lg as _lg


class _ContextFlag:
    """Boolean-compatible flag whose value is local to the current context."""

    def __init__(self, name: str):
        self._value: ContextVar[bool] = ContextVar(name, default=False)

    def __bool__(self) -> bool:
        return self._value.get()

    def set(self, value: bool) -> Token:
        return self._value.set(value)

    def reset(self, token: Token) -> None:
        self._value.reset(token)


_in_forcing_chain = _ContextFlag("gridpuzzle_in_forcing_chain")

MAX_FORCING_CHAIN_CANDIDATES = 4


def _propagate_with_techniques(grid: Grid) -> SolveStatus:
    """Propagate while recursive trials are disabled."""
    from gridsolver.solver.atomic_solver import AtomicSolver

    return AtomicSolver(grid, [], set()).solve_atomic()


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Apply deductions shared by every valid value of a small cell."""
    if _in_forcing_chain:
        return

    candidates = grid._candidates
    known = grid._known
    coord = CoordToString(grid.rows)

    target_cells = []
    for cell in range(grid.len):
        count = len(candidates[cell])
        if (
            known[cell] == 0
            and 2 <= count <= MAX_FORCING_CHAIN_CANDIDATES
        ):
            target_cells.append((count, cell))
    target_cells.sort()

    if not target_cells:
        return

    token = _in_forcing_chain.set(True)
    try:
        for _, cell in target_cells:
            values = sorted(candidates[cell])
            statuses: list[SolveStatus] = []
            consensus = BranchConsensus()

            for value in values:
                mark = grid.trail_mark()
                status = SolveStatus.INVALID
                try:
                    grid[cell] = value
                    try:
                        status = _propagate_with_techniques(grid)
                    except InvalidGrid:
                        status = SolveStatus.INVALID
                    if status is not SolveStatus.INVALID:
                        consensus.observe(grid)
                finally:
                    grid.trail_undo(mark)
                statuses.append(status)

            valid_indices = [
                index
                for index, status in enumerate(statuses)
                if status is not SolveStatus.INVALID
            ]
            invalid_count = len(values) - len(valid_indices)

            if len(valid_indices) == 1:
                survivor = values[valid_indices[0]]
                _lg.on and _lg.logr(
                    "ForcingChain",
                    f"{invalid_count} of {len(values)} branches contradict, "
                    f"forcing {coord(cell)}={survivor}",
                    coord(cell),
                )
                candidates[cell].intersection_update((survivor,))
                if not candidates[cell]:
                    raise InvalidGrid()
                return

            if not valid_indices:
                candidates[cell].clear()
                raise InvalidGrid()

            if invalid_count > 0:
                for index, status in enumerate(statuses):
                    if status is not SolveStatus.INVALID:
                        continue
                    value = values[index]
                    if value not in candidates[cell]:
                        continue
                    _lg.on and _lg.logr(
                        "ForcingChain",
                        f"{value} contradicts, removed from {coord(cell)}",
                        coord(cell),
                    )
                    candidates[cell].discard(value)
                if not candidates[cell]:
                    raise InvalidGrid()
                return

            made_progress = False

            for other_cell in range(grid.len):
                if other_cell == cell or known[other_cell] > 0:
                    continue
                forced_value = consensus.forced_value(other_cell)
                if forced_value <= 0:
                    continue
                _lg.on and _lg.logr(
                    "ForcingChain",
                    f"all {consensus.branch_count} branches force "
                    f"{coord(other_cell)}={forced_value} from {coord(cell)}",
                    coord(other_cell),
                )
                candidates[other_cell].intersection_update((forced_value,))
                if not candidates[other_cell]:
                    raise InvalidGrid()
                made_progress = True

            for other_cell in range(grid.len):
                if (
                    other_cell == cell
                    or known[other_cell] > 0
                    or len(candidates[other_cell]) <= 1
                ):
                    continue
                common_eliminations = consensus.common_eliminations(
                    other_cell,
                    candidates[other_cell],
                )
                for value in sorted(common_eliminations):
                    _lg.on and _lg.logr(
                        "ForcingChain",
                        f"{value} removed from {coord(other_cell)} "
                        f"(all {consensus.branch_count} branches eliminate)",
                        coord(other_cell),
                    )
                    candidates[other_cell].discard(value)
                    if not candidates[other_cell]:
                        raise InvalidGrid()
                    made_progress = True

            if made_progress:
                return
    finally:
        _in_forcing_chain.reset(token)
