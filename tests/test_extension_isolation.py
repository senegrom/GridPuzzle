"""Custom (extension) rules cannot corrupt the solver, the caller or each other.

Rule selection, watcher and validation metadata written by extension hooks
is sandboxed and rolled back; lazy rule and guarantee outputs are validated
after they are consumed; failures inside hooks, including KeyboardInterrupt,
preserve pending work and the parent's caches; native rules keep the fast
path that needs no sandbox.
"""

import pickle
from itertools import product

import pytest

from gridsolver.abstract_grids.extension_scope import _PROTECTED_SOURCES
from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee, InvalidGrid, Rule
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules
from gridsolver.solver.rulehelpers import rulehelper_atmostonce
from gridsolver.solver.solver import QUIET, solve
from gridsolver.solver.validation import InvalidSolutionError, validate_solution, validate_solutions
from gridsolver.util import peek


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
    assert {tuple(v) for v in solve(grid, log_level=QUIET)} == expected


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
        assert solve(source, log_level=QUIET) == expected
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
            solve(source, log_level=QUIET)
    else:
        assert {tuple(solution) for solution in solve(source, log_level=QUIET)} == {(1, 1), (1, 2)}
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
            solve(source, log_level=QUIET)
    else:
        assert len(solve(source, log_level=QUIET)) == 4
    assert state(source) == before
    assert _PROTECTED_SOURCES.get() == ()


def test_native_rules_keep_the_non_sandbox_solve_path(monkeypatch):
    source = Grid(1, 2, max_elem=2)
    source.add_rule_checked(ElementsAtMostOnce(source, cells=(0, 1)))

    def no_sandbox(*args, **kwargs):
        raise AssertionError("Native solve should not enter an extension sandbox")

    monkeypatch.setattr(Grid, "_extension_sandbox", no_sandbox)
    assert {tuple(solution) for solution in solve(source, log_level=QUIET)} == {(1, 2), (2, 1)}


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


class _OrderedUneq(UneqRule):
    """A UneqRule extension additionally requiring origin < related."""
    def apply(self, known, candidates, guarantees=None):
        first = known[self.origin_cell]
        second = known[next(iter(self.rel_cells))]
        if first and second and first >= second:
            raise InvalidGrid("The first cell must be smaller")
        return super().apply(known, candidates, guarantees)


def _ordered_grid():
    grid = Grid(1, 3, max_elem=3)
    custom = _OrderedUneq(grid, origin_cell=0, rel_cells=(1,))
    grid.add_rules_checked((custom, UneqRule(grid, origin_cell=0, rel_cells=(2,))))
    return grid, custom


def test_unequal_union_retains_custom_rule_semantics():
    grid, custom = _ordered_grid()
    rulehelper_atmostonce(grid)
    assert custom in grid.rules
    assert custom not in grid.rules_ia


def test_full_solve_returns_the_six_ordered_solutions():
    grid, _ = _ordered_grid()
    expected = {
        values for values in product(range(1, 4), repeat=3)
        if values[0] < values[1] and values[0] != values[2]
    }
    assert len(expected) == 6
    actual = {tuple(solution) for solution in solve(grid, log_level=QUIET)}
    assert actual == expected


@pytest.mark.parametrize("error_type", (RuntimeError, KeyboardInterrupt))
def test_dirty_rule_selection_failure_preserves_pending_work(error_type):
    grid = Grid(1, 1, max_elem=2)
    armed = [False]
    applied = []

    class TemporaryHashFailure(Rule):
        def __hash__(self):
            if armed[0]:
                raise error_type("temporary hash failure")
            return super().__hash__()

        def apply(self, known, candidates, guarantees=None):
            applied.append(True)
            candidates[0].intersection_update({2})
            return False, None, None

    grid.add_rule_checked(TemporaryHashFailure(grid, cells=(0,)))
    armed[0] = True
    try:
        with pytest.raises(error_type, match="temporary hash failure"):
            apply_rules(grid)
    finally:
        armed[0] = False
    assert applied == []
    apply_rules(grid)
    assert applied == [True]
    assert grid.get_candidates(0) == {2}


