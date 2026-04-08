import itertools
from typing import List, FrozenSet

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def aligned_pair_exclusion(grid: Grid) -> None:
    """Aligned Pair Exclusion technique.

    For two unsolved cells that share both a box and a line (row or column),
    enumerate all candidate combinations. A combination (v1, v2) is invalid if
    there exists a "witness" cell that:
    - sees both cells (shares a house with both)
    - has exactly the candidates {v1, v2}
    Because placing v1 and v2 in the pair would eliminate all candidates from
    the witness.

    If every combination containing digit D for cell X is invalid, remove D from X.
    """
    all_houses: List[FrozenSet[int]] = [
        grp for grp in grid.unique_rule_cells if len(grp) == grid.max_elem
    ]
    if len(all_houses) < 2:
        return

    c = CoordToString(grid.rows)
    cands = grid._candidates
    known = grid._known

    # Find all pairs of unsolved cells that share at least 2 houses
    # (a box + a row, or a box + a col)
    cell_houses: dict[int, list[FrozenSet[int]]] = {}
    for cell in range(grid.len):
        if known[cell] == 0 and len(cands[cell]) >= 2:
            cell_houses[cell] = [h for h in all_houses if cell in h]

    pairs_checked = set()

    for cell1, houses1 in cell_houses.items():
        for cell2, houses2 in cell_houses.items():
            if cell1 >= cell2:
                continue
            pair = (cell1, cell2)
            if pair in pairs_checked:
                continue
            pairs_checked.add(pair)

            # Must share at least 2 houses
            shared_houses = [h for h in houses1 if h in houses2]
            if len(shared_houses) < 2:
                continue

            # Find all cells that see both cell1 and cell2 (share a house with each)
            # and have exactly 2 candidates
            witnesses: list[tuple[int, frozenset]] = []
            # Cells that see cell1
            sees1 = set()
            for h in houses1:
                sees1.update(h)
            sees1.discard(cell1)
            # Cells that see cell2
            sees2 = set()
            for h in houses2:
                sees2.update(h)
            sees2.discard(cell2)
            sees_both = sees1 & sees2 - {cell1, cell2}

            for w in sees_both:
                if known[w] == 0 and len(cands[w]) == 2:
                    witnesses.append((w, frozenset(cands[w])))

            if not witnesses:
                continue

            # Enumerate all (v1, v2) combinations
            cands1 = cands[cell1]
            cands2 = cands[cell2]
            valid_combos: set[tuple[int, int]] = set()

            for v1 in cands1:
                for v2 in cands2:
                    # Check if this combo is invalidated by any witness
                    combo_valid = True
                    for w_cell, w_cands in witnesses:
                        if w_cands == {v1, v2}:
                            # Witness would lose all candidates
                            combo_valid = False
                            break
                        # Also invalid if witness sees cell1 in same house and v1 would
                        # eliminate, AND sees cell2 in same house and v2 would eliminate
                        # Actually the simpler check: if {v1,v2} is a superset of w_cands,
                        # the witness is emptied
                        if w_cands <= {v1, v2}:
                            combo_valid = False
                            break
                    if combo_valid:
                        valid_combos.add((v1, v2))

            # For each cell, check if any candidate appears in NO valid combo
            for v1 in list(cands1):
                if not any(combo[0] == v1 for combo in valid_combos):
                    _lg.logr("AlignedPair",
                             f"{v1} removed (no valid combo) w/ pair {c(cell1)},{c(cell2)}",
                             c(cell1))
                    cands[cell1].discard(v1)
                    if not cands[cell1]:
                        raise InvalidGrid()

            for v2 in list(cands2):
                if not any(combo[1] == v2 for combo in valid_combos):
                    _lg.logr("AlignedPair",
                             f"{v2} removed (no valid combo) w/ pair {c(cell1)},{c(cell2)}",
                             c(cell2))
                    cands[cell2].discard(v2)
                    if not cands[cell2]:
                        raise InvalidGrid()
