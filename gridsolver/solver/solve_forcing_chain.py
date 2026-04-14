from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg

_in_forcing_chain = False

MAX_FORCING_CHAIN_CANDIDATES = 4  # Up to 4-value cells


def _propagate_with_techniques(grid):
    """Propagation with cheap techniques — runs the full atomic solver
    (minus forcing chain/net/nishio to prevent recursion and keep it fast)."""
    from gridsolver.solver.atomic_solver import AtomicSolver
    return AtomicSolver(grid, [], set()).solve_atomic()


# noinspection PyProtectedMember
def forcing_chain(grid: Grid) -> None:
    """Forcing Chain technique (generalized to N candidates).

    For each cell with 2..MAX candidates, test all candidates via basic propagation:
    - If all but one branch contradict, force the surviving candidate.
    - If ALL non-contradicted branches agree on a value for some cell, force it.
    - If ALL non-contradicted branches eliminate the same candidate, remove it.

    Tries smallest cells first (bivalue, then trivalue, etc).
    """
    global _in_forcing_chain
    if _in_forcing_chain:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    # Collect cells sorted by candidate count (smallest first)
    target_cells = []
    for cell in range(grid.len):
        n = len(cands[cell])
        if known[cell] == 0 and 2 <= n <= MAX_FORCING_CHAIN_CANDIDATES:
            target_cells.append((n, cell))
    target_cells.sort()

    if not target_cells:
        return

    _in_forcing_chain = True
    try:
        for _, cell in target_cells:
            vals = list(cands[cell])
            statuses = []
            clones = []
            for val in vals:
                clone = grid.deepcopy()
                clone[cell] = val
                try:
                    s = _propagate_with_techniques(clone)
                except InvalidGrid:
                    s = SolveStatus.INVALID
                statuses.append(s)
                clones.append(clone)

            valid_indices = [j for j, s in enumerate(statuses) if s != SolveStatus.INVALID]
            invalid_count = len(vals) - len(valid_indices)

            # If all but one contradict, force the survivor
            if len(valid_indices) == 1:
                survivor = vals[valid_indices[0]]
                _lg.logr("ForcingChain",
                         f"{invalid_count} of {len(vals)} branches contradict, "
                         f"forcing {c(cell)}={survivor}",
                         c(cell))
                cands[cell].intersection_update((survivor,))
                return

            if not valid_indices:
                cands[cell].clear()
                raise InvalidGrid()

            # If some contradict, eliminate those candidates
            if invalid_count > 0:
                for j, s in enumerate(statuses):
                    if s == SolveStatus.INVALID:
                        v = vals[j]
                        if v in cands[cell]:
                            _lg.logr("ForcingChain",
                                     f"{v} contradicts, removed from {c(cell)}",
                                     c(cell))
                            cands[cell].discard(v)
                # Made progress — return and let solver re-propagate
                return

            # All branches valid — find common deductions among ALL branches
            made_progress = False

            # Case 1: All branches force the same value in some cell
            for i in range(grid.len):
                if i == cell or known[i] > 0:
                    continue
                forced_val = clones[valid_indices[0]]._known[i]
                if forced_val > 0 and all(
                        clones[j]._known[i] == forced_val for j in valid_indices[1:]):
                    _lg.logr("ForcingChain",
                             f"all {len(valid_indices)} branches force {c(i)}={forced_val} "
                             f"from {c(cell)}",
                             c(i))
                    cands[i].intersection_update((forced_val,))
                    made_progress = True

            # Case 2: All branches eliminate the same candidate
            for i in range(grid.len):
                if i == cell or known[i] > 0 or len(cands[i]) <= 1:
                    continue
                # Find candidates eliminated in ALL valid branches
                common_eliminated = None
                for j in valid_indices:
                    elim = cands[i] - clones[j]._candidates[i]
                    if common_eliminated is None:
                        common_eliminated = elim
                    else:
                        common_eliminated &= elim
                    if not common_eliminated:
                        break
                if common_eliminated:
                    for v in common_eliminated:
                        if v in cands[i]:
                            _lg.logr("ForcingChain",
                                     f"{v} removed from {c(i)} "
                                     f"(all {len(valid_indices)} branches eliminate)",
                                     c(i))
                            cands[i].discard(v)
                            if not cands[i]:
                                raise InvalidGrid()
                            made_progress = True

            if made_progress:
                return
    finally:
        _in_forcing_chain = False