@pytest.mark.parametrize("error_type", (RuntimeError, KeyboardInterrupt))
def test_selection_hook_mutations_are_rolled_back(error_type):
    grid = Grid(1, 1, max_elem=2)
    armed = [False]

    class MutatingHash(Rule):
        def __hash__(self):
            if armed[0]:
                grid.get_candidates(0).discard(2)
                raise error_type("selection interrupted")
            return super().__hash__()

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    grid.add_rule_checked(MutatingHash(grid, cells=(0,)))
    before = grid.get_candidates(0).copy()
    armed[0] = True
    try:
        with pytest.raises(error_type, match="selection interrupted"):
            apply_rules(grid)
    finally:
        armed[0] = False
    assert grid.get_candidates(0) == before
    assert not grid._trail_state.marks


@pytest.mark.parametrize("mutation", ("given", "candidate"))
@pytest.mark.parametrize("error_type", (None, RuntimeError, KeyboardInterrupt))
def test_final_validation_preserves_captured_source_grid(mutation, error_type):
    grid = Grid(1, 1, max_elem=2)

    class CapturedSourceMutation(Rule):
        def apply(self, known, candidates, guarantees=None):
            if mutation == "given":
                grid[0] = 2
            else:
                grid.get_candidates(0).discard(2)
            if error_type is not None:
                raise error_type("validation hook interrupted")
            return False, None, None

    grid.add_rule_checked(CapturedSourceMutation(grid, cells=(0,)))
    before = (grid.known, grid.get_candidates(0).copy(), grid.has_been_filled)
    solution = ImmutableGrid((1,), rows=1, cols=1, max_elem=2)
    if error_type is None:
        validate_solution(grid, solution)
    else:
        expected_error = KeyboardInterrupt if error_type is KeyboardInterrupt else InvalidSolutionError
        with pytest.raises(expected_error, match="validation hook interrupted"):
            validate_solution(grid, solution)
    after = (grid.known, grid.get_candidates(0).copy(), grid.has_been_filled)
    assert after == before
    assert not grid._trail_state.marks


@pytest.mark.parametrize("error", [None, RuntimeError, KeyboardInterrupt])
@pytest.mark.parametrize("cache", ["weak", "strong", "struct"])
def test_extension_iterator_preserves_nested_parent_caches(error, cache):
    grid = Grid(1, 2, max_elem=2)

    def cached():
        if cache == "weak":
            return grid.weak_links[0]
        if cache == "strong":
            return grid.semi_strong_links[1][0]
        return grid.cached_struct("review_nested", lambda: {"items": [set()]})["items"][0]

    original = cached()
    dictionaries = grid._struct_cache, grid._rule_cache, grid._guarantee_cache

    def emitted_rules():
        cached().add(1)
        if error is not None:
            raise error("extension interrupted")
        yield from ()

    if error is None:
        grid.add_rules_checked(emitted_rules())
    else:
        with pytest.raises(error, match="extension interrupted"):
            grid.add_rules_checked(emitted_rules())
    assert cached() is original
    assert original == set()
    assert all(before is after for before, after in zip(
        dictionaries,
        (grid._struct_cache, grid._rule_cache, grid._guarantee_cache),
        strict=True,
    ))
    assert not grid._trail_state.marks


def test_nested_sandbox_restores_each_parent_cache_without_copy_hooks():
    grid = Grid(1, 2, max_elem=2)

    class NoCopy:
        def __deepcopy__(self, memo):
            raise AssertionError("Sandbox must not invoke arbitrary copy hooks")

    sentinel = NoCopy()
    grid.cached_struct("sentinel", lambda: sentinel)
    original = grid.weak_links
    with grid._extension_sandbox():
        outer = grid.weak_links
        outer[0].add(1)
        with grid._extension_sandbox():
            grid.weak_links[0].add(0)
        assert grid.weak_links is outer
        assert outer[0] == {1}
    assert grid.weak_links is original
    assert original[0] == set()
    assert grid._struct_cache["sentinel"] is sentinel


