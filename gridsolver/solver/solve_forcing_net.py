import itertools

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.propagation import propagate_basic
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
    for first_index in range(min(len(small_cells), 12)):
        _, cell_a = small_cells[first_index]
        for second_index in range(first_index + 1, min(len(small_cells), 12)):
            _, cell_b = small_cells[second_index]
            values_a = sorted(candidates[cell_a])
            values_b = sorted(candidates[cell_b])

            if len(values_a) * len(values_b) > 16:
                continue

            pairs_tried += 1
            if pairs_tried > 30:
                return

            valid_clones: list[Grid] = []
            for value_a, value_b in itertools.product(values_a, values_b):
                clone = grid.deepcopy()
                try:
                    clone[cell_a] = value_a
                    clone[cell_b] = value_b
                    status = propagate_basic(clone)
                except InvalidGrid:
                    status = SolveStatus.INVALID
                if status is not SolveStatus.INVALID:
                    valid_clones.append(clone)

            if not valid_clones:
                candidates[cell_a].clear()
                raise InvalidGrid()

            made_progress = False

            # Every valid branch fixes the same value.
            for cell in range(grid.len):
                if cell in (cell_a, cell_b) or known[cell] > 0:
                    continue
                forced = valid_clones[0]._known[cell]
                if forced > 0 and all(clone._known[cell] == forced for clone in valid_clones[1:]):
                    _lg.on and _lg.logr(
                        "ForcingNet",
                        f"all {len(valid_clones)} branches force {coord(cell)}={forced} "
                        f"from net {coord(cell_a)}+{coord(cell_b)}",
                        coord(cell),
                    )
                    candidates[cell].intersection_update((forced,))
                    made_progress = True

            # Every valid branch removes the same candidate.
            for cell in range(grid.len):
                if cell in (cell_a, cell_b) or known[cell] > 0 or len(candidates[cell]) <= 1:
                    continue
                common_eliminations: set[int] | None = None
                for clone in valid_clones:
                    eliminated = candidates[cell] - clone._candidates[cell]
                    if common_eliminations is None:
                        common_eliminations = eliminated
                    else:
                        common_eliminations &= eliminated
                    if not common_eliminations:
                        break

                for value in common_eliminations or ():
                    if value not in candidates[cell]:
                        continue
                    _lg.on and _lg.logr(
                        "ForcingNet",
                        f"{value} removed from {coord(cell)} "
                        f"(all {len(valid_clones)} branches of "
                        f"net {coord(cell_a)}+{coord(cell_b)})",
                        coord(cell),
                    )
                    candidates[cell].discard(value)
                    if not candidates[cell]:
                        raise InvalidGrid()
                    made_progress = True

            # A tested value that appears in no valid pair is contradicted.
            for cell, values, other_cell in (
                (cell_a, values_a, cell_b),
                (cell_b, values_b, cell_a),
            ):
                for value in values:
                    if value not in candidates[cell]:
                        continue
                    if all(clone._known[cell] != value for clone in valid_clones):
                        _lg.on and _lg.logr(
                            "ForcingNet",
                            f"{value} removed (contradicts with all values of {coord(other_cell)})",
                            coord(cell),
                        )
                        candidates[cell].discard(value)
                        if not candidates[cell]:
                            raise InvalidGrid()
                        made_progress = True

            if made_progress:
                return
