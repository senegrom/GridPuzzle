"""Source and scheduling boundary regressions supplementing the review cases."""

import pickle
from itertools import product

import pytest

from gridsolver.abstract_grids.extension_scope import _PROTECTED_SOURCES
from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules
from gridsolver.solver.rulehelpers import rulehelper_atmostonce
from gridsolver.solver.solver import solve
from gridsolver.solver.validation import InvalidSolutionError, validate_solution, validate_solutions


def state(grid):
    return (
        grid.known, tuple(frozenset(values) for values in grid._candidates),
        grid.has_been_filled,
        tuple(tuple(sorted(map(id, items))) for items in (
            grid.rules, grid.rules_ia, grid.guarantees, grid.guarantees_ia,
        )),
    )


def touch(grid):
    grid[0] = 2
    grid.get_candidates(1).discard(2)
    grid.cached_struct("hook-only", object)
    grid.cached_rule_struct("hook-only", object)
    grid.cached_guarantee_struct("hook-only", object)
    grid._sync_candidate_index()


def test_native_inequality_merging_still_combines_and_deduplicates():
    grid = Grid(1, 3, max_elem=3)
    first = UneqRule(grid, 0, (1,))
    second = UneqRule(grid, 0, (2,))
    grid.add_rules_checked((first, second))
    rulehelper_atmostonce(grid)
    merged = [rule for rule in grid.rules if type(rule) is UneqRule]
    assert len(merged) == 1
    assert merged[0].rel_cells == {1, 2}
    assert {first, second} <= grid.rules_ia
    rulehelper_atmostonce(grid)
    assert set(grid.rules) == set(merged)
    expected = {v for v in product(range(1, 4), repeat=3) if v[0] != v[1] and v[0] != v[2]}
    assert {tuple(v) for v in solve(grid, log_level=-1)} == expected


@pytest.mark.parametrize("incremental", (False, True))
@pytest.mark.parametrize("failure", (None, RuntimeError, KeyboardInterrupt))
def test_hash_selection_discards_incidental_changes_and_preserves_queue(incremental, failure):
    grid = Grid(1, 2, max_elem=2)
    control = {"armed": False}

    class Hook(Rule):
        def __hash__(self):
            if control["armed"]:
                touch(grid)
                if failure:
                    raise failure("selection hook")
            return super().__hash__()

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    rule = Hook(grid, cells=(0, 1))
    grid.add_rule_checked(rule)
    if incremental:
        grid.take_dirty_rules()
        grid._trail_state.dirty.rule_cells.add(0)
    before = state(grid)
    dirty = grid._trail_state.dirty.copy()
    original_cache = grid._rule_cache
    outer = grid.trail_mark()
    control["armed"] = True
    try:
        if failure:
            with pytest.raises(failure, match="selection hook"):
                grid.take_dirty_rules()
        else:
            assert grid.take_dirty_rules() == (rule,)
    finally:
        control["armed"] = False
    assert state(grid) == before
    assert grid._rule_cache is original_cache
    assert "hook-only" not in original_cache
    assert grid._trail_state.candidate_masks is None
    assert [frame.token for frame in grid._trail_state.marks] == [outer]
    if failure:
        assert grid._trail_state.dirty == dirty
        assert grid.take_dirty_rules() == (rule,)
    grid.trail_undo(outer)
    assert grid._trail_state.dirty == dirty


@pytest.mark.parametrize("failure", (None, ValueError, KeyboardInterrupt))
def test_watcher_metadata_is_sandboxed_even_with_inherited_hash(failure):
    grid = Grid(1, 2, max_elem=2)
    control = {"armed": False}

    class Hook(Rule):
        def __getattribute__(self, name):
            if name == "cells" and control["armed"]:
                touch(grid)
                if failure:
                    raise failure("metadata hook")
            return super().__getattribute__(name)

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    rule = Hook(grid, cells=(0, 1))
    grid.add_rule_checked(rule)
    grid.take_dirty_rules()
    grid._trail_state.dirty.rule_cells.add(0)
    before = state(grid)
    control["armed"] = True
    try:
        if failure:
            with pytest.raises(failure, match="metadata hook"):
                grid.take_dirty_rules()
        else:
            assert grid.take_dirty_rules() == (rule,)
    finally:
        control["armed"] = False
    assert state(grid) == before
    assert not grid._trail_state.marks
    if failure:
        assert grid.take_dirty_rules() == (rule,)


