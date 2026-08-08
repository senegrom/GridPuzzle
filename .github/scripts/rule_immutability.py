from pathlib import Path
from textwrap import dedent, indent


def block(source: str, spaces: int = 0) -> str:
    return indent(dedent(source).strip("\n") + "\n", " " * spaces)


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:200]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Base Rule: immutable tuple cells plus freeze-on-hash/addition.
rules_path = Path("gridsolver/rules/rules.py")
rules = rules_path.read_text(encoding="utf-8")
rules = rules.replace("from array import ArrayType, array\n", "", 1)
rules = rules.replace(
    '__slots__ = ("cells", "_rows", "_cols", "_max_elem", "len_cells")',
    '__slots__ = ("cells", "_rows", "_cols", "_max_elem", "len_cells", "_frozen")',
    1,
)
constructor_anchor = block(
    '''
    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator: TCellCreator | None = None,
    ) -> None:
        self._rows = gsz.rows
    ''',
    4,
)
constructor_replacement = block(
    '''
    def __setattr__(self, name: str, value: object) -> None:
        if getattr(self, "_frozen", False) and hasattr(self, name):
            raise AttributeError(
                f"{type(self).__name__} is immutable after hashing or registration"
            )
        object.__setattr__(self, name, value)

    def freeze(self) -> "Rule":
        object.__setattr__(self, "_frozen", True)
        return self

    def __init__(
        self,
        gsz: GridSizeContainer,
        cells: Iterable[IdxType] | None = None,
        cell_creator: TCellCreator | None = None,
    ) -> None:
        object.__setattr__(self, "_frozen", False)
        self._rows = gsz.rows
    ''',
    4,
)
if constructor_anchor not in rules:
    raise SystemExit("Rule constructor anchor not found")
rules = rules.replace(constructor_anchor, constructor_replacement, 1)
rules = rules.replace(
    '        self.cells: ArrayType = array("I", normalized)\n',
    '        self.cells: tuple[int, ...] = tuple(normalized)\n',
    1,
)
old_hash = block(
    '''
    def __hash__(self) -> int:
        return hash(
            (
                type(self),
                bytes(self.cells),
                self._rows,
                self._cols,
                self._max_elem,
                self.len_cells,
            )
        )
    ''',
    4,
)
new_hash = block(
    '''
    def __hash__(self) -> int:
        self.freeze()
        return hash(
            (
                type(self),
                self.cells,
                self._rows,
                self._cols,
                self._max_elem,
                self.len_cells,
            )
        )
    ''',
    4,
)
if old_hash not in rules:
    raise SystemExit("Rule hash block not found")
rules_path.write_text(rules.replace(old_hash, new_hash, 1), encoding="utf-8")

# Canonicalising subclasses now retain immutable tuples.
unique_path = Path("gridsolver/rules/unique.py")
unique = unique_path.read_text(encoding="utf-8")
unique = unique.replace("from array import array\n", "", 1)
old = '        self.cells = array("I", sorted(self.cells))\n'
if unique.count(old) != 2:
    raise SystemExit(f"Expected two unique-rule cell canonicalisations, found {unique.count(old)}")
unique_path.write_text(
    unique.replace(old, "        self.cells = tuple(sorted(self.cells))\n"),
    encoding="utf-8",
)

uneq_path = Path("gridsolver/rules/uneq.py")
uneq = uneq_path.read_text(encoding="utf-8")
uneq = uneq.replace("from array import array\n", "", 1)
old = '        self.cells = array("I", [self.origin_cell, *sorted(self.rel_cells)])\n'
if old not in uneq:
    raise SystemExit("SingleRelationRule cell canonicalisation not found")
uneq_path.write_text(
    uneq.replace(
        old,
        "        self.cells = (self.origin_cell, *sorted(self.rel_cells))\n",
        1,
    ),
    encoding="utf-8",
)

sum_path = Path("gridsolver/rules/sumrules.py")
sumrules = sum_path.read_text(encoding="utf-8")
sumrules = sumrules.replace("from array import array\n", "", 1)
old_sorted = '            self.cells = array("I", sorted(self.cells))\n'
if sumrules.count(old_sorted) != 2:
    raise SystemExit(
        f"Expected two arithmetic cell canonicalisations, found {sumrules.count(old_sorted)}"
    )
sumrules = sumrules.replace(
    old_sorted,
    "            self.cells = tuple(sorted(self.cells))\n",
)
old_reverse = "                self.cells.reverse()\n"
if sumrules.count(old_reverse) != 2:
    raise SystemExit(
        f"Expected two symmetric-rule reversals, found {sumrules.count(old_reverse)}"
    )
sumrules = sumrules.replace(
    old_reverse,
    "                self.cells = tuple(reversed(self.cells))\n",
)
sum_path.write_text(sumrules, encoding="utf-8")

