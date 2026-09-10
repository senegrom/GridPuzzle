import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.validation import (
    InvalidSolutionError,
    validate_solution,
)
from gridsolver.solver.solver import solve


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


class _NoTwoInFirstCell(ElementsAtMostOnce):
    """Built-in subclass with EXTRA semantics: first cell must not hold 2."""

    def apply(self, known, candidates, guarantees=None):
        candidates[self.cells[0]].discard(2)
        if not candidates[self.cells[0]]:
            from gridsolver.rules.rules import InvalidGrid
            raise InvalidGrid()
        return ElementsAtMostOnce.apply(self, known, candidates, guarantees)


def _source_with(rule_cls, *args):
    grid = Grid(1, 2, max_elem=2)
    rule = rule_cls(grid, *args) if args else rule_cls(grid, cells=[0])
    grid.add_rule_checked(rule)
    return grid


def _solution(values=(1, 1)):
    return ImmutableGrid(values, rows=1, cols=2, max_elem=2)


def test_builtin_subclass_extra_semantics_are_validated():
    # a subclass of a built-in must not be accepted on the parent's closed
    # form alone: (2, 1) is distinct (AMO-satisfying) but violates the
    # subclass's no-2-in-first-cell semantics, which only the apply-based
    # fallback can detect
    grid = Grid(1, 2, max_elem=2)
    grid.add_rule_checked(_NoTwoInFirstCell(grid, cells=[0, 1]))
    validate_solution(grid, _solution((1, 2)))  # parent + subclass both happy
    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(grid, _solution((2, 1)))


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


class _DeepEmission(Rule):
    def __init__(self, grid, depth, reject=False):
        super().__init__(grid, cells=(0,))
        self.depth = depth
        self.reject = reject

    def __hash__(self):
        return hash((super().__hash__(), self.depth, self.reject))

    def __eq__(self, other):
        return super().__eq__(other) and (
            self.depth, self.reject
        ) == (other.depth, other.reject)

    def apply(self, known, candidates, guarantees=None):
        if not self.depth:
            if self.reject:
                candidates[0].clear()
            return False, None, None
        size = GridSizeContainer(self._rows, self._cols, self._max_elem)
        return False, (_DeepEmission(size, self.depth - 1, self.reject),), None


def test_deep_extension_validation_fits_the_output_budget_without_recursion():
    grid = Grid(1, 1, max_elem=1)
    grid[0] = 1
    grid.add_rule_checked(_DeepEmission(grid, 1100))

    assert {tuple(solution) for solution in solve(grid, log_level=-1)} == {(1,)}


@pytest.mark.parametrize("reject, depth, message", (
    (True, 1100, "violates"),
    (False, 2200, "budget|4096-item"),
))
def test_deep_extension_failures_reach_the_leaf_or_budget(reject, depth, message):
    grid = Grid(1, 1, max_elem=1)
    grid.add_rule_checked(_DeepEmission(grid, depth, reject))
    with pytest.raises(InvalidSolutionError, match=message):
        validate_solution(grid, ImmutableGrid((1,), 1, 1, 1))


def test_shared_child_is_rechecked_with_each_siblings_guarantees():
    grid = Grid(1, 2, max_elem=2)
    first_guarantee = Guarantee(1, frozenset({0}), 1, 2)
    second_guarantee = Guarantee(2, frozenset({1}), 1, 2)
    seen = []

    class Child(Rule):
        uses_guarantees = True

        def apply(self, known, candidates, guarantees=None):
            seen.append(tuple(guarantees))
            return False, None, None

    child = Child(grid, cells=(0, 1))

    class Sibling(Rule):
        def __init__(self, guarantee):
            super().__init__(grid, cells=(0, 1))
            self.guarantee = guarantee

        def apply(self, known, candidates, guarantees=None):
            return False, (child,), (self.guarantee,)

    class Root(Rule):
        def apply(self, known, candidates, guarantees=None):
            return False, (Sibling(first_guarantee), Sibling(second_guarantee)), None

    grid.add_rule_checked(Root(grid, cells=(0, 1)))
    validate_solution(grid, _solution((1, 2)))
    assert seen == [(first_guarantee,), (second_guarantee,)]


def test_invalid_first_child_short_circuits_later_siblings():
    grid = Grid(1, 2, max_elem=2)

    class Unreachable(Rule):
        def apply(self, known, candidates, guarantees=None):
            raise RuntimeError("later sibling should not run")

    class Root(Rule):
        def apply(self, known, candidates, guarantees=None):
            return False, (
                ElementsAtMostOnce(grid, cells=(0, 1)),
                Unreachable(grid, cells=(0,)),
            ), None

    grid.add_rule_checked(Root(grid, cells=(0, 1)))
    with pytest.raises(InvalidSolutionError, match="violates"):
        validate_solution(grid, _solution((1, 1)))