@pytest.mark.parametrize("failure", (RuntimeError, KeyboardInterrupt))
def test_equality_selection_failure_does_not_consume_work(failure):
    grid = Grid(1, 2, max_elem=2)
    control = {"armed": False}
    seen = []

    class Hook(Rule):
        def __hash__(self):
            return 1

        def __eq__(self, other):
            if control["armed"] and self is not other:
                touch(grid)
                raise failure("equality hook")
            return self is other

        def apply(self, known, candidates, guarantees=None):
            seen.append(self.cells)
            return False, None, None

    grid.add_rules_checked((Hook(grid, cells=(0,)), Hook(grid, cells=(1,))))
    before = state(grid)
    control["armed"] = True
    try:
        with pytest.raises(failure, match="equality hook"):
            apply_rules(grid)
    finally:
        control["armed"] = False
    assert state(grid) == before
    assert grid._trail_state.dirty.all_rules
    apply_rules(grid)
    assert sorted(seen) == [(0,), (1,)]


@pytest.mark.parametrize("failure", (None, ValueError, KeyboardInterrupt))
def test_validation_plan_metadata_cannot_change_original_snapshot(failure):
    source = Grid(1, 2, max_elem=2)
    control = {"armed": False}

    class Hook(Rule):
        def __getattribute__(self, name):
            if name == "cells" and control["armed"]:
                touch(source)
                if failure:
                    raise failure("plan metadata")
            return super().__getattribute__(name)

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    source.add_rule_checked(Hook(source, cells=(0, 1)))
    before = state(source)
    control["armed"] = True
    try:
        if failure:
            expected = KeyboardInterrupt if failure is KeyboardInterrupt else InvalidSolutionError
            with pytest.raises(expected, match="plan metadata"):
                validate_solution(source, ImmutableGrid((1, 2), 1, 2, 2))
        else:
            validate_solution(source, ImmutableGrid((1, 2), 1, 2, 2))
    finally:
        control["armed"] = False
    assert state(source) == before
    assert _PROTECTED_SOURCES.get() == ()


@pytest.mark.parametrize("api", ("single", "set", "solve"))
@pytest.mark.parametrize("lazy", (False, True))
def test_captured_source_resets_between_hooks_and_validates_original_puzzle(api, lazy):
    source = Grid(1, 2, max_elem=2)
    seen = []

    class Hook(Rule):
        def apply(self, known, candidates, guarantees=None):
            seen.append(source.known)
            if not lazy:
                touch(source)
                return False, None, None

            def outputs():
                touch(source)
                yield from ()
            return False, None, outputs()

    source.add_rule_checked(Hook(source, cells=(0, 1)))
    before = state(source)
    expected = {ImmutableGrid(values, 1, 2, 2) for values in product((1, 2), repeat=2)}
    if api == "single":
        for solution in expected:
            validate_solution(source, solution)
    elif api == "set":
        validate_solutions(source, expected)
    else:
        assert solve(source, log_level=-1) == expected
    assert seen and all(values == (0, 0) for values in seen)
    assert state(source) == before
    assert _PROTECTED_SOURCES.get() == ()


