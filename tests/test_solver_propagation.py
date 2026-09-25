"""Event-driven propagation and the trial techniques built on it.

Candidate and guarantee changes wake only the rules and guarantees watching
them; trial propagation reaches a fixpoint on candidate-only progress;
InvalidGrid is authoritative in the atomic solver and Nishio; the
forcing-chain guard is context-local; XY-chain pruning survives ruleless
guarantee links.
"""

from contextvars import Context

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solve_forcing_chain as forcing_chain_module, solve_guarantees as guarantee_module
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import apply_rules, propagate_basic, relevant_guarantees
from gridsolver.solver.rulehelpers import rulehelper_atmostonce
from gridsolver.solver.solve_nishio import nishio


class _CountingRule(Rule):
    __slots__ = ()
    calls: list[tuple[int, ...]] = []

    def apply(self, known, candidates, guarantees=None):
        type(self).calls.append(self.cells)
        return False, None, None


class _GuaranteeCountingRule(_CountingRule):
    __slots__ = ()
    uses_guarantees = True


def test_relevant_guarantees_track_guarantee_changes():
    # the min-cell index is cached with the guarantee lifecycle; the per-rule
    # result is built fresh (a per-rule cache measured 55-80% miss), so the
    # contract is content-tracking plus a re-iterable result, not identity
    grid = Grid(2)
    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(rule)
    grid.add_gtee_checked(
        Guarantee(1, frozenset({0, 1}), 2, 2)
    )

    first = relevant_guarantees(grid, rule)
    assert {guarantee.val for guarantee in first} == {1}
    assert list(first) == list(first)  # re-iterable (SaEAMO reads it twice)

    grid.add_gtee_checked(
        Guarantee(2, frozenset({0, 1}), 2, 2)
    )
    refreshed = relevant_guarantees(grid, rule)
    assert {guarantee.val for guarantee in refreshed} == {1, 2}


def test_rulehelper_atmostonce_reaches_a_stable_merged_structure():
    grid = Sudoku(2, 2, 2, 2)
    grid.add_rule_checked(UneqRule(grid, 0, [15]))

    rulehelper_atmostonce(grid)
    origin_zero = [
        rule
        for rule in grid.get_rules_of_type(UneqRule)
        if rule.origin_cell == 0
    ]
    assert len(origin_zero) == 1
    assert 15 in origin_zero[0].rel_cells

    sentinel = grid.cached_struct("sentinel", object)
    cache = grid._struct_cache
    rules = grid.rules.copy()
    rulehelper_atmostonce(grid)

    assert grid.rules == rules
    assert grid._struct_cache is cache
    assert grid._struct_cache["sentinel"] is sentinel


def test_candidate_changes_only_wake_rules_watching_that_cell():
    grid = Grid(1, 4, max_elem=3)
    first = _CountingRule(grid, cells=[0, 1])
    second = _CountingRule(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))

    _CountingRule.calls = []
    apply_rules(grid)
    assert set(_CountingRule.calls) == {first.cells, second.cells}

    _CountingRule.calls = []
    grid._candidates[0].discard(3)
    apply_rules(grid)

    assert _CountingRule.calls == [first.cells]


def test_new_guarantee_only_wakes_relevant_guarantee_consumers():
    grid = Grid(1, 4, max_elem=3)
    first = _GuaranteeCountingRule(grid, cells=[0, 1])
    second = _GuaranteeCountingRule(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))
    apply_rules(grid)

    _GuaranteeCountingRule.calls = []
    grid.add_gtee_checked(Guarantee(1, frozenset({0}), 1, 4))
    apply_rules(grid)

    assert _GuaranteeCountingRule.calls == [first.cells]


def test_candidate_changes_only_wake_guarantees_watching_that_cell(monkeypatch):
    grid = Grid(1, 4, max_elem=3)
    first = Guarantee(1, frozenset({0, 1}), 1, 4)
    second = Guarantee(2, frozenset({2, 3}), 1, 4)
    grid.add_gtees_checked((first, second))
    guarantee_module.filter_guarantees(grid)

    calls = []
    monkeypatch.setattr(
        guarantee_module,
        "update_from_guarantee",
        lambda _grid, guarantee: calls.append(guarantee),
    )
    grid._candidates[0].discard(3)
    guarantee_module.filter_guarantees(grid)

    assert calls == [first]


class _PeelOneCandidatePerPass(Rule):
    """Synthetic monotone rule whose fixpoint requires several passes."""

    def apply(self, known, candidates, guarantees=None):
        cell_candidates = candidates[self.cells[0]]
        if len(cell_candidates) > 1:
            cell_candidates.remove(max(cell_candidates))
        return False, None, None


class _RejectValueWithoutMutating(Rule):
    """Report a contradiction without relying on an emptied candidate set."""

    def __init__(self, grid, cell, rejected):
        super().__init__(grid, cells=[cell])
        self.rejected = rejected

    def apply(self, known, candidates, guarantees=None):
        if known[self.cells[0]] == self.rejected:
            raise InvalidGrid()
        return False, None, None

    def __hash__(self):
        return hash((super().__hash__(), self.rejected))

    def __eq__(self, other):
        return super().__eq__(other) and self.rejected == other.rejected


def test_basic_trial_propagation_tracks_candidate_only_progress():
    grid = Grid(1, 1, max_elem=4)
    grid.add_rule_checked(_PeelOneCandidatePerPass(grid, cells=[0]))

    assert propagate_basic(grid) == SolveStatus.SOLVED
    assert grid[0] == 1
    assert grid.get_candidates(0) == {1}


def test_atomic_solver_uses_invalid_exception_without_candidate_mutation():
    grid = Grid(1, 1, max_elem=2)
    grid.add_rule_checked(_RejectValueWithoutMutating(grid, cell=0, rejected=2))
    grid[0] = 2

    assert AtomicSolver(grid, [], set()).solve_atomic() == SolveStatus.INVALID
    assert grid.is_valid


def test_nishio_uses_the_returned_invalid_status():
    grid = Grid(1, 1, max_elem=2)
    grid.add_rule_checked(_RejectValueWithoutMutating(grid, cell=0, rejected=2))

    nishio(grid)
    assert grid.get_candidates(0) == {1}


def test_forcing_chain_guard_is_context_local():
    flag = forcing_chain_module._in_forcing_chain
    token = flag.set(True)
    try:
        assert bool(flag)
        assert Context().run(bool, flag) is False
    finally:
        flag.reset(token)
    assert not flag


def test_xy_chain_semi_strong_prune_survives_ruleless_guarantee_links():
    # regression: the prune passed a generator over `link` into
    # link.difference_update, raising RuntimeError the moment any entry
    # matched (reachable only when a linked cell has no weak links at all)
    from gridsolver.rules.rules import Guarantee
    from gridsolver.solver.solve_chain import xy_chain

    grid = Grid(2, 2, max_elem=2)
    grid.add_gtee_checked(Guarantee(1, frozenset({0, 1}), 2, 2))

    xy_chain(grid)  # must not raise

    assert all(candidates == {1, 2} for candidates in grid._candidates)
