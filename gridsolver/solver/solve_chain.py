from collections import deque
from typing import List, FrozenSet, Dict, Set, Union

from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def w_wing(grid: Grid) -> None:
    cands = grid._candidates
    cells2 = grid.get_cells_with_candidate_length(2)
    if not cells2:
        return
    cs = CoordToString(grid.rows)

    c2_dic: Dict[FrozenSet[int], Set[int]] = {key: set() for key in {frozenset(cd) for _, cd in cells2}}

    for cell, cd in cells2:
        c2_dic[frozenset(cd)].add(cell)
    sl = grid.semi_strong_links
    wl = grid.weak_links
    if not any(lk for lk in wl):
        return

    for key, cells in c2_dic.items():
        key_l = list(key)
        assert len(key_l) == 2

        cell_it = iter(cells)
        next(cell_it)
        for cell in cell_it:
            for i, val in enumerate(key_l):
                other_val = key_l[1 - i]
                les = _find_link_ends(cell, cells, sl[val], wl, True)
                for le in les:
                    if le == cell and val in cands[cell]:
                        _lg.logr(f"LoopW",
                                 f"{val} removed from {set(key)}", cs(cell))
                    joint_nb = wl[cell] & wl[le]
                    for nb in joint_nb:
                        if other_val in cands[nb]:
                            _lg.logr(f"WingW",
                                     f"{other_val} removed from {set(key)} w/ wing {cs([cell, le])}", cs(nb))
                            cands[nb].remove(other_val)


def _find_link_ends(cell: int, end_cells: Union[None, Set[int], FrozenSet[int]], sl: List[FrozenSet[int]],
                    wl: List[FrozenSet[int]],
                    start_weak=True) \
        -> List[int]:
    if start_weak:
        visited_weak = set(wl[cell])
        visited_strong = {cell}
        todo_weak = deque(wl[cell])
        todo_strong = deque()
    else:
        visited_strong = set(sl[cell])
        visited_weak = {cell}
        todo_strong = deque(sl[cell])
        todo_weak = deque()
    results = []

    while todo_weak or todo_strong:
        if todo_weak:
            active = todo_weak.popleft()
            if start_weak and (end_cells is None or active in end_cells):
                results.append(active)
            for nb in sl[active] - visited_strong:
                visited_strong.add(nb)
                todo_strong.append(nb)
        if todo_strong:
            active = todo_strong.popleft()
            if not start_weak and (end_cells is None or active in end_cells):
                results.append(active)
            for nb in wl[active] - visited_weak:
                visited_weak.add(nb)
                todo_weak.append(nb)

    return results


def x_chain(grid: Grid) -> None:
    cands = grid._candidates
    cs = CoordToString(grid.rows)

    sl = grid.semi_strong_links
    wl = grid.weak_links
    if not any(lk for lk in wl):
        return

    for cell, cd in enumerate(cands):
        for val in cd.copy():
            les = _find_link_ends(cell, None, sl[val], wl, False)
            for le in les:
                if le == cell:
                    _lg.logr(f"LoopX",
                             f"all but {val} removed from {set(cd)}", cs(cell))
                    cd.intersection_update((val,))
                joint_nb = wl[cell] & wl[le]
                for nb in joint_nb:
                    if val in cands[nb]:
                        _lg.logr(f"ChainX",
                                 f"{val} removed from {set(cands[nb])} w/ chain {cs([cell, le])}", cs(nb))
                        cands[nb].remove(val)


# todo
# noinspection PyProtectedMember
def xy_chain(grid: Grid) -> None:
    cands = grid._candidates
    cells2 = grid.get_cells_with_candidate_length(2)
    if not cells2:
        return
    cells2_set = set(cell for cell, _ in cells2)
    cs = CoordToString(grid.rows)

    c2_dic: Dict[FrozenSet[int], Set[int]] = {key: set() for key in {frozenset(cd) for _, cd in cells2}}

    for cell, cd in cells2:
        c2_dic[frozenset(cd)].add(cell)
    sl = grid.semi_strong_links
    sl = {val: [link & cells2_set
                for link in sl[val]]
          for val in range(1, grid.max_elem + 1)}
    wl = grid.weak_links
    wl = [link & cells2_set for link in wl]
    if not any(lk for lk in wl):
        return

    for cells, key in c2_dic.items():
        key_l = list(key)
        assert len(key) == 2
        _lg.logd(f"Cells {cell} w/ {key}")

        end_cells_union = [
            frozenset().union(sl[key_l[0]][cell] for cell in cells),
            frozenset().union(sl[key_l[1]][cell] for cell in cells),
        ]

        end_cells_seperate = [
            {cell: [] for cell in end_cells_union[0]},
            {cell: [] for cell in end_cells_union[1]},
        ]

        for cell in cells:
            for end_cell in sl[key_l[0]][cell]:
                end_cells_seperate[0][end_cell].append(cell)
            for end_cell in sl[key_l[1]][cell]:
                end_cells_seperate[1][end_cell].append(cell)
        del cell

        _lg.logd(f"End cells are {end_cells_union}")
        _lg.logd(f"End cells sep. are {end_cells_seperate}")

        for start_cell, start_cd in cells2:
            _lg.logd(f"Start cell {start_cell}")
            for i, val in enumerate(key_l):
                other_val = key_l[1 - i]
                les = _find_link_ends(start_cell, end_cells_union[i], wl, wl, True)
                for le in les:
                    if le == start_cell and val in start_cd:
                        _lg.logr(f"LoopXY",
                                 f"{val} removed from {set(key)}", cs(cell))
                    joint_nb = wl[cell] & wl[le]
                    for nb in joint_nb:
                        if other_val in cands[nb]:
                            _lg.logr(f"WingW",
                                     f"{other_val} removed from {set(key)} w/ wing {cs([cell, le])}", cs(nb))
                            cands[nb].remove(other_val)