@pytest.mark.parametrize("failure", (None, RuntimeError, KeyboardInterrupt))
def test_solve_protects_captured_source_and_nested_outer_trail(failure):
    source = Grid(1, 2, max_elem=2)

    class Hook(Rule):
        def apply(self, known, candidates, guarantees=None):
            touch(source)
            source.add_gtee_checked(Guarantee(2, frozenset({0}), 1, 2))
            source.add_rule_checked(ElementsAtMostOnce(source, cells=(0, 1)))
            if failure:
                raise failure("solve hook")
            candidates[0].intersection_update({1})
            return False, None, None

    source.add_rule_checked(Hook(source, cells=(0, 1)))
    before = state(source)
    caches = source._struct_cache, source._rule_cache, source._guarantee_cache
    dirty = source._trail_state.dirty.copy()
    outer = source.trail_mark()
    if failure:
        with pytest.raises(failure, match="solve hook"):
            solve(source, log_level=-1)
    else:
        assert {tuple(solution) for solution in solve(source, log_level=-1)} == {(1, 1), (1, 2)}
    assert state(source) == before
    assert source._trail_state.dirty == dirty
    assert all(left is right for left, right in zip(caches, (
        source._struct_cache, source._rule_cache, source._guarantee_cache,
    ), strict=True))
    assert [frame.token for frame in source._trail_state.marks] == [outer]
    assert _PROTECTED_SOURCES.get() == ()
    source.trail_undo(outer)


@pytest.mark.parametrize("failure", (None, RuntimeError, KeyboardInterrupt))
def test_subclass_copy_hook_cannot_mutate_the_caller(failure):
    class CopyHookGrid(Grid):
        def _copy_extra_state_to(self, result):
            touch(self)
            if failure:
                raise failure("copy hook")

    source = CopyHookGrid(1, 2, max_elem=2)
    before = state(source)
    if failure:
        with pytest.raises(failure, match="copy hook"):
            solve(source, log_level=-1)
    else:
        assert len(solve(source, log_level=-1)) == 4
    assert state(source) == before
    assert _PROTECTED_SOURCES.get() == ()


def test_native_rules_keep_the_non_sandbox_solve_path(monkeypatch):
    source = Grid(1, 2, max_elem=2)
    source.add_rule_checked(ElementsAtMostOnce(source, cells=(0, 1)))

    def no_sandbox(*args, **kwargs):
        raise AssertionError("Native solve should not enter an extension sandbox")

    monkeypatch.setattr(Grid, "_extension_sandbox", no_sandbox)
    assert {tuple(solution) for solution in solve(source, log_level=-1)} == {(1, 2), (2, 1)}


class _PickleHookRule(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, None, None


def test_extension_selection_marker_survives_clone_and_pickle():
    source = Grid(1, 2, max_elem=2)
    source.add_rule_checked(_PickleHookRule(source, cells=(0, 1)))
    for copied in (source.deepcopy(), pickle.loads(pickle.dumps(source))):
        assert copied._has_extension_rules
        assert len(copied.take_dirty_rules()) == 1


def test_malformed_rule_still_uses_the_validation_error_contract():
    source = Grid(1, 1, max_elem=1)
    source.rules = [object()]
    with pytest.raises(InvalidSolutionError, match="Malformed rule"):
        validate_solution(source, ImmutableGrid((1,), 1, 1, 1))
    assert not source._trail_state.marks


@pytest.mark.parametrize("kind", ("metadata", "rejection", "guarantee"))
def test_validation_errors_never_reinvoke_constraint_repr(kind):
    source = Grid(1, 1, max_elem=1)

    class BrokenRepr(Rule):
        def __repr__(self):
            raise AssertionError("diagnostics must not invoke extension repr")

        def apply(self, known, candidates, guarantees=None):
            candidates[0].clear()
            return False, None, None

    rule = BrokenRepr(source, cells=(0,))
    if kind == "metadata":
        rule.cells = (2,)
        source.rules = [rule]
    elif kind == "guarantee":
        source.guarantees = [rule]
    else:
        source.add_rule_checked(rule)
    with pytest.raises(InvalidSolutionError):
        validate_solution(source, ImmutableGrid((1,), 1, 1, 1))
    assert not source._trail_state.marks
    assert _PROTECTED_SOURCES.get() == ()
