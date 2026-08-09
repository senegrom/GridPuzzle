"""Use active guarantees for custom rules and prevalidate source metadata once."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(
            f"{path}: expected one marker, found {text.count(old)}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("gridsolver/solver/validation.py")
replace_once(
    path,
    '''    rules: tuple[Rule, ...]
    guarantees: tuple[Guarantee, ...]
''',
    '''    rules: tuple[Rule, ...]
    guarantees: tuple[Guarantee, ...]
    active_guarantees: tuple[Guarantee, ...]
''',
)
replace_once(
    path,
    '''def _guarantee_is_satisfied(
    guarantee: object,
    values: Sequence[int],
    plan: _ValidationPlan,
) -> bool:
    canonical = _canonical_guarantee(guarantee, plan)
    return any(
        values[cell] == canonical.val
        for cell in canonical.cells
    )
''',
    '''def _canonical_guarantee_is_satisfied(
    guarantee: Guarantee,
    values: Sequence[int],
) -> bool:
    return any(
        values[cell] == guarantee.val
        for cell in guarantee.cells
    )


def _guarantee_is_satisfied(
    guarantee: object,
    values: Sequence[int],
    plan: _ValidationPlan,
) -> bool:
    return _canonical_guarantee_is_satisfied(
        _canonical_guarantee(guarantee, plan),
        values,
    )
''',
)
replace_once(
    path,
    '''    path: frozenset[int] = frozenset(),
    budget: _FallbackBudget | None = None,
) -> bool:
    rule = _validate_rule_metadata(rule, plan)
    cell_values = tuple(values[cell] for cell in rule.cells)
''',
    '''    path: frozenset[int] = frozenset(),
    budget: _FallbackBudget | None = None,
    metadata_validated: bool = False,
) -> bool:
    if not metadata_validated:
        rule = _validate_rule_metadata(rule, plan)
    cell_values = tuple(values[cell] for cell in rule.cells)
''',
)
replace_once(
    path,
    '''    if any(
        not _guarantee_is_satisfied(guarantee, values, plan)
        for guarantee in emitted_guarantees
    ):
''',
    '''    if any(
        not _canonical_guarantee_is_satisfied(guarantee, values)
        for guarantee in emitted_guarantees
    ):
''',
)
old_build = '''def _build_validation_plan(source: Grid) -> _ValidationPlan:
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
    canonical_guarantees: list[Guarantee] = []
    for guarantee in raw_guarantees:
        try:
            canonical_guarantees.append(
                _canonical_guarantee(guarantee, partial)
            )
        except (TypeError, ValueError) as exc:
            raise InvalidSolutionError(
                f"Malformed guarantee in source grid: {guarantee!r}: {exc}"
            ) from exc
    guarantees = tuple(canonical_guarantees)
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
'''
new_build = '''def _build_validation_plan(source: Grid) -> _ValidationPlan:
    raw_rules = tuple(source.rules) + tuple(source.rules_ia)
    raw_active_guarantees = tuple(source.guarantees)
    raw_inactive_guarantees = tuple(source.guarantees_ia)
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
        rules=(),
        guarantees=(),
        active_guarantees=(),
    )

    validated_rules: list[Rule] = []
    for rule in raw_rules:
        try:
            validated_rules.append(_validate_rule_metadata(rule, partial))
        except (TypeError, ValueError) as exc:
            raise InvalidSolutionError(
                f"Malformed rule in source grid: {rule!r}: {exc}"
            ) from exc

    def canonicalize_guarantees(
        raw_guarantees: tuple[Guarantee, ...],
    ) -> tuple[Guarantee, ...]:
        canonical: list[Guarantee] = []
        for guarantee in raw_guarantees:
            try:
                canonical.append(_canonical_guarantee(guarantee, partial))
            except (TypeError, ValueError) as exc:
                raise InvalidSolutionError(
                    f"Malformed guarantee in source grid: {guarantee!r}: {exc}"
                ) from exc
        return tuple(canonical)

    active_guarantees = canonicalize_guarantees(raw_active_guarantees)
    inactive_guarantees = canonicalize_guarantees(raw_inactive_guarantees)
    return _ValidationPlan(
        rows=partial.rows,
        cols=partial.cols,
        max_elem=partial.max_elem,
        length=partial.length,
        domain=partial.domain,
        known=partial.known,
        candidates=partial.candidates,
        rules=tuple(validated_rules),
        guarantees=active_guarantees + inactive_guarantees,
        active_guarantees=active_guarantees,
    )
'''
replace_once(path, old_build, new_build)
replace_once(
    path,
    '''    for guarantee in plan.guarantees:
        if not _guarantee_is_satisfied(guarantee, values, plan):
''',
    '''    for guarantee in plan.guarantees:
        if not _canonical_guarantee_is_satisfied(guarantee, values):
''',
)
replace_once(
    path,
    '''                plan,
                plan.guarantees,
            )
''',
    '''                plan,
                plan.active_guarantees,
                metadata_validated=True,
            )
''',
)


tests = Path("tests/test_extension_validation.py")
test_text = tests.read_text(encoding="utf-8")
appendix = '''


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
'''
if "test_custom_rule_receives_only_active_relevant_guarantees" in test_text:
    raise SystemExit("Validation-plan refinement tests already exist")
tests.write_text(test_text.rstrip() + appendix, encoding="utf-8")
