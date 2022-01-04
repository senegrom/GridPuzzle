import itertools

from gridsolver.abstract_grids.grid import Grid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# todo endo fins


def xy_wing(grid: Grid) -> None:
    uneq_rules = grid.uneq_rule_pairs
    if not uneq_rules:
        return

    cs = CoordToString(grid.rows)
    cd2_cells = grid.get_cells_with_candidate_length(2)

    links1 = {c: {i: {c2 for c2, cd2 in cd2_cells if cd2 == {min(cd), i} and c2 in uneq_rules[c]} for i in
                  range(1, grid.max_elem + 1)} for c, cd in cd2_cells}
    links2 = {c: {i: {c2 for c2, cd2 in cd2_cells if cd2 == {max(cd), i} and c2 in uneq_rules[c]} for i in
                  range(1, grid.max_elem + 1)} for c, cd in cd2_cells}

    for c, _ in cd2_cells:
        for i in range(1, grid.max_elem + 1):
            for l1 in links1[c][i]:
                for l2 in links2[c][i]:
                    seeing_both = uneq_rules[l1] & uneq_rules[l2] - {c}
                    for x in seeing_both:
                        cdt = grid.get_candidates(x)
                        if i in cdt:
                            _lg.logr(f"WingXY",
                                     f"{i} removed from {cdt} w/ " +
                                     f"{cs(c)}, pincers {cs(l1)}, {cs(l2)}", cs(x))
                            cdt.remove(i)


def xyz_wing(grid: Grid) -> None:
    uneq_rules = grid.uneq_rule_pairs
    if not uneq_rules:
        return

    cs = CoordToString(grid.rows)
    cd2_cells = grid.get_cells_with_candidate_length(2)
    cd3_cells = grid.get_cells_with_candidate_length(3)

    for c, cd in cd3_cells:
        links = {
            frozenset([x1, x2]): {c2 for c2, cd2 in cd2_cells if cd2 == {x1, x2} and c2 in uneq_rules[c]}
            for x1, x2 in itertools.combinations(cd, 2)}

        for (a, a_cells), (b, b_cells) in itertools.combinations(links.items(), 2):
            i = next(iter(a & b))
            for l1 in a_cells:
                for l2 in b_cells:
                    seeing_three = uneq_rules[l1] & uneq_rules[l2] & uneq_rules[c] - {c}
                    for x in seeing_three:
                        cdt = grid.get_candidates(x)
                        if i in cdt:
                            _lg.logr(f"WingXYZ",
                                     f"{i} removed from {cdt} w/ " +
                                     f"{cs(c)}, pincers {cs(l1)}, {cs(l2)}", cs(x))
                            cdt.remove(i)
