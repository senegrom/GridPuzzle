import itertools
from collections import deque
from typing import List, FrozenSet, Dict, Set, Union, Tuple, Optional, Iterable

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
                les, strg_dic, weak_dic = _find_link_ends(cell, cells, sl[val], wl, True)
                for le in les:
                    if le == cell and val in cands[cell]:
                        chain = _compute_chain(le, weak_dic, strg_dic, True)
                        _lg.logr(f"LoopW",
                                 f"{val} removed from {set(key)} w/ loop {cs(chain)} ", cs(cell))
                    joint_nb = wl[cell] & wl[le]
                    for nb in joint_nb:
                        if other_val in cands[nb]:
                            chain = _compute_chain(le, weak_dic, strg_dic, True)
                            _lg.logr(f"WingW",
                                     f"{other_val} removed from {set(key)} w/ wing {cs(chain)}", cs(nb))
                            cands[nb].remove(other_val)


def _find_link_ends(cell: int, end_cells: Union[None, Set[int], FrozenSet[int]], sl: List[Set[int]],
                    wl: List[Set[int]],
                    start_weak=True) \
        -> Tuple[List[int], Dict, Dict]:
    if start_weak:
        visited_weak_dic = {c: cell for c in wl[cell]}
        visited_weak = set(wl[cell])
        visited_strong_dic = {cell: None}
        visited_strong = {cell}
        todo_weak = deque(wl[cell])
        todo_strong = deque()
    else:
        visited_strong_dic = {c: cell for c in sl[cell]}
        visited_strong = set(sl[cell])
        visited_weak_dic = {cell: None}
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
                visited_strong_dic[nb] = active
                todo_strong.append(nb)
        if todo_strong:
            active = todo_strong.popleft()
            if not start_weak and (end_cells is None or active in end_cells):
                results.append(active)
            for nb in wl[active] - visited_weak:
                visited_weak.add(nb)
                visited_weak_dic[nb] = active
                todo_weak.append(nb)

    return results, visited_strong_dic, visited_weak_dic


def _compute_chain(end: int, visited_weak_dic: Dict, visited_strong_dic: Dict, start_weak: bool):
    it = itertools.cycle([visited_strong_dic, visited_weak_dic])
    if start_weak:
        next(it)

    result = [end]

    for dic in it:
        end = dic[end]
        if end is not None:
            result.append(end)
        else:
            break

    return result


def x_chain(grid: Grid) -> None:
    cands = grid._candidates
    cs = CoordToString(grid.rows)

    sl = grid.semi_strong_links
    wl = grid.weak_links
    if not any(lk for lk in wl):
        return

    for cell, cd in enumerate(cands):
        for val in cd.copy():
            les, strg_dic, weak_dic = _find_link_ends(cell, None, sl[val], wl, False)
            for le in les:
                if le == cell:
                    chain = _compute_chain(le, weak_dic, strg_dic, False)
                    _lg.logr(f"LoopX",
                             f"all but {val} removed from {set(cd)} w/ loop {cs(chain)}", cs(cell))
                    cd.intersection_update((val,))
                joint_nb = wl[cell] & wl[le]
                for nb in joint_nb:
                    if val in cands[nb]:
                        chain = _compute_chain(le, weak_dic, strg_dic, False)
                        _lg.logr(f"ChainX",
                                 f"{val} removed from {set(cands[nb])} w/ chain {cs(chain)}", cs(nb))
                        cands[nb].remove(val)