@pytest.mark.parametrize("error", [None, RuntimeError, KeyboardInterrupt])
def test_rule_application_cannot_mutate_parent_cached_links(error):
    grid = Grid(1, 2, max_elem=2)

    class Hook(Rule):
        def apply(self, known, candidates, guarantees=None):
            grid.weak_links[0].add(1)
            if error is not None:
                raise error("application interrupted")
            return False, None, None

    grid.add_rule_checked(Hook(grid, cells=(0,)))
    original = grid.weak_links
    if error is None:
        apply_rules(grid)
    else:
        with pytest.raises(error, match="application interrupted"):
            apply_rules(grid)
    assert grid.weak_links is original
    assert original[0] == set()
    assert not grid._trail_state.marks


@pytest.mark.parametrize("output_kind", ["rules", "guarantees"])
@pytest.mark.parametrize("mutation", ["known", "candidates"])
def test_validation_checks_state_after_lazy_outputs(output_kind, mutation):
    grid = Grid(1, 1, max_elem=1)

    class LazyMutation(Rule):
        def apply(self, known, candidates, guarantees=None):
            def outputs():
                if mutation == "known":
                    known[0] = 0
                else:
                    candidates[0].clear()
                yield from ()
            if output_kind == "rules":
                return False, outputs(), None
            return False, None, outputs()

    grid.add_rule_checked(LazyMutation(grid, cells=(0,)))
    solution = ImmutableGrid((1,), rows=1, cols=1, max_elem=1)
    with pytest.raises(InvalidSolutionError):
        validate_solution(grid, solution)


def test_validation_checks_state_after_guarantee_metadata_iteration():
    grid = Grid(1, 1, max_elem=1)

    class LazyMetadata(Rule):
        def apply(self, known, candidates, guarantees=None):
            def cells():
                candidates[0].clear()
                yield 0
            return False, None, (Guarantee(1, cells(), 1, 1),)

    grid.add_rule_checked(LazyMetadata(grid, cells=(0,)))
    with pytest.raises(InvalidSolutionError):
        validate_solution(grid, ImmutableGrid((1,), 1, 1, 1))


def test_validation_checks_parent_after_child_metadata_hooks():
    grid = Grid(1, 1, max_elem=1)

    class Root(Rule):
        def apply(self, known, candidates, guarantees=None):
            class Child(Rule):
                def __getattribute__(self, name):
                    if name == "cells" and getattr(self, "armed", False):
                        candidates[0].clear()
                    return super().__getattribute__(name)

                def apply(self, known, candidates, guarantees=None):
                    return False, None, None

            child = Child(grid, cells=(0,))
            # Construction must not trigger the mutation: it needs to occur
            # later, when validation reads the emitted child's metadata.
            child.armed = True
            return False, (child,), None

    grid.add_rule_checked(Root(grid, cells=(0,)))
    with pytest.raises(InvalidSolutionError):
        validate_solution(grid, ImmutableGrid((1,), 1, 1, 1))


@pytest.mark.parametrize("emit_guarantee", [False, True])
def test_valid_lazy_outputs_remain_supported(emit_guarantee):
    grid = Grid(1, 1, max_elem=1)

    class Valid(Rule):
        def apply(self, known, candidates, guarantees=None):
            output = (Guarantee(1, frozenset({0}), 1, 1),) if emit_guarantee else ()
            return False, iter(()), iter(output)

    grid.add_rule_checked(Valid(grid, cells=(0,)))
    validate_solution(grid, ImmutableGrid((1,), 1, 1, 1))


def test_peek_consumes_only_the_first_item_eagerly():
    seen = []

    def source():
        for value in range(3):
            seen.append(value)
            yield value

    first, replay = peek(source())
    assert first == 0
    assert seen == [0]
    assert list(replay) == [0, 1, 2]
