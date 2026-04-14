import itertools

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import InvalidGrid, RuleAlwaysSatisfied
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


def _propagate_basic(grid):
    """Basic propagation: rules + guarantees, no power actions."""
    from gridsolver.solver.atomic_solver import _update_known_from_candidates, _update_candidates_from_known
    from gridsolver.solver.solve_guarantees import filter_guarantees
    known = grid._known
    cands = grid._candidates
    changed = True
    while changed and grid.is_valid:
        changed = False
        old_known = list(known)
        _update_known_from_candidates(grid.__setitem__, cands, known)
        try:
            for rule in list(grid.rules):
                try:
                    do_refresh, new_rules, new_gts = rule.apply(known, cands, grid.guarantees)
                    if do_refresh:
                        _update_candidates_from_known(cands, known)
                except RuleAlwaysSatisfied:
                    new_rules = []
                    new_gts = None
                    _update_candidates_from_known(cands, known)
                if new_rules is not None:
                    grid.deactivate_rule(rule)
                    for r in new_rules:
                        grid.add_rule_checked(r)
                if new_gts is not None:
                    for gt in new_gts:
                        grid.add_gtee_checked(gt)
            filter_guarantees(grid)
        except InvalidGrid:
            pass
        if list(known) != old_known:
            changed = True
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
                continue  # All branches invalid — can't determine anything safely

            made_progress = False

            # Case 1: All valid branches force same value in some cell
            for i2 in range(grid.len):
                if i2 == cell_a or i2 == cell_b or known[i2] > 0:
                    continue
                forced = valid_clones[0]._known[i2]
                if forced > 0 and all(cl._known[i2] == forced for cl in valid_clones[1:]):
                    _lg.logr("ForcingNet",
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
                for cl in valid_clones:
                    elim = cands[i2] - cl._candidates[i2]
                    if common_elim is None:
                        common_elim = elim
                    else:
                        common_elim &= elim
                    if not common_elim:
                        break
                if common_elim:
                    for v in common_elim:
                        if v in cands[i2]:
                            _lg.logr("ForcingNet",
                                     f"{v} removed from {c(i2)} "
                                     f"(all {len(valid_clones)} branches of "
                                     f"net {c(cell_a)}+{c(cell_b)})",
                                     c(i2))
                            cands[i2].discard(v)
                            if not cands[i2]:
                                raise InvalidGrid()
                            made_progress = True

            # Case 3: Some value for cell_a or cell_b contradicts in ALL combos
            for va in vals_a:
                if all(not clone.is_valid or clone._known[cell_a] != va
                       for clone in valid_clones):
                    # va contradicts with every value of cell_b — but only if
                    # it truly contradicts (not just wasn't assigned)
                    all_invalid = True
                    for vb in vals_b:
                        clone = grid.deepcopy()
                        clone[cell_a] = va
                        clone[cell_b] = vb
                        try:
                            s = _propagate_basic(clone)
                        except InvalidGrid:
                            s = SolveStatus.INVALID
                        if s != SolveStatus.INVALID:
                            all_invalid = False
                            break
                    if all_invalid and va in cands[cell_a]:
                        _lg.logr("ForcingNet",
                                 f"{va} removed (contradicts with all values of {c(cell_b)})",
                                 c(cell_a))
                        cands[cell_a].discard(va)
                        if not cands[cell_a]:
                            raise InvalidGrid()
                        made_progress = True

            for vb in vals_b:
                all_invalid = True
                for va in vals_a:
                    clone = grid.deepcopy()
                    clone[cell_a] = va
                    clone[cell_b] = vb
                    try:
                        s = _propagate_basic(clone)
                    except InvalidGrid:
                        s = SolveStatus.INVALID
                    if s != SolveStatus.INVALID:
                        all_invalid = False
                        break
                if all_invalid and vb in cands[cell_b]:
                    _lg.logr("ForcingNet",
                             f"{vb} removed (contradicts with all values of {c(cell_a)})",
                             c(cell_b))
                    cands[cell_b].discard(vb)
                    if not cands[cell_b]:
                        raise InvalidGrid()
                    made_progress = True

            if made_progress:
                return
