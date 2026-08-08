from pathlib import Path
from textwrap import dedent, indent


def block(source: str, spaces: int = 0) -> str:
    return indent(dedent(source).strip("\n") + "\n", " " * spaces)


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:220]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Batch-validate before the first structural mutation and invalidate caches once.
grid_path = Path("gridsolver/abstract_grids/grid.py")
grid = grid_path.read_text(encoding="utf-8")
old_rules = block(
    '''
    def add_rule_checked(self, rule: Rule) -> None:
        rule = self._normalize_rule(rule)
        if rule not in self.rules_ia and rule not in self.rules:
            self.rules.add(rule)
            if self._trail_state.active:
                self._trail_state.entries.append(("rule+", rule))
            self._invalidate_struct_cache()
    ''',
    4,
)
new_rules = block(
    '''
    def add_rules_checked(self, rules: Iterable[Rule]) -> None:
        """Validate a complete rule batch, then commit it in one mutation."""
        additions: list[Rule] = []
        seen: set[Rule] = set()
        for rule in rules:
            rule = self._normalize_rule(rule)
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
        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("rule+", rule) for rule in additions
            )
        self._invalidate_struct_cache()

    def add_rule_checked(self, rule: Rule) -> None:
        self.add_rules_checked((rule,))
    ''',
    4,
)
if old_rules not in grid:
    raise SystemExit("Single-rule add block not found")
grid = grid.replace(old_rules, new_rules, 1)

old_guarantees = block(
    '''
    def add_gtee_checked(self, guarantee: Guarantee) -> None:
        guarantee = self._normalize_guarantee(guarantee)
        if (
            guarantee not in self.guarantees_ia
            and guarantee not in self.guarantees
        ):
            self.guarantees.add(guarantee)
            if self._trail_state.active:
                self._trail_state.entries.append(("gt+", guarantee))
            self._invalidate_struct_cache()
            self._invalidate_guarantee_cache()
    ''',
    4,
)
new_guarantees = block(
    '''
    def add_gtees_checked(self, guarantees: Iterable[Guarantee]) -> None:
        """Validate a complete guarantee batch, then commit it atomically."""
        additions: list[Guarantee] = []
        seen: set[Guarantee] = set()
        for guarantee in guarantees:
            guarantee = self._normalize_guarantee(guarantee)
            if (
                guarantee in seen
                or guarantee in self.guarantees_ia
                or guarantee in self.guarantees
            ):
                continue
            seen.add(guarantee)
            additions.append(guarantee)

        if not additions:
            return
        self.guarantees.update(additions)
        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("gt+", guarantee) for guarantee in additions
            )
        self._invalidate_struct_cache()
        self._invalidate_guarantee_cache()

    def add_gtee_checked(self, guarantee: Guarantee) -> None:
        self.add_gtees_checked((guarantee,))
    ''',
    4,
)
if old_guarantees not in grid:
    raise SystemExit("Single-guarantee add block not found")
grid = grid.replace(old_guarantees, new_guarantees, 1)

old_ext = block(
    '''
    # Construct every rule before committing the first one. A bad later
    # constructor must not leave a partially extended grid.
    rules = list(new_rules)
    for rule in rules:
        self.add_rule_checked(rule)
    ''',
    8,
)
new_ext = block(
    '''
    # add_rules_checked materialises and validates the entire generator before
    # changing the live rule set.
    self.add_rules_checked(new_rules)
    ''',
    8,
)
if old_ext not in grid:
    raise SystemExit("Grid.ext_rules commit block not found")
grid_path.write_text(grid.replace(old_ext, new_ext, 1), encoding="utf-8")

# Cage constructors already build a complete list; commit it in one cache change.
for path in (
    "gridsolver/grid_classes/kenken.py",
    "gridsolver/grid_classes/killer_sudoku.py",
):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    old = block(
        '''
        for rule in rules:
            self.add_rule_checked(rule)
        ''',
        8,
    )
    if old not in text:
        raise SystemExit(f"Cage rule commit loop not found in {path}")
    target.write_text(
        text.replace(old, "        self.add_rules_checked(rules)\n", 1),
        encoding="utf-8",
    )

