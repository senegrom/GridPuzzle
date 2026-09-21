import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules


class _NormalizingGrid(Grid):
    def __init__(self):
        super().__init__(1, 3, max_elem=3)
        self.calls = 0
        self.fail = False

    def _normalize_guarantee(self, guarantee):
        self.calls += 1
        self[1] = 2
        self.get_candidates(2).discard(3)
        self.add_rule_checked(ElementsAtMostOnce(self, cells=(1, 2)))
        self.cached_struct("hook-only", lambda: "discard me")
        self.cached_rule_struct("hook-only", lambda: "discard me")
        self.cached_guarantee_struct("hook-only", lambda: "discard me")
        self._sync_candidate_index()
        if self.fail:
            raise ValueError("normalization failed")
        return super()._normalize_guarantee(guarantee)


def _guarantee(grid):
    return Guarantee(1, frozenset({0}), grid.rows, grid.cols)


def _assert_no_hook_changes(grid, caches):
    assert grid.known == (0, 0, 0)
    assert all(grid.get_candidates(cell) == {1, 2, 3} for cell in range(grid.len))
    assert not grid.has_been_filled
    assert not any(isinstance(rule, ElementsAtMostOnce) for rule in grid.rules)
    assert grid._trail_state.candidate_masks is None
    for current, original in zip(
        (grid._struct_cache, grid._rule_cache, grid._guarantee_cache),
        caches,
        strict=True,
    ):
        assert "hook-only" not in current
        assert "hook-only" not in original


@pytest.mark.parametrize("fail", (False, True))
def test_normalization_hook_discards_side_effects_before_commit(fail):
    grid = _NormalizingGrid()
    grid.fail = fail
    caches = grid._struct_cache, grid._rule_cache, grid._guarantee_cache
    dirty = grid._trail_state.dirty.copy()
    outer = grid.trail_mark()
    try:
        if fail:
            with pytest.raises(ValueError, match="normalization failed"):
                grid.add_gtee_checked(_guarantee(grid))
            assert not grid.guarantees
            assert grid._trail_state.dirty == dirty
            assert not grid._trail_state.entries
        else:
            grid.add_gtee_checked(_guarantee(grid))
            assert grid.guarantees == {_guarantee(grid)}

        assert grid.calls == 1
        _assert_no_hook_changes(grid, caches)
        assert [frame.token for frame in grid._trail_state.marks] == [outer]
    finally:
        grid.trail_undo(outer)
    assert not grid.guarantees
    _assert_no_hook_changes(grid, caches)


@pytest.mark.parametrize("fail", (False, True))
def test_guarantee_iterator_mutations_are_rolled_back(fail):
    grid = Grid(1, 2, max_elem=2)

    def guarantees():
        grid[1] = 2
        yield Guarantee(1, frozenset({0}), 1, 2)
        if fail:
            raise ValueError("iterator failed")

    if fail:
        with pytest.raises(ValueError, match="iterator failed"):
            grid.add_gtees_checked(guarantees())
        assert not grid.guarantees
    else:
        grid.add_gtees_checked(guarantees())
        assert len(grid.guarantees) == 1
    assert grid.known == (0, 0)
    assert grid.get_candidates(1) == {1, 2}
    assert not grid._trail_state.marks
    assert not grid._trail_state.entries


class _EmitGuarantee(Rule):
    def apply(self, known, candidates, guarantees=None):
        candidates[0].discard(3)
        return False, (), (Guarantee(1, frozenset({0}), 1, 3),)


def test_rule_output_normalization_failure_keeps_the_source_retryable():
    grid = _NormalizingGrid()
    rule = _EmitGuarantee(grid, cells=(0,))
    grid.add_rule_checked(rule)
    caches = grid._struct_cache, grid._rule_cache, grid._guarantee_cache
    grid.fail = True
    with pytest.raises(ValueError, match="normalization failed"):
        apply_rules(grid)

    assert grid.rules == {rule}
    assert not grid.rules_ia
    assert not grid.guarantees
    assert grid._trail_state.dirty.all_rules
    _assert_no_hook_changes(grid, caches)

    grid.fail = False
    apply_rules(grid)
    assert not grid.rules
    assert grid.rules_ia == {rule}
    assert grid.guarantees == {_guarantee(grid)}
    assert grid.get_candidates(0) == {1, 2}
    assert grid.get_candidates(1) == grid.get_candidates(2) == {1, 2, 3}
    assert grid.calls == 2


def test_override_output_is_validated_before_it_reaches_live_sets():
    class MalformedGrid(Grid):
        def _normalize_guarantee(self, guarantee):
            self[1] = 2
            return Guarantee(1, frozenset({self.len}), self.rows, self.cols)

    grid = MalformedGrid(1, 2, max_elem=2)
    with pytest.raises(ValueError, match="outside"):
        grid.add_gtee_checked(_guarantee(grid))
    assert grid.known == (0, 0)
    assert not grid.guarantees


def test_hook_cache_misses_and_active_candidate_index_are_restored():
    class CacheGrid(Grid):
        def _normalize_guarantee(self, guarantee):
            self.get_candidates(1).discard(2)
            self._sync_candidate_index()
            self.cached_struct("hook-only", lambda: 1)
            self.cached_rule_struct("hook-only", lambda: 2)
            self.cached_guarantee_struct("hook-only", lambda: 3)
            raise ValueError("cache hook failed")

    grid = CacheGrid(1, 2, max_elem=2)
    expected_masks = grid._sync_candidate_index()
    masks = grid._trail_state.candidate_masks
    value_masks = grid._trail_state.candidate_value_masks
    caches = grid._struct_cache, grid._rule_cache, grid._guarantee_cache
    for cache in caches:
        cache["keep"] = "parent value"
    dirty = grid._trail_state.dirty.copy()

    with pytest.raises(ValueError, match="cache hook failed"):
        grid.add_gtee_checked(_guarantee(grid))

    assert grid.get_candidates(1) == {1, 2}
    assert grid._trail_state.candidate_masks is masks
    assert grid._trail_state.candidate_value_masks is value_masks
    assert grid._sync_candidate_index() == expected_masks
    assert grid._trail_state.dirty == dirty
    for current, original in zip(
        (grid._struct_cache, grid._rule_cache, grid._guarantee_cache),
        caches,
        strict=True,
    ):
        assert current is original
        assert current == {"keep": "parent value"}


def test_resolving_the_normalization_hook_is_inside_the_transaction():
    class ResolvingGrid(Grid):
        @property
        def _normalize_guarantee(self):
            self[1] = 2
            raise ValueError("hook lookup failed")

    grid = ResolvingGrid(1, 2, max_elem=2)
    with pytest.raises(ValueError, match="hook lookup failed"):
        grid.add_gtee_checked(_guarantee(grid))
    assert grid.known == (0, 0)
    assert grid.get_candidates(1) == {1, 2}
    assert not grid.has_been_filled
    assert not grid.guarantees