# noinspection PyProtectedMember
def xy_chain(grid: Grid) -> None:
    cands = grid._candidates
    cs = CoordToString(grid.rows)

    sl = grid.semi_strong_links_all
    wl = grid.weak_links

    for val, links in sl.items():
        for link in links:
            link.difference_update((val_x, cell) for val_x, cell in link if not wl[cell])
    del val, links

    for link in wl:
        link.difference_update(
            cell for cell in range(grid.len) if not any(sl[val][cell] for val in range(1, grid.max_elem + 1)))
    del link

    if not any(lk for lk in wl):
        return

    valid_cells = [(cell, cands[cell]) for cell, cts in enumerate(cands) if len(cts) > 1]
    valid_cells_set = {cell for cell, cd in valid_cells}

    for val in range(1, grid.max_elem + 1):
        sl_val = sl[val]
        for start_cell, cd in valid_cells:
            if not sl_val[start_cell]:
                continue

            les, strg_dic, weak_dic = _find_link_ends_with_num(start_cell=start_cell, end_cells=valid_cells_set,
                                                               start_weak=False, end_weak=False,
                                                               start_num=val, end_nums=val, sl=sl,
                                                               wl=wl,
                                                               max_elem=grid.max_elem)
            for _, le in les:
                # _lg.logd(f"Link end  {start_cell}--{le}")
                if le == start_cell:
                    _lg.logr(f"LoopXY",
                             f"all but {val} removed from {set(cd)} w/ loop {'##'}", cs(start_cell))
                    cd.intersection_update((val,))
                joint_nb = wl[start_cell] & wl[le]
                for nb in joint_nb:
                    if val in cands[nb]:
                        _lg.logr(f"ChainXY",
                                 f"{val} removed from {cands[nb]} w/ chain {'##'}", cs(nb))
                        cands[nb].remove(val)


def _find_link_ends_with_num(start_cell: int, end_cells: Union[None, Set[int], FrozenSet[int]],
                             start_num: int, end_nums: Union[None, int, Set[int], FrozenSet[int]],
                             sl: Dict[int, List[Set[Tuple[int, int]]]], wl: List[Set[int]], max_elem: int,
                             start_weak=False, end_weak=False) \
        -> Tuple[List[Tuple[int, int]], Dict, Dict]:
    visited_weak_dic: Dict[int, Dict[int, Optional[int]]] = {val: dict() for val in range(1, max_elem + 1)}
    visited_strong_dic: Dict[int, Dict[int, Optional[int]]] = {val: dict() for val in range(1, max_elem + 1)}
    visited_weak: Dict[int, Set[int]] = {val: set() for val in range(1, max_elem + 1)}
    visited_strong: Dict[int, Set[int]] = {val: set() for val in range(1, max_elem + 1)}

    if start_weak:
        visited_strong_dic[start_num][start_cell] = None
        visited_strong[start_num].add(start_cell)
        todo_weak = deque()
        todo_strong = deque([(start_num, start_cell)])
    else:
        visited_weak_dic[start_num][start_cell] = None
        visited_weak[start_num].add(start_cell)
        todo_strong = deque()
        todo_weak = deque([(start_num, start_cell)])
    results: List[Tuple[int, int]] = []

    while todo_weak or todo_strong:
        if todo_weak:
            num, active = todo_weak.popleft()
            if end_weak and (end_cells is None or active in end_cells) and \
                    (end_nums is None or num == end_nums or (isinstance(end_nums, Iterable) and num in end_nums)) \
                    and visited_weak_dic[num][active] != start_cell:  # length 1 not interesting
                results.append((num, active))
            for val, nb in sl[num][active]:
                if nb in visited_strong[val]:
                    continue

                visited_strong[val].add(nb)
                visited_strong_dic[val][nb] = active
                todo_strong.append((val, nb))
        if todo_strong:
            num, active = todo_strong.popleft()
            if not end_weak and (end_cells is None or active in end_cells) and \
                    (end_nums is None or num == end_nums or (isinstance(end_nums, Iterable) and num in end_nums)) \
                    and visited_strong_dic[num][active] != start_cell:  # length 1 not interesting
                results.append((num, active))
            for nb in wl[active]:
                visited_weak[num].add(nb)
                visited_weak_dic[num][nb] = active
                todo_weak.append((num, nb))

    return results, visited_strong_dic, visited_weak_dic
