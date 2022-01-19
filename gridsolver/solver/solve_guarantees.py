import itertools
from typing import List, Optional, Set, Tuple

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid, Guarantee
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def filter_guarantees(grid: Grid) -> None:
    # remove duplicates
    gt_dic = grid.guarantees_by_value
    for val in range(1, grid.max_elem + 1):
        for gt1, gt2 in itertools.combinations(gt_dic[val], 2):
            if gt1.cells <= gt2.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt2)
            elif gt2.cells <= gt1.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt1)
    del gt_dic

    for gt in grid.guarantees.copy():
        update_from_guarantee(grid, gt)


# noinspection PyProtectedMember
def update_from_guarantee(grid: Grid, gt: Guarantee):
    first_idx = -1
    is_single = True
    cands = grid._candidates
    known = grid._known
    for cell in gt.cells:
        if gt.val in cands[cell]:
            if first_idx == -1:
                first_idx = cell
            else:
                is_single = False
        if gt.val == known[cell]:
            grid.deactivate_gtee(gt)
            return

    if is_single:
        if first_idx == -1:
            cands[next(iter(gt.cells))].clear()
            raise InvalidGrid()
        pfi: Set[int] = cands[first_idx]
        kfi = known[first_idx]
        if kfi == 0 and gt.val in pfi:
            known[first_idx] = gt.val
            grid.deactivate_gtee(gt)
            return
        else:
            pfi.clear()
            raise InvalidGrid()

    if any(known[cell] > 0 or gt.val not in cands[cell] for cell in gt.cells):
        grid.deactivate_gtee(gt)

        new_cells = frozenset(cell for cell in gt.cells if known[cell] == 0 and
                              gt.val in cands[cell])

        if not new_cells:
            cands[next(iter(gt.cells))].clear()
            raise InvalidGrid()

        new_gt = Guarantee(val=gt.val, cells=new_cells, rows=grid.rows, cols=grid.cols)
        grid.add_gtee_checked(new_gt)


def _remove_hidden_tuples_inner(cands: Tuple[Set[int]], c: CoordToString, length, prev_gts: List[Guarantee],
                                remaining_cdts: List[Guarantee],
                                values: Set, prev_union: List[Optional[Set]],
                                candidates_for_round: Optional[List[Guarantee]] = None):
    ll = len(prev_gts)

    for i, gt in enumerate(candidates_for_round if candidates_for_round is not None else remaining_cdts):
        union_cells = prev_union[ll - 1] | gt.cells if ll else gt.cells
        values.add(gt.val)
        if len(union_cells) > length:
            raise RuntimeError("Should not happen")
        if len(union_cells) < len(values):
            _lg.logr(f"HiddenTuple@{length}",
                     f"Invalid: {len(union_cells)} < {len(values)} for values {values}",
                     c(union_cells))
            cands[union_cells.pop()].clear()
            raise InvalidGrid
        if ll == length - 1:
            for cell in union_cells:
                if not cands[cell] <= values:
                    _lg.logr(f"HiddenTuple@{length}",
                             f"{cands[cell]} vs {values} w/ tuple cells {c(union_cells)}",
                             c(cell))
                    cands[cell].intersection_update(values)
        else:
            prev_union[ll] = union_cells
            if candidates_for_round is not None:
                new_remaining_cdts = [gt for gt in remaining_cdts if
                                      gt.val not in values and len(union_cells | gt.cells) <= length]
            else:
                new_remaining_cdts = [gt for gt in remaining_cdts[i + 1:] if
                                      gt.val not in values and len(union_cells | gt.cells) <= length]
            if new_remaining_cdts:
                _remove_hidden_tuples_inner(cands, c, length, prev_gts + [gt], new_remaining_cdts,
                                            values, prev_union)
        values.remove(gt.val)


# noinspection PyProtectedMember
def remove_hidden_tuples(grid: Grid, max_ht, candidate_gts: Optional[List[Guarantee]]) -> None:
    range_start = min(max_ht, grid.max_elem - 1)
    c = CoordToString(grid.rows)
    if candidate_gts is None:
        candidates = grid.get_guarantees_shorter_than(range_start)
        for i in range(range_start, 1, -1):
            if not candidates:
                break
            _remove_hidden_tuples_inner(grid._candidates, c, i, [], candidates, set(), [None] * i)
            if i > 2:
                candidates = [gt for gt in candidates if len(gt.cells) <= i - 1]
        return

    candidates_for_1st = [gt for gt in candidate_gts if len(gt.cells) <= range_start]
    if not candidates_for_1st:
        return
    candidates_for_2nd = grid.get_guarantees_shorter_than(range_start)
    for i in range(range_start, 1, -1):
        if not candidates_for_1st or not candidates_for_2nd:
            break
        _remove_hidden_tuples_inner(grid._candidates, c, i, [], candidates_for_2nd, set(), [None] * i,
                                    candidates_for_1st)
        if i > 2:
            candidates_for_1st = [gt for gt in candidates_for_1st if len(gt.cells) <= i - 1]
            candidates_for_2nd = [gt for gt in candidates_for_2nd if len(gt.cells) <= i - 1]
