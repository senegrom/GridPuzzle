import itertools

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.propagation import (
    BranchConsensus,
    apply_consensus,
    propagate_basic,
)
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def forcing_net(grid: Grid) -> None:
    """Apply deductions shared by every valid assignment of two small cells."""
    if _solve_fc._in_forcing_chain:
        return

    candidates = grid._candidates
    known = grid._known
    coord = CoordToString(grid.rows)

    small_cells = sorted(
        (len(candidates[cell]), cell)
        for cell in range(grid.len)
        if known[cell] == 0 and 2 <= len(candidates[cell]) <= 4
    )
    if len(small_cells) < 2:
        return

    pairs_tried = 0
    upper_bound = min(len(small_cells), 12)
    for first_index in range(upper_bound):
        _, cell_a = small_cells[first_index]
        for second_index in range(first_index + 1, upper_bound):
            _, cell_b = small_cells[second_index]
            values_a = sorted(candidates[cell_a])
            values_b = sorted(candidates[cell_b])

            if len(values_a) * len(values_b) > 16:
                continue

            pairs_tried += 1
            if pairs_tried > 30:
                return

            valid_pairs: list[tuple[int, int]] = []
            consensus = BranchConsensus()
            for value_a, value_b in itertools.product(values_a, values_b):
                mark = grid.trail_mark()
                status = SolveStatus.INVALID
                try:
                    try:
                        grid[cell_a] = value_a
                        grid[cell_b] = value_b
                        status = propagate_basic(grid)
                    except InvalidGrid:
                        status = SolveStatus.INVALID
                    if status is not SolveStatus.INVALID:
                        valid_pairs.append((value_a, value_b))
                        consensus.observe(grid)
                finally:
                    grid.trail_undo(mark)

            if not valid_pairs:
                candidates[cell_a].clear()
                raise InvalidGrid()

            made_progress = apply_consensus(
                grid,
                consensus,
                frozenset((cell_a, cell_b)),
                "ForcingNet",
                f"net {coord(cell_a)}+{coord(cell_b)}",
                coord,
            )

            valid_a = {value_a for value_a, _ in valid_pairs}
            valid_b = {value_b for _, value_b in valid_pairs}
            for cell, values, other_cell, valid_values in (
                (cell_a, values_a, cell_b, valid_a),
                (cell_b, values_b, cell_a, valid_b),
            ):
                for value in values:
                    if value not in candidates[cell] or value in valid_values:
                        continue
                    _lg.on and _lg.logr(
                        "ForcingNet",
                        f"{value} removed (contradicts with all values of "
                        f"{coord(other_cell)})",
                        coord(cell),
                    )
                    candidates[cell].discard(value)
                    if not candidates[cell]:
                        raise InvalidGrid()
                    made_progress = True

            if made_progress:
                return