# Validate every structural output before deactivating the source rule.
prop_path = Path("gridsolver/solver/propagation.py")
prop = prop_path.read_text(encoding="utf-8")
old = block(
    '''
    if new_rules is not None:
        grid.deactivate_rule(rule)
        for new_rule in new_rules:
            grid.add_rule_checked(new_rule)
    if new_guarantees is not None:
        for guarantee in new_guarantees:
            grid.add_gtee_checked(guarantee)
    ''',
    8,
)
new = block(
    '''
    # Rule implementations may return generators. Materialise and validate both
    # outputs before deactivating the source rule or changing either live set.
    prepared_rules = (
        None
        if new_rules is None
        else tuple(grid._normalize_rule(new_rule) for new_rule in new_rules)
    )
    prepared_guarantees = (
        None
        if new_guarantees is None
        else tuple(
            grid._normalize_guarantee(guarantee)
            for guarantee in new_guarantees
        )
    )

    if prepared_rules is not None:
        grid.deactivate_rule(rule)
        grid.add_rules_checked(prepared_rules)
    if prepared_guarantees is not None:
        grid.add_gtees_checked(prepared_guarantees)
    ''',
    8,
)
if old not in prop:
    raise SystemExit("Propagation structural output block not found")
prop_path.write_text(prop.replace(old, new, 1), encoding="utf-8")

# Regressions live in an already permanent CI file.
test_path = Path("tests/test_rule_inputs.py")
tests = test_path.read_text(encoding="utf-8")
tests = tests.replace(
    "from gridsolver.rules.rules import Guarantee\n",
    "from gridsolver.rules.rules import Guarantee, Rule\n",
    1,
)
tests = tests.replace(
    "from gridsolver.rules.unique import ElementsAtMostOnce\n",
    "from gridsolver.rules.unique import ElementsAtMostOnce\n"
    "from gridsolver.solver.propagation import apply_rules\n",
    1,
)
if "class _StructuralOutputRule" in tests:
    raise SystemExit("Structural batch tests already exist")
