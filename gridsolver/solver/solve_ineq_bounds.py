from typing import Dict, FrozenSet, Set

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import InvalidGrid
from gridsolver.rules.uneq import IneqRule
from gridsolver.solver.logger import CoordToString
from gridsolver.solver.solver_log import lg as _lg


# noinspection PyProtectedMember
def ineq_bounds(grid: Grid) -> None:
    """Transitive inequality bounds for Futoshiki-style puzzles.

    IneqRule.apply propagates one edge per basic step, so plain chains converge
    on their own. This adds the deduction iterated pairwise bounds cannot reach:
    all cells provably below c that are pairwise distinct (they share an
    at-most-once group) carry distinct values, so k of them force c >= k+1.
    The full descending-chain length is folded in as well (one pass instead of
    chain-length basic rounds), and everything dually for upper bounds.
    A cycle in the inequality graph is a contradiction.
    """
    ineqs = grid.get_rules_of_type(IneqRule)
    if not ineqs:
        return

    cands = grid._candidates
    c = CoordToString(grid.rows)
    succ: Dict[int, Set[int]] = {}
    pred: Dict[int, Set[int]] = {}
    for r in ineqs:
        succ.setdefault(r.lt_cell, set()).add(r.gt_cell)
        pred.setdefault(r.gt_cell, set()).add(r.lt_cell)
    nodes = set(succ) | set(pred)

    def closure(edges: Dict[int, Set[int]]) -> Dict[int, FrozenSet[int]]:
        memo: Dict[int, FrozenSet[int]] = {}
        on_path: Set[int] = set()

        def visit(node: int) -> FrozenSet[int]:
            got = memo.get(node)
            if got is not None:
                return got
            if node in on_path:
                cands[node].clear()
                raise InvalidGrid()  # inequality cycle
            on_path.add(node)
            reach: Set[int] = set()
            for nb in edges.get(node, ()):
                reach.add(nb)
                reach.update(visit(nb))
            on_path.discard(node)
            memo[node] = frozenset(reach)
            return memo[node]

        for nd in nodes:
            visit(nd)
        return memo

    below = closure(pred)
    above = closure(succ)

    groups = grid.unique_rule_cells
    cell_groups: Dict[int, list] = {}
    for grp in groups:
        for cell in grp:
            cell_groups.setdefault(cell, []).append(grp)

    def distinct_count(cells: FrozenSet[int]) -> int:
        # cells sharing an at-most-once group are pairwise distinct
        best = 1 if cells else 0
        seen = set()
        for cell in cells:
            for grp in cell_groups.get(cell, ()):
                if id(grp) in seen:
                    continue
                seen.add(id(grp))
                k = len(cells & grp)
                if k > best:
                    best = k
        return best

    def chain_len(edges: Dict[int, Set[int]]) -> Dict[int, int]:
        depth: Dict[int, int] = {}

        def visit(node: int) -> int:
            got = depth.get(node)
            if got is not None:
                return got
            d = 0
            for nb in edges.get(node, ()):
                dn = visit(nb) + 1
                if dn > d:
                    d = dn
            depth[node] = d
            return d

        for nd in nodes:
            visit(nd)
        return depth

    chain_below = chain_len(pred)
    chain_above = chain_len(succ)
    n = grid.max_elem

    for node in nodes:
        low = 1 + max(distinct_count(below[node]), chain_below[node])
        high = n - max(distinct_count(above[node]), chain_above[node])
        cd = cands[node]
        removed = [v for v in cd if v < low or v > high]
        if removed:
            _lg.on and _lg.logr("IneqBounds",
                                f"{removed} removed ({len(below[node])} below, {len(above[node])} above)",
                                c(node))
            cd.difference_update(removed)
            if not cd:
                raise InvalidGrid()
