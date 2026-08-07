import itertools

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver import solve_forcing_chain as _solve_fc
from gridsolver.solver.solver_log import lg as _lg


def _propagation_snapshot(grid: Grid):
    """Monotone state used to detect a complete basic-propagation fixpoint."""
    return (bytes(grid._known), sum(len(candidates) for candidates in grid._candidates),
            len(grid.rules) + len(grid.guarantees),
            len(grid.rules_ia) + len(grid.guarantees_ia))


def _propagate_basic(grid):
    """Propagate rules and guarantees to a fixpoint, without power actions.

    Candidate-only and rule-only changes matter: they can enable another rule
    on the next pass even when no cell became known.  The previous loop watched
    only known values and could therefore stop early inside Nishio and forcing
    nets, missing contradictions and common deductions.
    """
    from gridsolver.solver.atomic_solver import _relevant_gts, _update_known_from_candidates, \
        _update_candidates_from_known
    from gridsolver.solver.solve_guarantees import filter_guarantees

    known = grid._known
    cands = grid._candidates
    while grid.is_valid:
        before = _propagation_snapshot(grid)
        _update_known_from_candidates(grid.__setitem__, cands, known)
        try:
            for rule in list(grid.rules):
                try:
                    do_refresh, new_rules, new_gts = rule.apply(known, cands, _relevant_gts(grid, rule))
                    if do_refresh:
                        _update_candidates_from_known(cands, known)
                except RuleAlwaysSatisfied:
                    new_rules = []
                    new_gts = None
                    _update_candidates_from_known(cands, known)
                if new_rules is not None:
                    grid.deactivate_rule(rule)
                    for new_rule in new_rules:
                        grid.add_rule_checked(new_rule)
                if new_gts is not None:
                    for gt in new_gts:
                        grid.add_gtee_checked(gt)
            filter_guarantees(grid)
        except InvalidGrid:
            return SolveStatus.INVALID

        if _propagation_snapshot(grid) == before:
            break

    if not grid.is_valid:
        return SolveStatus.INVALID
    if grid.is_solved:
        return SolveStatus.SOLVED
    return SolveStatus.NONE


# noinspection PyProtectedMember
def forcing_net(grid: Grid) -> None:
    """Forcing Net technique.

    Pick 2 cells with the smallest candidate sets and test all combinations
    of their values. If ALL valid (non-contradicted) branches agree on a
    value or elimination, apply it.

    This is strictly more powerful than single-cell forcing chains because
    it tests interactions between cells.
    """
    if _solve_fc._in_forcing_chain:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)

    # Find cells with smallest candidate sets (2-4 candidates)
    small_cells = []
    for cell in range(grid.len):
        n = len(cands[cell])
        if known[cell] == 0 and 2 <= n <= 4:
            small_cells.append((n, cell))
    small_cells.sort()

    if len(small_cells) < 2:
        return

    # Try pairs of cells (pick from the smallest)
    max_pairs_to_try = 30
    pairs_tried = 0

    for i in range(min(len(small_cells), 12)):
        _, cell_a = small_cells[i]
        for j in range(i + 1, min(len(small_cells), 12)):
            _, cell_b = small_cells[j]

            vals_a = list(cands[cell_a])
            vals_b = list(cands[cell_b])
            n_branches = len(vals_a) * len(vals_b)

            if n_branches > 16:
                continue  # Too many combinations

            pairs_tried += 1
            if pairs_tried > max_pairs_to_try:
                return

            # Test all combinations
            valid_clones = []
            for va, vb in itertools.product(vals_a, vals_b):
                clone = grid.deepcopy()
                clone[cell_a] = va
                clone[cell_b] = vb
                try:
                    status = _propagate_basic(clone)
                except InvalidGrid:
                    status = SolveStatus.INVALID
                if status != SolveStatus.INVALID:
                    valid_clones.append(clone)

            if not valid_clones:
                # The branch set covers every assignment of the pair at this
                # fixpoint — all contradicting means the grid itself is invalid.
                cands[cell_a].clear()
                raise InvalidGrid()

            made_progress = False

            # Case 1: All valid branches force same value in some cell
            for i2 in range(grid.len):
                if i2 == cell_a or i2 == cell_b or known[i2] > 0:
                    continue
                forced = valid_clones[0]._known[i2]
                if forced > 0 and all(cl._known[i2] == forced for cl in valid_clones[1:]):
                    _lg.on and _lg.logr("ForcingNet",
                             f"all {len(valid_clones)} branches force {c(i2)}={forced} "
                             f"from net {c(cell_a)}+{c(cell_b)}",
                             c(i2))
                    cands[i2].intersection_update((forced,))
                    made_progress = True

            # Case 2: All valid branches eliminate same candidate
            for i2 in range(grid.len):
                if i2 == cell_a or i2 == cell_b or known[i2] > 0 or len(cands[i2]) <= 1:
                    continue
                common_elim = None
                for clone in valid_clones:
                    elim = cands[i2] - clone._candidates[i2]
                    if common_elim is None:
                        common_elim = elim
                    else:
                        common_elim &= elim
                    if not common_elim:
                        break
                if common_elim:
                    for value in common_elim:
                        if value in cands[i2]:
                            _lg.on and _lg.logr("ForcingNet",
                                     f"{value} removed from {c(i2)} "
                                     f"(all {len(valid_clones)} branches of "
                                     f"net {c(cell_a)}+{c(cell_b)})",
                                     c(i2))
                            cands[i2].discard(value)
                            if not cands[i2]:
                                raise InvalidGrid()
                            made_progress = True

            # Case 3: a value of cell_a/cell_b appearing in no valid branch is
            # contradicted (every valid clone keeps its assigned value in _known,
            # so the main loop above already tested all combinations)
            for cell_x, vals_x, cell_other in ((cell_a, vals_a, cell_b), (cell_b, vals_b, cell_a)):
                for value in vals_x:
                    if value in cands[cell_x] and all(cl._known[cell_x] != value for cl in valid_clones):
                        _lg.on and _lg.logr("ForcingNet",
                                 f"{value} removed (contradicts with all values of {c(cell_other)})",
                                 c(cell_x))
                        cands[cell_x].discard(value)
                        if not cands[cell_x]:
                            raise InvalidGrid()
                        made_progress = True

            if made_progress:
                return
