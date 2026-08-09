"""Separate caches affected only by active rule changes."""

from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(
            f"{path}: expected one marker, found {text.count(old)}"
        )
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


trail_path = Path("gridsolver/abstract_grids/trail.py")
replace_once(
    trail_path,
    '''    filled: bool
    struct_cache: dict[str, Any]
    guarantee_cache: dict[str, Any]
    dirty_state: PropagationDirtyState
''',
    '''    filled: bool
    struct_cache: dict[str, Any]
    rule_cache: dict[str, Any]
    guarantee_cache: dict[str, Any]
    dirty_state: PropagationDirtyState
''',
)


grid_path = Path("gridsolver/abstract_grids/grid.py")
replace_once(
    grid_path,
    '''        self.has_been_filled = False
        self._struct_cache: dict[str, Any] = {}
        # Guarantee-only structures survive rule churn. This matters on
''',
    '''        self.has_been_filled = False
        self._struct_cache: dict[str, Any] = {}
        # Rule-only structures survive guarantee churn. This matters during
        # speculative propagation, where guarantees narrow and deactivate far
        # more frequently than the active rule graph changes.
        self._rule_cache: dict[str, Any] = {}
        # Guarantee-only structures survive rule churn. This matters on
''',
)
replace_once(
    grid_path,
    '''        result.name = self.name
        result._struct_cache = {}
        result._guarantee_cache = {}
''',
    '''        result.name = self.name
        result._struct_cache = {}
        result._rule_cache = {}
        result._guarantee_cache = {}
''',
)
replace_once(
    grid_path,
    '''                filled=self.has_been_filled,
                struct_cache=self._struct_cache,
                guarantee_cache=self._guarantee_cache,
''',
    '''                filled=self.has_been_filled,
                struct_cache=self._struct_cache,
                rule_cache=self._rule_cache,
                guarantee_cache=self._guarantee_cache,
''',
)
replace_once(
    grid_path,
    '''        self.has_been_filled = frame.filled
        self._struct_cache = frame.struct_cache
        self._guarantee_cache = frame.guarantee_cache
''',
    '''        self.has_been_filled = frame.filled
        self._struct_cache = frame.struct_cache
        self._rule_cache = frame.rule_cache
        self._guarantee_cache = frame.guarantee_cache
''',
)
replace_once(
    grid_path,
    '''        branch_peers = self.cached_struct(
            "branch_peers",
            build_branch_peers,
        )
''',
    '''        branch_peers = self.cached_rule_struct(
            "branch_peers",
            build_branch_peers,
        )
''',
)
replace_once(
    grid_path,
    '''    def _invalidate_struct_cache(self) -> None:
        # A trail frame owns the parent cache object. Branch invalidation
        # swaps in a new dictionary instead of destroying that object.
        if self._trail_state.active:
            self._struct_cache = {}
        else:
            self._struct_cache.clear()

    def _invalidate_guarantee_cache(self) -> None:
''',
    '''    def _invalidate_struct_cache(self) -> None:
        # A trail frame owns the parent cache object. Branch invalidation
        # swaps in a new dictionary instead of destroying that object.
        if self._trail_state.active:
            self._struct_cache = {}
        else:
            self._struct_cache.clear()

    def _invalidate_rule_cache(self) -> None:
        if self._trail_state.active:
            self._rule_cache = {}
        else:
            self._rule_cache.clear()

    def _invalidate_guarantee_cache(self) -> None:
''',
)
replace_once(
    grid_path,
    '''        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("rule+", rule) for rule in additions
            )
        self._invalidate_struct_cache()
    def add_rule_checked(self, rule: Rule) -> None:
''',
    '''        if self._trail_state.active:
            self._trail_state.entries.extend(
                ("rule+", rule) for rule in additions
            )
        self._invalidate_rule_cache()
        self._invalidate_struct_cache()

    def add_rule_checked(self, rule: Rule) -> None:
''',
)
replace_once(
    grid_path,
    '''        if self._trail_state.active:
            self._trail_state.entries.append(("rule-", rule))
        self._invalidate_struct_cache()

    def _normalize_guarantee(self, guarantee: Guarantee) -> Guarantee:
''',
    '''        if self._trail_state.active:
            self._trail_state.entries.append(("rule-", rule))
        self._invalidate_rule_cache()
        self._invalidate_struct_cache()

    def _normalize_guarantee(self, guarantee: Guarantee) -> Guarantee:
''',
)
replace_once(
    grid_path,
    '''    def cached_guarantee_struct(self, key: Any, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live guarantee set."""
''',
    '''    def cached_rule_struct(self, key: Any, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live rule set."""
        try:
            return self._rule_cache[key]
        except KeyError:
            value = factory()
            self._rule_cache[key] = value
            return value

    def cached_guarantee_struct(self, key: Any, factory: Callable[[], Any]) -> Any:
        """Memoize a structure affected only by the live guarantee set."""
''',
)
replace_once(
    grid_path,
    '''                by_cell = self.cached_struct(
                    "propagation_rules_by_cell",
                    build_rule_watchers,
                )
''',
    '''                by_cell = self.cached_rule_struct(
                    "propagation_rules_by_cell",
                    build_rule_watchers,
                )
''',
)
replace_once(
    grid_path,
    '''        return self.cached_struct(
            "unique_rule_cells",
            lambda: self.get_rule_cells_of_type(ElementsAtMostOnce),
        )
''',
    '''        return self.cached_rule_struct(
            "unique_rule_cells",
            lambda: self.get_rule_cells_of_type(ElementsAtMostOnce),
        )
''',
)
replace_once(
    grid_path,
    '''        return self.cached_struct("weak_links", build)
''',
    '''        return self.cached_rule_struct("weak_links", build)
''',
)

