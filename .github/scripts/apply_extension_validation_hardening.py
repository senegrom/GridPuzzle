"""Harden independent validation for unknown extension rules."""

from pathlib import Path
from textwrap import dedent


Path("gridsolver/solver/validation.py").write_text(
    dedent('''
        from __future__ import annotations

        from collections.abc import Iterable, Sequence
        from dataclasses import dataclass
        from itertools import islice
        from math import prod
        from numbers import Integral

        from gridsolver.abstract_grids.grid import Grid
        from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
        from gridsolver.rules.rules import (
            Guarantee,
            InvalidGrid,
            Rule,
            RuleAlwaysSatisfied,
        )
        from gridsolver.rules.sumrules import (
            DiffRule,
            DivRule,
            ProdRule,
            SumAndElementsAtMostOnce,
            SumRule,
        )
        from gridsolver.rules.uneq import DiffGe2Rule, IneqRule, UneqRule
        from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


        class InvalidSolutionError(RuntimeError):
            """Raised when the solver is about to return a constraint-violating grid."""


        @dataclass(frozen=True, slots=True)
        class _ValidationPlan:
            rows: int
            cols: int
            max_elem: int
            length: int
            domain: frozenset[int]
            known: tuple[int, ...]
            candidates: tuple[frozenset[int], ...]
            rules: tuple[Rule, ...]
            guarantees: tuple[Guarantee, ...]


        @dataclass(slots=True)
        class _FallbackBudget:
            remaining_outputs: int = 4096


        def _canonical_guarantee(
            guarantee: object,
            plan: _ValidationPlan,
        ) -> Guarantee:
            if type(guarantee) is not Guarantee:
                raise TypeError(
                    f"Expected Guarantee output, got {type(guarantee).__name__}"
                )
            if isinstance(guarantee.val, bool) or not isinstance(
                guarantee.val,
                Integral,
            ):
                raise TypeError("Guarantee values must be integers")
            if isinstance(guarantee.rows, bool) or not isinstance(
                guarantee.rows,
                Integral,
            ):
                raise TypeError("Guarantee rows must be an integer")
            if isinstance(guarantee.cols, bool) or not isinstance(
                guarantee.cols,
                Integral,
            ):
                raise TypeError("Guarantee cols must be an integer")

            value = int(guarantee.val)
            rows = int(guarantee.rows)
            cols = int(guarantee.cols)
            if rows != plan.rows or cols != plan.cols:
                raise ValueError(
                    f"Guarantee dimensions {(rows, cols)} do not match "
                    f"{(plan.rows, plan.cols)}"
                )
            if not 1 <= value <= plan.max_elem:
                raise ValueError(
                    f"Guarantee value {value} is outside 1..{plan.max_elem}"
                )
            if isinstance(guarantee.cells, (str, bytes, bytearray)):
                raise TypeError("Guarantee cells must be an iterable of integers")
            try:
                raw_cells = tuple(guarantee.cells)
            except TypeError as exc:
                raise TypeError(
                    "Guarantee cells must be an iterable of integers"
                ) from exc
            if not raw_cells:
                raise ValueError("Guarantee cells must not be empty")

            cells: set[int] = set()
            for raw_cell in raw_cells:
                if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                    raise TypeError("Guarantee cells must be integers")
                cell = int(raw_cell)
                if not 0 <= cell < plan.length:
                    raise ValueError(
                        f"Guarantee cell {cell} is outside 0..{plan.length - 1}"
                    )
                cells.add(cell)
            return Guarantee(value, frozenset(cells), rows, cols)


        def _guarantee_is_satisfied(
            guarantee: object,
            values: Sequence[int],
            plan: _ValidationPlan,
        ) -> bool:
            canonical = _canonical_guarantee(guarantee, plan)
            return any(
                values[cell] == canonical.val
                for cell in canonical.cells
            )


        def _validate_rule_metadata(rule: object, plan: _ValidationPlan) -> Rule:
            if not isinstance(rule, Rule):
                raise TypeError(
                    f"Expected Rule output, got {type(rule).__name__}"
                )
            if (
                rule._rows != plan.rows
                or rule._cols != plan.cols
                or rule._max_elem != plan.max_elem
            ):
                raise ValueError(
                    f"{type(rule).__name__} dimensions or value domain "
                    "do not match the source grid"
                )
            if isinstance(rule.cells, (str, bytes, bytearray)):
                raise TypeError("Rule cells must be an iterable of integers")
            try:
                cells = tuple(rule.cells)
            except TypeError as exc:
                raise TypeError("Rule cells must be an iterable of integers") from exc
            if not cells:
                raise ValueError(f"{type(rule).__name__} cells must not be empty")
            if rule.len_cells != len(cells):
                raise ValueError(
                    f"{type(rule).__name__} len_cells does not match its cells"
                )

            normalized: list[int] = []
            for raw_cell in cells:
                if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                    raise TypeError("Rule cells must be integers")
                cell = int(raw_cell)
                if not 0 <= cell < plan.length:
                    raise ValueError(
                        f"{type(rule).__name__} cell {cell} is outside "
                        f"0..{plan.length - 1}"
                    )
                normalized.append(cell)
            if len(normalized) != len(set(normalized)):
                raise ValueError(f"{type(rule).__name__} cells must be unique")
            return rule


        def _bounded_outputs(
            outputs: Iterable[object] | None,
            label: str,
            budget: _FallbackBudget,
        ) -> tuple[object, ...]:
            if outputs is None:
                return ()
            if isinstance(outputs, (str, bytes, bytearray)):
                raise TypeError(f"{label} must be an iterable, not text")
            try:
                iterator = iter(outputs)
            except TypeError as exc:
                raise TypeError(f"{label} must be an iterable") from exc

            items = tuple(islice(iterator, budget.remaining_outputs + 1))
            if len(items) > budget.remaining_outputs:
                raise ValueError(
                    "Extension rule output exceeds the 4096-item validation limit"
                )
            budget.remaining_outputs -= len(items)
            return items


        def _fallback_state_is_compatible(
            known: Sequence[int],
            candidates: Sequence[set[int]],
            values: Sequence[int],
            plan: _ValidationPlan,
        ) -> bool:
            if tuple(known) != tuple(values):
                return False
            for cell, (selected, possible) in enumerate(zip(values, candidates)):
                if selected not in possible:
                    return False
                for candidate in possible:
                    if isinstance(candidate, bool) or not isinstance(
                        candidate,
                        Integral,
                    ):
                        raise TypeError(
                            f"Custom rule produced a non-integer candidate at cell {cell}"
                        )
                    candidate = int(candidate)
                    if candidate not in plan.domain:
                        raise ValueError(
                            f"Custom rule produced candidate {candidate} outside "
                            f"1..{plan.max_elem} at cell {cell}"
                        )
            return True


        def _rule_is_satisfied(
            rule: Rule,
            values: Sequence[int],
            plan: _ValidationPlan,
            guarantees: tuple[Guarantee, ...],
            *,
            path: frozenset[int] = frozenset(),
            budget: _FallbackBudget | None = None,
        ) -> bool:
            rule = _validate_rule_metadata(rule, plan)
            cell_values = tuple(values[cell] for cell in rule.cells)

            if isinstance(rule, SumAndElementsAtMostOnce):
                return (
                    len(set(cell_values)) == len(cell_values)
                    and sum(cell_values) == rule.sum
                )
            if isinstance(rule, ElementsAtMostOnce):
                return len(set(cell_values)) == len(cell_values)
            if isinstance(rule, ElementsAtLeastOnce):
                return plan.domain <= set(cell_values)
            if isinstance(rule, SumRule):
                return sum(cell_values) == rule.sum
            if isinstance(rule, ProdRule):
                return prod(cell_values) == rule.prod
            if isinstance(rule, DiffRule):
                return abs(cell_values[0] - cell_values[1]) == rule.diff
            if isinstance(rule, DivRule):
                first, second = cell_values
                return first == second * rule.div or second == first * rule.div
            if isinstance(rule, IneqRule):
                return values[rule.lt_cell] < values[rule.gt_cell]
            if isinstance(rule, UneqRule):
                origin = values[rule.origin_cell]
                return all(origin != values[cell] for cell in rule.rel_cells)
            if isinstance(rule, DiffGe2Rule):
                origin = values[rule.origin_cell]
                return all(
                    abs(origin - values[cell]) >= 2
                    for cell in rule.rel_cells
                )

            # Extension fallback: exercise the custom rule against singleton
            # candidates, then validate every structural constraint it emits.
            rule_id = id(rule)
            if rule_id in path:
                return True
            if budget is None:
                budget = _FallbackBudget()
            if budget.remaining_outputs <= 0:
                raise ValueError(
                    "Extension rule validation exhausted its output budget"
                )
            budget.remaining_outputs -= 1

            known = list(values)
            candidates = tuple({value} for value in values)
            raised_satisfied = False
            try:
                result = rule.apply(known, candidates, guarantees)
            except RuleAlwaysSatisfied:
                raised_satisfied = True
                result = None
            except InvalidGrid:
                return False

            if not _fallback_state_is_compatible(
                known,
                candidates,
                values,
                plan,
            ):
                return False
            if raised_satisfied:
                return True
            if not isinstance(result, tuple) or len(result) != 3:
                raise TypeError(
                    f"{type(rule).__name__}.apply() must return a three-item tuple"
                )
            changed, raw_rules, raw_guarantees = result
            if not isinstance(changed, bool):
                raise TypeError(
                    f"{type(rule).__name__}.apply() changed flag must be boolean"
                )

            emitted_guarantees = tuple(
                _canonical_guarantee(item, plan)
                for item in _bounded_outputs(
                    raw_guarantees,
                    "Emitted guarantees",
                    budget,
                )
            )
            if any(
                not _guarantee_is_satisfied(guarantee, values, plan)
                for guarantee in emitted_guarantees
            ):
                return False

            next_guarantees = guarantees + emitted_guarantees
            next_path = path | {rule_id}
            for emitted_rule in _bounded_outputs(
                raw_rules,
                "Emitted rules",
                budget,
            ):
                if not _rule_is_satisfied(
                    emitted_rule,
                    values,
                    plan,
                    next_guarantees,
                    path=next_path,
                    budget=budget,
                ):
                    return False
            return True


        def _build_validation_plan(source: Grid) -> _ValidationPlan:
            rules = tuple(source.rules) + tuple(source.rules_ia)
            raw_guarantees = tuple(source.guarantees) + tuple(source.guarantees_ia)
            partial = _ValidationPlan(
                rows=source.rows,
                cols=source.cols,
                max_elem=source.max_elem,
                length=len(source),
                domain=frozenset(range(1, source.max_elem + 1)),
                known=tuple(source._known),
                candidates=tuple(
                    frozenset(possible)
                    for possible in source._candidates
                ),
                rules=rules,
                guarantees=(),
            )
            guarantees = tuple(
                _canonical_guarantee(guarantee, partial)
                for guarantee in raw_guarantees
            )
            return _ValidationPlan(
                rows=partial.rows,
                cols=partial.cols,
                max_elem=partial.max_elem,
                length=partial.length,
                domain=partial.domain,
                known=partial.known,
                candidates=partial.candidates,
                rules=partial.rules,
                guarantees=guarantees,
            )


        def _validate_against_plan(
            plan: _ValidationPlan,
            solution: ImmutableGrid,
        ) -> None:
            if (
                solution.rows != plan.rows
                or solution.cols != plan.cols
                or solution.max_elem != plan.max_elem
                or len(solution) != plan.length
            ):
                raise InvalidSolutionError(
                    "Solution shape or value domain differs from the source grid"
                )

            values = tuple(solution)
            for cell, value in enumerate(values):
                if value not in plan.domain:
                    raise InvalidSolutionError(
                        f"Solution value {value} at cell {cell} is outside "
                        f"1..{plan.max_elem}"
                    )
                known = plan.known[cell]
                if known and value != known:
                    raise InvalidSolutionError(
                        f"Solution changes given cell {cell} from {known} to {value}"
                    )
                if value not in plan.candidates[cell]:
                    raise InvalidSolutionError(
                        f"Solution uses eliminated candidate {value} at cell {cell}"
                    )

            for guarantee in plan.guarantees:
                if not _guarantee_is_satisfied(guarantee, values, plan):
                    raise InvalidSolutionError(
                        f"Solution violates guarantee {guarantee.val} in "
                        f"{sorted(guarantee.cells)}"
                    )

            for rule in plan.rules:
                try:
                    satisfied = _rule_is_satisfied(
                        rule,
                        values,
                        plan,
                        plan.guarantees,
                    )
                except InvalidSolutionError:
                    raise
                except Exception as exc:
                    raise InvalidSolutionError(
                        f"Cannot validate {type(rule).__name__}: {exc}"
                    ) from exc
                if not satisfied:
                    raise InvalidSolutionError(
                        f"Solution violates {type(rule).__name__}: {rule!r}"
                    )


        def validate_solution(source: Grid, solution: ImmutableGrid) -> None:
            """Validate a completed grid against the caller's entire puzzle state."""
            _validate_against_plan(_build_validation_plan(source), solution)


        def validate_solutions(
            source: Grid,
            solutions: set[ImmutableGrid],
        ) -> None:
            plan = _build_validation_plan(source)
            for solution in solutions:
                _validate_against_plan(plan, solution)
    ''').lstrip(),
    encoding="utf-8",
)

Path("tests/test_extension_validation.py").write_text(
    dedent('''
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
    ''').lstrip(),
    encoding="utf-8",
)
