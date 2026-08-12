from array import ArrayType
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule, RuleAlwaysSatisfied
from gridsolver.solver.solve_guarantees import filter_guarantees
from gridsolver.solver.solver_log import lg as _lg


type PropagationSnapshot = tuple[bytes, int, int, int]


@dataclass(slots=True)
class BranchConsensus:
    """Aggregate deductions shared by every observed valid branch."""

    branch_count: int = 0
    common_known: list[int] = field(default_factory=list)
    candidate_union: list[set[int]] = field(default_factory=list)

    def observe(self, grid: Grid) -> None:
        """Merge one valid branch without retaining its full grid state."""
        if self.branch_count == 0:
            self.common_known.extend(grid._known)
            self.candidate_union.extend(
                set(possible) for possible in grid._candidates
            )
        else:
            for cell, value in enumerate(grid._known):
                if self.common_known[cell] != value:
                    self.common_known[cell] = 0
            for seen, possible in zip(
                self.candidate_union,
                grid._candidates,
            ):
                seen.update(possible)
        self.branch_count += 1

    def forced_value(self, cell: int) -> int:
        if self.branch_count == 0:
            return 0
        return self.common_known[cell]

    def common_eliminations(
        self,
        cell: int,
        possible: set[int],
    ) -> set[int]:
        if self.branch_count == 0:
            return set()
        return possible - self.candidate_union[cell]


# noinspection PyProtectedMember
def apply_consensus(
    grid: Grid,
    consensus: BranchConsensus,
    skip_cells: frozenset[int],
    label: str,
    source: str,
    coord,
) -> bool:
    """Apply forced values and eliminations shared by every valid branch."""
    candidates = grid._candidates
    known = grid._known
    made_progress = False

    for cell in range(grid.len):
        if cell in skip_cells or known[cell] > 0:
            continue
        forced_value = consensus.forced_value(cell)
        if forced_value <= 0:
            continue
        _lg.on and _lg.logr(
            label,
            f"all {consensus.branch_count} branches force "
            f"{coord(cell)}={forced_value} from {source}",
            coord(cell),
        )
        candidates[cell].intersection_update((forced_value,))
        if not candidates[cell]:
            raise InvalidGrid()
        made_progress = True

    for cell in range(grid.len):
        if (
            cell in skip_cells
            or known[cell] > 0
            or len(candidates[cell]) <= 1
        ):
            continue
        common_eliminations = consensus.common_eliminations(
            cell,
            candidates[cell],
        )
        for value in sorted(common_eliminations):
            _lg.on and _lg.logr(
                label,
                f"{value} removed from {coord(cell)} "
                f"(all {consensus.branch_count} branches from {source} eliminate)",
                coord(cell),
            )
            candidates[cell].discard(value)
            if not candidates[cell]:
                raise InvalidGrid()
            made_progress = True

    return made_progress


_NO_GUARANTEES: tuple[Guarantee, ...] = ()


def propagation_snapshot(grid: Grid) -> PropagationSnapshot:
    """Return the complete monotone state used for fixpoint detection."""
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
    """Return the guarantee superset that may affect ``rule``.

    Relevance depends only on the rule cells and live guarantee set. The
    min-cell index is cached with the guarantee-only lifecycle and
    amortizes well; a per-rule result cache was measured at 55-80% miss
    (every guarantee change drops it), so the small bucket walk is done
    fresh instead of cached. The list is safely re-iterable (SaEAMO reads
    it twice).
    """
    if not rule.uses_guarantees:
        return _NO_GUARANTEES
    index = grid.cached_guarantee_struct(
        "gts_by_min_cell",
        lambda: _build_guarantee_index(grid),
    )
    return [
        guarantee
        for cell in rule.cells
        for guarantee in index.get(cell, ())
    ]

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

    for rule in grid.take_dirty_rules():
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

        # Rule implementations may return generators. Materialise and validate both
        # outputs before deactivating the source rule or changing either live set.
        prepared_rules = (
            None
            if new_rules is None
            else tuple(
                grid._validate_rule(new_rule)[0]
                for new_rule in new_rules
            )
        )
        prepared_guarantees = (
            None
            if new_guarantees is None
            else grid._normalize_guarantees(new_guarantees)
        )

        if prepared_rules is not None:
            grid.deactivate_rule(rule)
            grid.add_rules_checked(prepared_rules)
        if prepared_guarantees is not None:
            grid._add_normalized_gtees(prepared_guarantees)


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
