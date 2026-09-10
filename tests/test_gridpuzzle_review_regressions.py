"""Regression coverage for extension cache and lazy-output isolation."""

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.solver.propagation import apply_rules
from gridsolver.solver.validation import InvalidSolutionError, validate_solution


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