tests += dedent(
    '''


    class _StructuralOutputRule(Rule):
        __slots__ = ("replacement_rules", "replacement_guarantees")

        def __init__(
            self,
            grid,
            *,
            replacement_rules=None,
            replacement_guarantees=None,
        ):
            super().__init__(grid, cells=[0])
            self.replacement_rules = replacement_rules
            self.replacement_guarantees = replacement_guarantees

        def apply(self, known, candidates, guarantees=None):
            return False, self.replacement_rules, self.replacement_guarantees


    class _CountingGrid(Grid):
        def __init__(self):
            super().__init__(2)
            self.struct_invalidations = 0
            self.guarantee_invalidations = 0

        def _invalidate_struct_cache(self):
            self.struct_invalidations += 1
            super()._invalidate_struct_cache()

        def _invalidate_guarantee_cache(self):
            self.guarantee_invalidations += 1
            super()._invalidate_guarantee_cache()


    def test_rule_batch_validates_every_item_before_first_mutation():
        grid = Grid(2)
        valid = ElementsAtMostOnce(grid, cells=[0, 1])
        incompatible = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])
        cache_value = grid.cached_struct("sentinel", object)
        cache = grid._struct_cache
        mark = grid.trail_mark()

        with pytest.raises(ValueError, match="dimensions"):
            grid.add_rules_checked((valid, incompatible))

        assert not grid.rules
        assert not grid.rules_ia
        assert not grid._trail_state.entries
        assert grid._struct_cache is cache
        assert grid._struct_cache["sentinel"] is cache_value
        grid.trail_undo(mark)


    def test_guarantee_batch_validates_every_item_before_first_mutation():
        grid = Grid(2)
        valid = Guarantee(1, frozenset({0, 1}), 2, 2)
        invalid = Guarantee(3, frozenset({2, 3}), 2, 2)
        struct_value = grid.cached_struct("sentinel", object)
        guarantee_value = grid.cached_guarantee_struct("sentinel", object)
        struct_cache = grid._struct_cache
        guarantee_cache = grid._guarantee_cache
        mark = grid.trail_mark()

        with pytest.raises(ValueError, match="outside 1..2"):
            grid.add_gtees_checked((valid, invalid))

        assert not grid.guarantees
        assert not grid.guarantees_ia
        assert not grid._trail_state.entries
        assert grid._struct_cache is struct_cache
        assert grid._guarantee_cache is guarantee_cache
        assert grid._struct_cache["sentinel"] is struct_value
        assert grid._guarantee_cache["sentinel"] is guarantee_value
        grid.trail_undo(mark)


    def test_successful_batches_invalidate_each_cache_once_and_undo_exactly():
        grid = _CountingGrid()
        rules = (
            ElementsAtMostOnce(grid, cells=[0, 1]),
            ElementsAtMostOnce(grid, cells=[2, 3]),
        )
        guarantees = (
            Guarantee(1, frozenset({0, 1}), 2, 2),
            Guarantee(2, frozenset({2, 3}), 2, 2),
        )
        before = (
            grid.rules.copy(),
            grid.guarantees.copy(),
            grid._struct_cache,
            grid._guarantee_cache,
        )
        mark = grid.trail_mark()

        grid.add_rules_checked(rules)
        grid.add_gtees_checked(guarantees)

        assert grid.rules == set(rules)
        assert grid.guarantees == set(guarantees)
        assert grid.struct_invalidations == 2
        assert grid.guarantee_invalidations == 1
        assert [entry[0] for entry in grid._trail_state.entries] == [
            "rule+",
            "rule+",
            "gt+",
            "gt+",
        ]

        grid.trail_undo(mark)
        assert grid.rules == before[0]
        assert grid.guarantees == before[1]
        assert grid._struct_cache is before[2]
        assert grid._guarantee_cache is before[3]
        assert not grid._trail_state.entries


    def test_rule_outputs_are_validated_before_source_deactivation():
        grid = Grid(2)
        valid = ElementsAtMostOnce(grid, cells=[1, 2])
        incompatible = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])
        source = _StructuralOutputRule(
            grid,
            replacement_rules=(valid, incompatible),
        )
        grid.add_rule_checked(source)
        cache_value = grid.cached_struct("sentinel", object)
        cache = grid._struct_cache
        mark = grid.trail_mark()

        with pytest.raises(ValueError, match="dimensions"):
            apply_rules(grid)

        assert source in grid.rules
        assert valid not in grid.rules
        assert not grid.rules_ia
        assert not grid._trail_state.entries
        assert grid._struct_cache is cache
        assert grid._struct_cache["sentinel"] is cache_value
        grid.trail_undo(mark)


    def test_invalid_guarantee_output_does_not_deactivate_satisfied_source():
        grid = Grid(2)
        invalid = Guarantee(3, frozenset({0}), 2, 2)
        source = _StructuralOutputRule(
            grid,
            replacement_rules=(),
            replacement_guarantees=(invalid,),
        )
        grid.add_rule_checked(source)
        mark = grid.trail_mark()

        with pytest.raises(ValueError, match="outside 1..2"):
            apply_rules(grid)

        assert source in grid.rules
        assert not grid.rules_ia
        assert not grid.guarantees
        assert not grid._trail_state.entries
        grid.trail_undo(mark)
    '''
)
test_path.write_text(tests, encoding="utf-8")

# Record the extension-safety invariant.
dev_path = Path("DEVELOPMENT.md")
dev = dev_path.read_text(encoding="utf-8")
anchor = (
    "Deterministic `@cached_property` values may still be populated after freezing.\n"
)
insertion = (
    "Rule and guarantee batches are fully validated before the first live-set\n"
    "mutation. A malformed later replacement therefore cannot deactivate its\n"
    "source rule or leave a partial batch behind; each successful batch also\n"
    "invalidates structural caches only once.\n"
)
if insertion not in dev:
    if anchor not in dev:
        raise SystemExit("Development structural-update anchor not found")
    dev = dev.replace(anchor, anchor + insertion, 1)
dev_path.write_text(dev, encoding="utf-8")
