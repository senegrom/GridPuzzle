from array import ArrayType
from collections.abc import Callable, Iterable

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied
from gridsolver.solver.solve_guarantees import filter_guarantees


type PropagationSnapshot = tuple[bytes, int, int, int]

_NO_GUARANTEES: tuple[Guarantee, ...] = ()


def propagation_snapshot(grid: Grid) -> PropagationSnapshot:
    """Return the complete monotone state used for fixpoint detection.

    Known values only become set, candidates only shrink, and inactive rule and
    guarantee sets only grow. Tracking all four components therefore detects
    value, candidate, and structural progress without copying the grid.
    """
    return (
        bytes(grid._known),
        sum(len(candidates) for candidates in grid._candidates),
        len(grid.rules) + len(grid.guarantees),
        len(grid.rules_ia) + len(grid.guarantees_ia),
    )


def _build_guarantee_index(grid: Grid) -> dict[int, list[Guarantee]]:
    index: dict[int, list[Guarantee]] = {}
    for guarantee in grid.guarantees:
        index.setdefault(min(guarantee.cells), []).append(guarantee)
    return index


def relevant_guarantees(grid: Grid, rule: Rule) -> Iterable[Guarantee]:
    """Return an exact superset of guarantees that may affect ``rule``.

    Every current consumer requires a guarantee's cells to be a subset of the
    rule cells. Its minimum cell must therefore occur in the rule, so an index
    by minimum cell avoids scanning every live guarantee for every rule.
    """
    if not rule.uses_guarantees:
        return _NO_GUARANTEES
    index = grid.cached_struct("gts_by_min_cell", lambda: _build_guarantee_index(grid))
    return [guarantee for cell in rule.cells for guarantee in index.get(cell, ())]


def update_known_from_candidates(
    setitem: Callable[[int, int], None],
    candidates: tuple[set[int], ...],
    known: ArrayType,
) -> None:
    for cell, possible in enumerate(candidates):
        if len(possible) == 1 and known[cell] == 0:
            setitem(cell, next(iter(possible)))


def update_candidates_from_known(candidates: tuple[set[int], ...], known: ArrayType) -> None:
    for possible, value in zip(candidates, known):
        if value > 0 and len(possible) > 1:
            possible.intersection_update((value,))


def apply_rules(grid: Grid) -> None:
    """Apply every currently active rule exactly once."""
    known = grid._known
    candidates = grid._candidates

    for rule in list(grid.rules):
        try:
            refresh, new_rules, new_guarantees = rule.apply(
                known,
                candidates,
                relevant_guarantees(grid, rule),
            )
            if refresh:
                update_candidates_from_known(candidates, known)
        except RuleAlwaysSatisfied:
            new_rules = []
            new_guarantees = None
            update_candidates_from_known(candidates, known)

        if new_rules is not None:
            grid.deactivate_rule(rule)
            for new_rule in new_rules:
                grid.add_rule_checked(new_rule)
        if new_guarantees is not None:
            for guarantee in new_guarantees:
                grid.add_gtee_checked(guarantee)


def propagate_once(grid: Grid) -> None:
    """Run one basic propagation pass: singles, rules, then guarantees."""
    update_known_from_candidates(grid.__setitem__, grid._candidates, grid._known)
    apply_rules(grid)
    filter_guarantees(grid)


def propagation_status(grid: Grid) -> SolveStatus:
    if not grid.is_valid:
        return SolveStatus.INVALID
    if grid.is_solved:
        return SolveStatus.SOLVED
    return SolveStatus.NONE


def propagate_basic(grid: Grid) -> SolveStatus:
    """Propagate rules and guarantees to a full fixpoint without power actions."""
    while grid.is_valid:
        before = propagation_snapshot(grid)
        try:
            propagate_once(grid)
        except InvalidGrid:
            return SolveStatus.INVALID
        if propagation_snapshot(grid) == before:
            break
    return propagation_status(grid)