parallel_path = Path("gridsolver/solver/solve_parallel.py")
replace_once(
    parallel_path,
    '''    grid._struct_cache.clear()
    grid._guarantee_cache.clear()
''',
    '''    grid._struct_cache.clear()
    grid._rule_cache.clear()
    grid._guarantee_cache.clear()
''',
)

Path("tests/test_rule_only_cache.py").write_text(
    '''from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules


def _populate_rule_only_caches(grid: Grid) -> dict[str, object]:
    grid.get_smallest_candidate_set_gt1()
    _ = grid.unique_rule_cells
    _ = grid.weak_links
    apply_rules(grid)
    grid._candidates[0].discard(grid.max_elem)
    apply_rules(grid)
    assert "propagation_rules_by_cell" in grid._rule_cache
    return dict(grid._rule_cache)


def test_rule_only_caches_survive_guarantee_addition_and_deactivation():
    grid = Grid(2)
    grid.add_rules_checked(
        (
            ElementsAtMostOnce(grid, cells=[0, 1]),
            UneqRule(grid, origin_cell=0, rel_cells=[1, 2]),
        )
    )
    cached = _populate_rule_only_caches(grid)
    cache = grid._rule_cache

    guarantee = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(guarantee)
    assert grid._rule_cache is cache
    assert all(grid._rule_cache[key] is value for key, value in cached.items())

    grid.deactivate_gtee(guarantee)
    assert grid._rule_cache is cache
    assert all(grid._rule_cache[key] is value for key, value in cached.items())


def test_rule_only_caches_invalidate_on_rule_changes():
    grid = Grid(2)
    first = ElementsAtMostOnce(grid, cells=[0, 1])
    second = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rule_checked(first)
    _populate_rule_only_caches(grid)
    cache = grid._rule_cache

    grid.add_rule_checked(second)
    assert grid._rule_cache is cache
    assert not grid._rule_cache

    _populate_rule_only_caches(grid)
    grid.deactivate_rule(first)
    assert grid._rule_cache is cache
    assert not grid._rule_cache


def test_nested_trails_restore_rule_only_cache_objects():
    grid = Grid(2)
    root_value = object()
    grid._rule_cache["root"] = root_value
    root_cache = grid._rule_cache

    outer = grid.trail_mark()
    outer_rule = ElementsAtMostOnce(grid, cells=[0, 1])
    grid.add_rule_checked(outer_rule)
    assert grid._rule_cache is not root_cache
    outer_value = object()
    grid._rule_cache["outer"] = outer_value
    outer_cache = grid._rule_cache

    inner = grid.trail_mark()
    guarantee = Guarantee(1, frozenset({0, 1}), 2, 2)
    grid.add_gtee_checked(guarantee)
    assert grid._rule_cache is outer_cache

    inner_rule = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rule_checked(inner_rule)
    assert grid._rule_cache is not outer_cache
    grid.trail_undo(inner)

    assert grid._rule_cache is outer_cache
    assert grid._rule_cache["outer"] is outer_value
    assert inner_rule not in grid.rules
    assert guarantee not in grid.guarantees

    grid.trail_undo(outer)
    assert grid._rule_cache is root_cache
    assert grid._rule_cache["root"] is root_value
    assert outer_rule not in grid.rules


def test_deepcopy_starts_with_empty_detached_rule_cache():
    grid = Grid(2)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 1]))
    _populate_rule_only_caches(grid)

    clone = grid.deepcopy()

    assert clone._rule_cache == {}
    assert clone._rule_cache is not grid._rule_cache
    assert clone.rules == grid.rules


def test_rule_watcher_identity_survives_guarantee_churn():
    grid = Grid(1, 4, max_elem=3)
    first = ElementsAtMostOnce(grid, cells=[0, 1])
    second = ElementsAtMostOnce(grid, cells=[2, 3])
    grid.add_rules_checked((first, second))
    apply_rules(grid)

    grid._candidates[0].discard(3)
    apply_rules(grid)
    watchers = grid._rule_cache["propagation_rules_by_cell"]

    for value in (1, 2, 3):
        guarantee = Guarantee(value, frozenset({0, 1}), 1, 4)
        grid.add_gtee_checked(guarantee)
        grid._candidates[0].discard(value)
        apply_rules(grid)
        assert grid._rule_cache["propagation_rules_by_cell"] is watchers
        grid.deactivate_gtee(guarantee)
        assert grid._rule_cache["propagation_rules_by_cell"] is watchers
''',
    encoding="utf-8",
)