# Validate compatibility and freeze before a rule reaches either live set.
grid_path = Path("gridsolver/abstract_grids/grid.py")
grid = grid_path.read_text(encoding="utf-8")
old_add = block(
    '''
    def add_rule_checked(self, rule: Rule) -> None:
        if rule not in self.rules_ia and rule not in self.rules:
            self.rules.add(rule)
            if self._trail_state.active:
                self._trail_state.entries.append(("rule+", rule))
            self._invalidate_struct_cache()
    ''',
    4,
)
new_add = block(
    '''
    def _normalize_rule(self, rule: Rule) -> Rule:
        """Validate one rule before hashing or changing grid state."""
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

        canonical = tuple(cells)
        if rule.cells != canonical:
            rule.cells = canonical
        return rule.freeze()

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
if old_add not in grid:
    raise SystemExit("Grid.add_rule_checked block not found")
grid_path.write_text(grid.replace(old_add, new_add, 1), encoding="utf-8")

# Focused regressions.
test_path = Path("tests/test_rule_inputs.py")
tests = test_path.read_text(encoding="utf-8")
tests = tests.replace("import pytest\n", "import pickle\n\nimport pytest\n", 1)
tests = tests.replace(
    "from gridsolver.rules.sumrules import SumRule\n",
    "from gridsolver.rules.sumrules import SumAndElementsAtMostOnce, SumRule\n",
    1,
)
if "def test_registered_rules_are_immutable_and_hash_stable():" in tests:
    raise SystemExit("Rule immutability tests already exist")
tests += dedent(
    '''


    def test_registered_rules_are_immutable_and_hash_stable():
        grid = Grid(2)
        rule = SumRule(grid, cells=[1, 0], mysum=3)
        grid.add_rule_checked(rule)
        original_hash = hash(rule)

        assert rule.cells == (0, 1)
        assert rule in grid.rules

        with pytest.raises(AttributeError, match="immutable"):
            rule.cells = (0,)
        with pytest.raises(AttributeError, match="immutable"):
            rule.len_cells = 1
        with pytest.raises(AttributeError, match="immutable"):
            rule.sum = 4
        with pytest.raises(TypeError):
            rule.cells[0] = 1

        assert hash(rule) == original_hash
        assert rule in grid.rules


    def test_hashing_a_rule_freezes_it_even_outside_a_grid():
        rule = ElementsAtMostOnce(Grid(2), cells=[0, 1])
        original_hash = hash(rule)

        with pytest.raises(AttributeError, match="immutable"):
            rule.cells = (0, 2)

        assert hash(rule) == original_hash


    def test_frozen_rules_pickle_and_cached_properties_still_work():
        grid = Grid(2)
        cage = SumAndElementsAtMostOnce(grid, cells=[0, 1], mysum=3)
        grid.add_rule_checked(cage)

        assert cage.sum_candidates
        assert cage.candidates == frozenset({1, 2})

        restored = pickle.loads(pickle.dumps(cage))
        assert restored == cage
        assert hash(restored) == hash(cage)
        assert restored.sum_candidates == cage.sum_candidates
        with pytest.raises(AttributeError, match="immutable"):
            restored.sum = 4


    @pytest.mark.parametrize(
        "target, message",
        [
            (Grid(3), "dimensions"),
            (Grid(2, 2, max_elem=3), "value domain"),
        ],
    )
    def test_grid_rejects_rules_for_an_incompatible_shape_or_domain(target, message):
        source = Grid(2)
        rule = ElementsAtMostOnce(source, cells=[0, 1])
        target.cached_struct("sentinel", object)
        cache = target._struct_cache
        mark = target.trail_mark()

        with pytest.raises(ValueError, match=message):
            target.add_rule_checked(rule)

        assert not target.rules
        assert not target.rules_ia
        assert not target._trail_state.entries
        assert target._struct_cache is cache
        grid_cache_value = target._struct_cache["sentinel"]
        target.trail_undo(mark)
        assert target._struct_cache["sentinel"] is grid_cache_value


    def test_grid_rejects_non_rules_and_pre_registration_cell_corruption():
        grid = Grid(2)
        with pytest.raises(TypeError, match="Rule instances"):
            grid.add_rule_checked(object())

        rule = ElementsAtMostOnce(grid, cells=[0, 1])
        rule.cells = (0, 4)
        with pytest.raises(ValueError, match="outside 0..3"):
            grid.add_rule_checked(rule)

        assert not grid.rules
        assert not rule._frozen
    '''
)
test_path.write_text(tests, encoding="utf-8")

# Document the now-enforced invariant.
dev_path = Path("DEVELOPMENT.md")
dev = dev_path.read_text(encoding="utf-8")
old = (
    "**Rules are immutable and shared across explicit clones.**\n"
    "`Grid.deepcopy()` shallow-copies rule and guarantee sets but shares Rule\n"
    "objects. This is safe because Rule objects never mutate after construction;\n"
    "`@cached_property` values are deterministic. Candidate sets and trail state are\n"
)
new = (
    "**Rules are immutable and shared across explicit clones.**\n"
    "`Grid.deepcopy()` shallow-copies rule and guarantee sets but shares Rule\n"
    "objects. Rule cells are immutable tuples, and hashing or registration freezes\n"
    "all existing instance fields; attempts to alter cells, targets, or dimensions\n"
    "then fail. Registration also rejects rules for another shape or value domain.\n"
    "Deterministic `@cached_property` values may still be populated after freezing.\n"
    "Candidate sets and trail state are\n"
)
if old not in dev:
    raise SystemExit("Development rule-immutability paragraph not found")
dev_path.write_text(dev.replace(old, new, 1), encoding="utf-8")
