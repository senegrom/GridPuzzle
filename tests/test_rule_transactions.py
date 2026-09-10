import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules


def _state(grid):
    return (
        grid.known,
        tuple(frozenset(values) for values in grid._candidates),
        grid.has_been_filled,
        tuple(frozenset(map(id, items)) for items in (
            grid.rules, grid.rules_ia, grid.guarantees, grid.guarantees_ia,
        )),
    )


def _touch_grid(grid):
    grid[0] = 1
    grid.get_candidates(2).discard(3)
    grid.cached_struct("hook-only", object)
    grid.cached_rule_struct("hook-only", object)
    grid.cached_guarantee_struct("hook-only", object)
    grid._sync_candidate_index()


@pytest.mark.parametrize("failure", (None, ValueError, KeyboardInterrupt))
def test_rule_iterator_publishes_only_explicit_outputs(failure):
    grid = Grid(1, 3, max_elem=3)
    original = ElementsAtMostOnce(grid, cells=(0, 1))
    grid.add_rule_checked(original)
    expected = ElementsAtMostOnce(grid, cells=(1, 2))
    incidental = ElementsAtMostOnce(grid, cells=(0, 2))
    before = _state(grid)
    caches = grid._struct_cache, grid._rule_cache, grid._guarantee_cache
    dirty = grid._trail_state.dirty.copy()
    outer = grid.trail_mark()

    def rules():
        _touch_grid(grid)
        grid.deactivate_rule(original)
        grid.add_rule_checked(incidental)
        grid.add_gtee_checked(Guarantee(2, frozenset({1}), 1, 3))
        yield expected
        if failure:
            raise failure("rule iterator failed")

    try:
        if failure:
            with pytest.raises(failure, match="rule iterator failed"):
                grid.add_rules_checked(rules())
            assert _state(grid) == before
            assert grid._trail_state.dirty == dirty
            assert not grid._trail_state.entries
            assert grid._struct_cache is caches[0]
            assert not expected._frozen
        else:
            grid.add_rules_checked(rules())
            assert grid.rules == {original, expected}
            assert not grid.rules_ia
            assert not grid.guarantees
            assert grid.known == (0, 0, 0)
            assert all(values == {1, 2, 3} for values in grid._candidates)
            assert not grid.has_been_filled
        assert grid._trail_state.candidate_masks is None
        assert [frame.token for frame in grid._trail_state.marks] == [outer]
        for cache in (*caches, grid._struct_cache, grid._rule_cache, grid._guarantee_cache):
            assert "hook-only" not in cache
    finally:
        grid.trail_undo(outer)
    assert _state(grid) == before


@pytest.mark.parametrize("hook", ("metadata", "freeze", "hash"))
@pytest.mark.parametrize("fail", (False, True))
def test_rule_registration_hooks_cannot_leak_puzzle_mutations(hook, fail):
    grid = Grid(1, 3, max_elem=3)
    armed = False

    def touch(kind):
        if armed and hook == kind:
            _touch_grid(grid)
            if fail:
                raise RuntimeError("registration hook failed")

    class HookRule(Rule):
        def apply(self, known, candidates, guarantees=None):
            return False, None, None

        def __getattribute__(self, name):
            if name == "cells":
                touch("metadata")
            return super().__getattribute__(name)

        def freeze(self):
            touch("freeze")
            return super().freeze()

        def __hash__(self):
            touch("hash")
            return super().__hash__()

    rule = HookRule(grid, cells=(0, 1))
    before = _state(grid)
    armed = True
    if fail:
        with pytest.raises(RuntimeError, match="registration hook failed"):
            grid.add_rule_checked(rule)
        assert _state(grid) == before
    else:
        grid.add_rule_checked(rule)
        assert tuple(grid.rules) == (rule,)
        assert grid.known == (0, 0, 0)
        assert all(values == {1, 2, 3} for values in grid._candidates)
    assert not grid.has_been_filled
    assert grid._trail_state.candidate_masks is None
    assert not grid._trail_state.entries
    assert not grid._trail_state.marks
    assert all("hook-only" not in cache for cache in (
        grid._struct_cache, grid._rule_cache, grid._guarantee_cache,
    ))


@pytest.mark.parametrize("failure", (RuntimeError, KeyboardInterrupt))
@pytest.mark.parametrize("stage", ("hash", "equality"))
def test_failed_source_removal_rolls_back_the_entire_replacement(stage, failure):
    grid = Grid(1, 3, max_elem=3)
    control = {"armed": False, "fail": True}
    replacement = ElementsAtMostOnce(grid, cells=(0, 1))
    guarantee = Guarantee(1, frozenset({0}), 1, 3)

    class Source(Rule):
        def __hash__(self):
            if stage == "hash" and control["armed"]:
                raise failure("source removal failed")
            return 1

        def apply(self, known, candidates, guarantees=None):
            control["armed"] = control["fail"]
            # Explicit output mutations survive only on successful publication.
            candidates[0].discard(3)
            known[1] = 2
            # Access through a captured grid must never survive the sandbox.
            grid[2] = 3
            return True, (replacement,), (guarantee,)

    class InactiveBlocker(Rule):
        def apply(self, known, candidates, guarantees=None):
            return False, None, None

        def __hash__(self):
            return 1

        def __eq__(self, other):
            if stage == "equality" and control["armed"] and isinstance(other, Source):
                raise failure("source removal failed")
            return self is other

    blocker = InactiveBlocker(grid, cells=(2,))
    grid.add_rule_checked(blocker)
    grid.deactivate_rule(blocker)
    source = Source(grid, cells=(0, 1))
    grid.add_rule_checked(source)
    before = _state(grid)
    caches = grid._struct_cache, grid._rule_cache, grid._guarantee_cache
    outer = grid.trail_mark()
    with pytest.raises(failure, match="source removal failed"):
        apply_rules(grid)
    # The failing hook remains armed: cleanup must not invoke it again.
    assert _state(grid) == before
    assert not grid._trail_state.entries
    assert [frame.token for frame in grid._trail_state.marks] == [outer]
    assert all(current is original for current, original in zip(
        (grid._struct_cache, grid._rule_cache, grid._guarantee_cache), caches,
    ))
    assert grid._trail_state.dirty.all_rules

    control.update(armed=False, fail=False)
    apply_rules(grid)
    assert grid.rules == {replacement}
    assert source in grid.rules_ia
    assert grid.guarantees == {guarantee}
    assert grid.get_candidates(0) == {1, 2}
    assert grid.known == (0, 2, 0)
    assert grid.get_candidates(2) == {1, 2, 3}
    grid.trail_undo(outer)
    assert _state(grid) == before
