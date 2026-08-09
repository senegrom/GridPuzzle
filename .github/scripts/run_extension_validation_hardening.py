"""Apply extension validation hardening, then align guarantee semantics."""

from pathlib import Path


script = Path(".github/scripts/apply_extension_validation_hardening.py")
exec(compile(script.read_text(encoding="utf-8"), str(script), "exec"), {})

path = Path("gridsolver/solver/validation.py")
text = path.read_text(encoding="utf-8")

marker = "def _rule_is_satisfied(\n"
helper = '''def _relevant_guarantees_for_rule(
    rule: Rule,
    guarantees: tuple[Guarantee, ...],
) -> tuple[Guarantee, ...]:
    """Mirror propagation.relevant_guarantees for a validation snapshot."""
    if not rule.uses_guarantees:
        return ()
    rule_cells = frozenset(rule.cells)
    return tuple(
        guarantee
        for guarantee in guarantees
        if min(guarantee.cells) in rule_cells
    )


'''
if text.count(marker) != 1:
    raise SystemExit("Validation rule marker changed")
text = text.replace(marker, helper + marker, 1)

old_apply = "            result = rule.apply(known, candidates, guarantees)\n"
new_apply = '''            result = rule.apply(
                known,
                candidates,
                _relevant_guarantees_for_rule(rule, guarantees),
            )
'''
if text.count(old_apply) != 1:
    raise SystemExit("Validation custom apply marker changed")
text = text.replace(old_apply, new_apply, 1)

old_guarantees = '''    guarantees = tuple(
        _canonical_guarantee(guarantee, partial)
        for guarantee in raw_guarantees
    )
'''
new_guarantees = '''    canonical_guarantees: list[Guarantee] = []
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
'''
if text.count(old_guarantees) != 1:
    raise SystemExit("Validation source guarantee marker changed")
text = text.replace(old_guarantees, new_guarantees, 1)
path.write_text(text, encoding="utf-8")
