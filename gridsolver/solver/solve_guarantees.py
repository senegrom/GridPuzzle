import itertools
from typing import List, Optional, Set

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid, Guarantee
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def filter_guarantees(grid: Grid) -> None:
    # remove duplicates
    for val in range(1, grid.max_elem + 1):
        val_gts = [gt for gt in grid.guarantees if gt.val == val]
        for gt1, gt2 in itertools.combinations(val_gts, 2):
            if gt1.cells <= gt2.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt2)
            elif gt2.cells <= gt1.cells and gt1 in grid.guarantees and gt2 in grid.guarantees:
                grid.deactivate_gtee(gt1)
        del val_gts

    for gt in grid.guarantees.copy():
        update_from_guarantee(grid, gt)


# noinspection PyProtectedMember
def _remove_hidden_pairs_inner(grid: Grid, length, prev_gts: List[Guarantee],
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
                     f"Invalid: {len(union_cells)} < {len(values)}",
                     set(union_cells))
            grid._candidates[next(iter(union_cells))].clear()
            raise InvalidGrid
        if ll == length - 1:
            for cell in union_cells:
                if not grid._candidates[cell] <= values:
                    _lg.logr(f"HiddenTuple@{length}",
                             f"{grid._candidates[cell]} vs {values}",
                             cell)
                    grid._candidates[cell].intersection_update(values)
        else:
            prev_union[ll] = union_cells
            if candidates_for_round is not None:
                new_remaining_cdts = [gt for gt in remaining_cdts if
                                      gt.val not in values and len(union_cells | gt.cells) <= length]
            else:
                new_remaining_cdts = [gt for gt in remaining_cdts[i + 1:] if
                                      gt.val not in values and len(union_cells | gt.cells) <= length]
            if new_remaining_cdts:
                _remove_hidden_pairs_inner(grid, length, prev_gts + [gt], new_remaining_cdts,
                                           values, prev_union)
        values.remove(gt.val)


_MAX_HIDDEN_TUPLE = 7


def remove_hidden_pairs(grid: Grid, candidate_gts: Optional[List[Guarantee]]) -> None:
    range_start = min(_MAX_HIDDEN_TUPLE, grid.max_elem - 1)
    if candidate_gts is None:
        candidates = [gt for gt in grid.guarantees if len(gt.cells) <= range_start]
        _lg.logd(f"hidden_tuples {range_start}/{len(grid.guarantees)}>{len(candidates)}")
        for i in range(range_start, 1, -1):
            if not candidates:
                break
            _remove_hidden_pairs_inner(grid, i, [], candidates, set(), [None] * i)
            if i > 2:
                candidates = [gt for gt in candidates if len(gt.cells) <= i - 1]
        return

    candidates_for_1st = [gt for gt in candidate_gts if len(gt.cells) <= range_start]
    if not candidates_for_1st:
        _lg.logd(f"hidden_tuples C {range_start}/{len(grid.guarantees)}>{len(candidates_for_1st)}")
        return
    candidates_for_2nd = [gt for gt in grid.guarantees if len(gt.cells) <= range_start]
    _lg.logd(f"hidden_tuples C {range_start}/{len(grid.guarantees)}>" +
             f"{len(candidates_for_1st)}/{len(candidates_for_2nd)}")
    for i in range(range_start, 1, -1):
        if not candidates_for_1st or not candidates_for_2nd:
            break
        _remove_hidden_pairs_inner(grid, i, [], candidates_for_2nd, set(), [None] * i, candidates_for_1st)
        if i > 2:
            candidates_for_1st = [gt for gt in candidates_for_1st if len(gt.cells) <= i - 1]
            candidates_for_2nd = [gt for gt in candidates_for_2nd if len(gt.cells) <= i - 1]


# todo combine guarantees like AtLeastOnce
# noinspection PyProtectedMember
def update_from_guarantee(grid: Grid, gt: Guarantee):
    first_idx = -1
    is_single = True
    for cell in gt.cells:
        if gt.val in grid._candidates[cell]:
            if first_idx == -1:
                first_idx = cell
            else:
                is_single = False
        if gt.val == grid._known[cell]:
            grid.deactivate_gtee(gt)
            return

    if is_single:
        if first_idx == -1:
            grid._candidates[next(iter(gt.cells))].clear()
            raise InvalidGrid()
        pfi: Set[int] = grid._candidates[first_idx]
        kfi = grid._known[first_idx]
        if kfi == 0 and gt.val in pfi:
            grid._known[first_idx] = gt.val
            grid.deactivate_gtee(gt)
            return
        else:
            pfi.clear()
            raise InvalidGrid()

    if any(grid._known[cell] > 0 or gt.val not in grid._candidates[cell] for cell in gt.cells):
        grid.deactivate_gtee(gt)

        new_cells = frozenset(cell for cell in gt.cells if grid._known[cell] == 0 and
                              gt.val in grid._candidates[cell])

        if not new_cells:
            grid._candidates[next(iter(gt.cells))].clear()
            raise InvalidGrid()

        new_gt = Guarantee(val=gt.val, cells=new_cells, rows=grid.rows, cols=grid.cols)
        grid.add_gtee_checked(new_gt)
