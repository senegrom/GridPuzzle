from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solve_als import _cell_houses, _full_houses
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def empty_rectangle(grid: Grid) -> None:
    """Empty Rectangle (generalised to untyped houses).

    For a value v and a house B that must contain v (some guarantee for v lies
    inside B), if all v-candidates of B fit inside the union of two other
    houses R and C (and neither alone), then for any conjugate pair {p, q} of v
    with p in R outside B: a cell e in C (outside B, not q) that sees q cannot
    be v — e=v would force q!=v, hence p=v, killing v in R (including R∩B), so
    B's v retreats to C∩B, which e=v also kills, leaving B without v.

    The related 2-string kite / turbot patterns are already covered by the
    untyped skyscraper implementation.
    """
    houses = _full_houses(grid)
    if len(houses) < 3:
        return

    cands = grid._candidates
    known = grid._known
    c = CoordToString(grid.rows)
    sl = grid.semi_strong_links  # cached; do not mutate
    gt_cells_by_val = grid.guarantee_cells_by_value  # cached; do not mutate
    cell_houses = _cell_houses(grid, houses)

    for box in houses:
        for v in range(1, grid.max_elem + 1):
            vb = frozenset(cell for cell in box if known[cell] == 0 and v in cands[cell])
            if len(vb) < 3:
                continue  # degenerate; conjugate-pair techniques handle these
            if not any(gt <= box for gt in gt_cells_by_val[v]):
                continue  # v not guaranteed inside B

            touching = []
            seen_ids = set()
            for cell in vb:
                for h in cell_houses[cell]:
                    if h is not box and id(h) not in seen_ids:
                        seen_ids.add(id(h))
                        touching.append(h)

            sl_v = sl[v]
            for r_house in touching:
                rest = vb - r_house
                if not rest or rest == vb:
                    continue  # R alone covers vb (locked candidate case) or contributes nothing
                for c_house in touching:
                    if c_house is r_house or not rest <= c_house:
                        continue
                    # vb is confined to r_house | c_house, neither alone
                    for p in r_house:
                        if p in box or not sl_v[p]:
                            continue
                        for q in sl_v[p]:
                            if q in box:
                                continue
                            q_houses = cell_houses[q]
                            for e in c_house:
                                if e in box or e == q or known[e] > 0 or v not in cands[e]:
                                    continue
                                if any(e in h for h in q_houses):
                                    _lg.on and _lg.logr(
                                        "EmptyRectangle",
                                        f"{v} removed w/ ER {c(sorted(vb))} pair {c(p)}-{c(q)}",
                                        c(e))
                                    cands[e].discard(v)
                                    if not cands[e]:
                                        raise InvalidGrid()
