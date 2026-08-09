"""Defer rule freezing until a complete batch validates; harden solve input."""

from pathlib import Path
from textwrap import dedent, indent


grid_path = Path("gridsolver/abstract_grids/grid.py")
grid_text = grid_path.read_text(encoding="utf-8")
start = grid_text.index("    def _normalize_rule(")
end = grid_text.index("\n    def add_rule_checked", start)
new_rule_block = indent(
    dedent('''
        def _validate_rule(self, rule: Rule) -> tuple[Rule, tuple[int, ...]]:
            """Validate one rule without hashing, freezing, or changing it."""
            if not isinstance(rule, Rule):
                raise TypeError("Rules must be Rule instances")
            if (rule._rows, rule._cols) != (self.rows, self.cols):
                raise ValueError(
                    f"Rule dimensions {(rule._rows, rule._cols)} do not match "
                    f"grid dimensions {(self.rows, self.cols)}"
                )
            if rule._max_elem != self.max_elem:
                raise ValueError(
                    f"Rule value domain 1..{rule._max_elem} does not match "
                    f"grid value domain 1..{self.max_elem}"
                )

            try:
                raw_cells = tuple(rule.cells)
            except TypeError as exc:
                raise TypeError("Rule cells must be an iterable of integers") from exc
            if not raw_cells:
                raise ValueError("Rule cells must not be empty")

            cells: list[int] = []
            for raw_cell in raw_cells:
                if isinstance(raw_cell, bool) or not isinstance(raw_cell, Integral):
                    raise TypeError("Rule cells must be integers")
                cell = int(raw_cell)
                if not 0 <= cell < self.len:
                    raise ValueError(f"Rule cell {cell} is outside 0..{self.len - 1}")
                cells.append(cell)
            if len(cells) != len(set(cells)):
                raise ValueError("Rule cells must be unique")
            if rule.len_cells != len(cells):
                raise ValueError(
                    f"Rule len_cells={rule.len_cells!r} does not match "
                    f"its {len(cells)} cells"
                )
            return rule, tuple(cells)

        def add_rules_checked(self, rules: Iterable[Rule]) -> None:
            """Validate a complete rule batch, then commit it in one mutation.

            Validation deliberately finishes before canonicalising or hashing any
            rule. Hashing freezes Rule objects, so a malformed later item must not
            make a valid caller-owned prefix immutable when the batch is rejected.
            """
            staged = [self._validate_rule(rule) for rule in rules]

            # Canonicalisation is safe only after every item has validated. The
            # following membership checks hash (and therefore freeze) the rules.
            for rule, canonical_cells in staged:
                if rule.cells != canonical_cells:
                    rule.cells = canonical_cells

            additions: list[Rule] = []
            seen: set[Rule] = set()
            for rule, _ in staged:
                if (
                    rule in seen
                    or rule in self.rules_ia
                    or rule in self.rules
                ):
                    continue
                seen.add(rule)
                additions.append(rule)

            if not additions:
                return
            self.rules.update(additions)
            self._trail_state.dirty.rules.update(additions)
            if self._trail_state.active:
                self._trail_state.entries.extend(
                    ("rule+", rule) for rule in additions
                )
            self._invalidate_struct_cache()
    ''').strip("\n"),
    "    ",
)
grid_path.write_text(
    grid_text[:start] + new_rule_block + grid_text[end:],
    encoding="utf-8",
)


propagation_path = Path("gridsolver/solver/propagation.py")
propagation_text = propagation_path.read_text(encoding="utf-8")
old_preparation = dedent('''
        prepared_rules = (
            None
            if new_rules is None
            else tuple(grid._normalize_rule(new_rule) for new_rule in new_rules)
        )
''').strip("\n")
new_preparation = dedent('''
        prepared_rules = (
            None
            if new_rules is None
            else tuple(
                grid._validate_rule(new_rule)[0]
                for new_rule in new_rules
            )
        )
''').strip("\n")
if propagation_text.count(old_preparation) != 1:
    raise SystemExit("rule-output preparation block changed")
propagation_path.write_text(
    propagation_text.replace(old_preparation, new_preparation, 1),
    encoding="utf-8",
)


solver_path = Path("gridsolver/solver/solver.py")
solver_text = solver_path.read_text(encoding="utf-8")
start = solver_text.index("def solve(\n")
end = solver_text.index("\n\ndef _solve_validated(", start)
new_solve = dedent('''
    def solve(
        grid: Grid,
        log_level: int | None = None,
        max_sols: int = -1,
        processes: int = 0,
    ) -> set[ImmutableGrid]:
        """Solve a grid without mutating it."""
        if not isinstance(grid, Grid):
            raise TypeError("grid must be a Grid instance")
        max_sols, processes = _validate_solve_options(
            max_sols,
            processes,
        )
        with _lg.solve_context(log_level):
            return _solve_validated(grid, max_sols, processes)
''').strip("\n")
solver_path.write_text(
    solver_text[:start] + new_solve + solver_text[end:],
    encoding="utf-8",
)


rule_tests = Path("tests/test_rule_inputs.py")
rule_test_text = rule_tests.read_text(encoding="utf-8")
rule_appendix = '''


def test_failed_rule_batch_does_not_freeze_the_valid_prefix():
    grid = Grid(2)
    valid = ElementsAtMostOnce(grid, cells=[0, 1])
    invalid = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])

    with pytest.raises(ValueError, match="dimensions"):
        grid.add_rules_checked((valid, invalid))

    assert not valid._frozen
    valid.cells = (0, 2)
    assert valid.cells == (0, 2)
'''
if "test_failed_rule_batch_does_not_freeze_the_valid_prefix" in rule_test_text:
    raise SystemExit("rule batch freeze test already exists")
rule_tests.write_text(
    rule_test_text.rstrip() + rule_appendix,
    encoding="utf-8",
)


solver_tests = Path("tests/test_solver_api.py")
solver_test_text = solver_tests.read_text(encoding="utf-8")
if "import pytest\n" not in solver_test_text:
    solver_test_text = solver_test_text.replace(
        "import pickle\n",
        "import pickle\n\nimport pytest\n",
        1,
    )
solver_appendix = '''


@pytest.mark.parametrize("max_sols", (-1, 0))
def test_solve_rejects_non_grid_inputs_even_for_an_empty_result_cap(max_sols):
    with pytest.raises(TypeError, match="grid must be a Grid instance"):
        solver.solve(object(), max_sols=max_sols)
'''
if "test_solve_rejects_non_grid_inputs_even_for_an_empty_result_cap" in solver_test_text:
    raise SystemExit("solve input test already exists")
solver_tests.write_text(
    solver_test_text.rstrip() + solver_appendix,
    encoding="utf-8",
)
