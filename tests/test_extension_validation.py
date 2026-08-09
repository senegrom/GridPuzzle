import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.validation import (
    InvalidSolutionError,
    validate_solution,
)


class _ReplaceSelectedCandidate(Rule):
    def apply(self, known, candidates, guarantees=None):
        candidates[self.cells[0]].clear()
        candidates[self.cells[0]].add(2)
        return False, None, None


class _MutateKnown(Rule):
    def apply(self, known, candidates, guarantees=None):
        known[self.cells[0]] = 2
        return False, None, None


class _EmitRule(Rule):
    def __init__(self, grid, emitted):
        super().__init__(grid, cells=[0])
        self.emitted = emitted

    def apply(self, known, candidates, guarantees=None):
        return False, [self.emitted], None

    def __hash__(self):
        return hash((super().__hash__(), self.emitted))

    def __eq__(self, other):
        return super().__eq__(other) and self.emitted == other.emitted


class _EmitGuarantee(Rule):
    def __init__(self, grid, guarantee):
        super().__init__(grid, cells=[0])
        self.guarantee = guarantee

    def apply(self, known, candidates, guarantees=None):
        return False, None, [self.guarantee]

    def __hash__(self):
        return hash((super().__hash__(), self.guarantee))

    def __eq__(self, other):
        return super().__eq__(other) and self.guarantee == other.guarantee


class _SelfEmittingRule(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, [self], None


class _MalformedOutputRule(Rule):
    def apply(self, known, candidates, guarantees=None):
        return None


class _InvalidCandidateValue(Rule):
    def apply(self, known, candidates, guarantees=None):
        candidates[self.cells[0]].add(99)
        return False, None, None


def _source_with(rule_cls, *args):
    grid = Grid(1, 2, max_elem=2)
    rule = rule_cls(grid, *args) if args else rule_cls(grid, cells=[0])
    grid.add_rule_checked(rule)
    return grid


def _solution(values=(1, 1)):
    return ImmutableGrid(values, rows=1, cols=2, max_elem=2)


def test_custom_rule_must_preserve_the_selected_candidate():
    source = _source_with(_ReplaceSelectedCandidate)
    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(source, _solution())


def test_custom_rule_must_not_change_completed_known_values():
    source = _source_with(_MutateKnown)
    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(source, _solution())


def test_custom_rule_emitted_rules_are_validated_recursively():
    grid = Grid(1, 2, max_elem=2)
    emitted = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(_EmitRule(grid, emitted))

    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(grid, _solution())

    validate_solution(grid, _solution((1, 2)))


def test_custom_rule_emitted_guarantees_are_validated():
    grid = Grid(1, 2, max_elem=2)
    violated = Guarantee(2, frozenset({0}), 1, 2)
    grid.add_rule_checked(_EmitGuarantee(grid, violated))

    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(grid, _solution())

    validate_solution(grid, _solution((2, 1)))


def test_self_emitted_rule_cycle_terminates():
    source = _source_with(_SelfEmittingRule)
    validate_solution(source, _solution())


def test_malformed_custom_output_is_reported_as_validation_failure():
    source = _source_with(_MalformedOutputRule)
    with pytest.raises(
        InvalidSolutionError,
        match="three-item tuple",
    ):
        validate_solution(source, _solution())


def test_custom_rule_cannot_emit_out_of_domain_candidates():
    source = _source_with(_InvalidCandidateValue)
    with pytest.raises(
        InvalidSolutionError,
        match="outside 1..2",
    ):
        validate_solution(source, _solution())


def test_emitted_constraint_metadata_must_match_source_grid():
    grid = Grid(1, 2, max_elem=2)
    incompatible = ElementsAtMostOnce(Grid(2), cells=[0, 1])
    grid.add_rule_checked(_EmitRule(grid, incompatible))

    with pytest.raises(
        InvalidSolutionError,
        match="dimensions or value domain",
    ):
        validate_solution(grid, _solution())


class _CaptureGuarantees(Rule):
    uses_guarantees = True

    def __init__(self, grid, seen):
        super().__init__(grid, cells=[0])
        self.seen = seen

    def apply(self, known, candidates, guarantees=None):
        self.seen.append(tuple(guarantees or ()))
        return False, None, None


def test_custom_rule_receives_only_active_relevant_guarantees():
    grid = Grid(1, 2, max_elem=2)
    seen = []
    grid.add_rule_checked(_CaptureGuarantees(grid, seen))

    active = Guarantee(1, frozenset({0}), 1, 2)
    inactive = Guarantee(2, frozenset({0, 1}), 1, 2)
    irrelevant = Guarantee(2, frozenset({1}), 1, 2)
    grid.add_gtees_checked((active, inactive, irrelevant))
    grid.deactivate_gtee(inactive)

    validate_solution(grid, _solution((1, 2)))

    assert seen == [(active,)]


def test_source_rule_metadata_is_wrapped_as_invalid_solution():
    grid = Grid(1, 2, max_elem=2)
    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    rule.cells = (0, 2)
    rule.len_cells = 2
    # Deliberately bypass the checked registration API to model corrupted
    # extension state without freezing the invalid rule in a set.
    grid.rules = [rule]

    with pytest.raises(InvalidSolutionError, match="Malformed rule"):
        validate_solution(grid, _solution((1, 2)))
