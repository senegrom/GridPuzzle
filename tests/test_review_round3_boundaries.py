"""Adjacent metadata consumers, serialization, and worker lifetime regressions."""

import multiprocessing
import os
from pathlib import Path
import pickle
import subprocess
import sys

import pytest

from gridsolver.abstract_grids.extension_scope import (
    _PROTECTED_SOURCES, _WORKER_SERIALIZATION, protect_source, sandbox_sources,
)
from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Rule
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce
from gridsolver.rules.uneq import IneqRule, UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver import solve_parallel as parallel
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.propagation import apply_rules
from gridsolver.solver.rulehelpers import rulehelper_house_sums, rulehelper_sum_atmostonce
from gridsolver.solver.solve_ineq_bounds import ineq_bounds
from gridsolver.solver.solver import solve
from gridsolver.solver.validation import validate_solution, validation_context


class BinaryGrid(Grid):
    technique_profile = TechniqueProfile.RULES_ONLY


class CapturedRule(Rule):
    def __init__(self, source):
        super().__init__(source, cells=(0, 1))
        self.source = source

    def apply(self, known, candidates, guarantees=None):
        if known[1]:
            self.source[0] = known[1]
        return False, None, None


class TaggedRule(CapturedRule):
    __slots__ = ("tag",)

    def __init__(self, source):
        super().__init__(source)
        self.tag = 17

    def __hash__(self):
        return hash((super().__hash__(), self.tag))

    def __eq__(self, other):
        return super().__eq__(other) and self.tag == other.tag


class SlottedGrid(BinaryGrid):
    __slots__ = ("label",)

    def __init__(self):
        super().__init__(1, 2, 2)
        self.label = "original"

    def _copy_extra_state_to(self, result):
        result.label = self.label


def source_state(grid):
    return (grid.known, tuple(map(frozenset, grid._candidates)), grid.has_been_filled)


@pytest.mark.parametrize("protocol", (2, 4, pickle.HIGHEST_PROTOCOL))
@pytest.mark.parametrize("rule_type", (CapturedRule, TaggedRule))
def test_source_owner_order_preserves_cycles_slots_hashes_and_multiple_clones(protocol, rule_type):
    source = SlottedGrid()
    rule = rule_type(source)
    source.add_rule_checked(rule)
    clone = source.deepcopy().deepcopy()
    # Dict insertion order must not be the hidden serialization contract.
    clone.__dict__["_extension_sources"] = clone.__dict__.pop("_extension_sources")
    restored = pickle.loads(pickle.dumps(clone, protocol=protocol))
    owner, = restored._extension_sources
    restored_rule, = restored.rules
    assert owner is not restored
    assert restored_rule.source is owner
    assert next(iter(owner.rules)) is restored_rule
    assert restored.label == owner.label == "original"
    assert hash(restored_rule) == hash(rule)
    assert source_state(restored) == source_state(source)
    with pytest.raises(AttributeError, match="immutable"):
        restored_rule.cells = (1,)


@pytest.mark.parametrize("failure", (None, RuntimeError, KeyboardInterrupt))
@pytest.mark.parametrize("consumer", ("branch", "houses", "visibility", "sum", "innie", "inequality"))
def test_structural_consumers_discard_metadata_writes(consumer, failure):
    source = Grid(1, 3, max_elem=3)
    armed = False
    bases = {"branch": Rule, "houses": ElementsAtMostOnce, "visibility": UneqRule,
             "sum": SumAndElementsAtMostOnce, "innie": SumAndElementsAtMostOnce,
             "inequality": IneqRule}

    class Hook(bases[consumer]):
        def __getattribute__(self, name):
            if armed and name in {"cells", "sum", "origin_cell", "rel_cells", "lt_cell", "gt_cell"}:
                source[0] = 2
                source.get_candidates(2).discard(3)
                if failure:
                    raise failure("metadata reader")
            return super().__getattribute__(name)

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    if consumer == "visibility":
        hook = Hook(source, 0, (1,))
    elif consumer == "inequality":
        hook = Hook(source, gt_cell=1, lt_cell=0)
    elif consumer in {"sum", "innie"}:
        hook = Hook(source, cells=(0, 1), mysum=3)
    else:
        hook = Hook(source, cells=(0, 1))
    source.add_rule_checked(hook)
    working = source.deepcopy()
    before = source_state(source)
    outer = source.trail_mark()
    actions = {
        "branch": working.get_smallest_candidate_set_gt1,
        "houses": lambda: working.unique_rule_cells,
        "visibility": lambda: CandidateTopology.build(working),
        "sum": lambda: rulehelper_sum_atmostonce(working),
        "innie": lambda: rulehelper_house_sums(working),
        "inequality": lambda: ineq_bounds(working),
    }
    armed = True
    try:
        if failure:
            with pytest.raises(failure, match="metadata reader"):
                actions[consumer]()
        else:
            actions[consumer]()
    finally:
        armed = False
    assert source_state(source) == before
    assert [frame.token for frame in source._trail_state.marks] == [outer]
    assert _PROTECTED_SOURCES.get() == ()
    source.trail_undo(outer)


@pytest.mark.parametrize("api", ("propagation", "validation"))
def test_metadata_is_restored_before_the_same_rule_apply_hook(api):
    source = BinaryGrid(1, 2, 2)
    armed = False
    observed = []

    class Hook(Rule):
        uses_guarantees = True

        def __getattribute__(self, name):
            if armed and name == "cells":
                source[0] = 2
            return super().__getattribute__(name)

        def apply(self, known, candidates, guarantees=None):
            observed.append(source.known)
            if source[0]:
                candidates[0].discard(1)
            return False, None, None

    source.add_rule_checked(Hook(source, cells=(0, 1)))
    armed = True
    if api == "validation":
        validate_solution(source, ImmutableGrid((1, 1), 1, 2, 2))
    else:
        with validation_context(source):
            apply_rules(source.deepcopy())
    assert observed and set(observed) == {(0, 0)}
    assert source.known == (0, 0)
    assert _PROTECTED_SOURCES.get() == ()


def test_each_emitted_validation_rule_observes_the_original_source():
    source = BinaryGrid(1, 2, 2)
    seen = []

    class Child(Rule):
        def apply(self, known, candidates, guarantees=None):
            seen.append(source.known)
            if source[0]:
                candidates[0].clear()
            return False, None, None

    class Parent(Rule):
        def apply(self, known, candidates, guarantees=None):
            source[0] = 2
            return False, (Child(source, cells=(0, 1)),), None

    source.add_rule_checked(Parent(source, cells=(0, 1)))
    validate_solution(source, ImmutableGrid((1, 1), 1, 2, 2))
    assert seen == [(0, 0)]
    assert source.known == (0, 0)


def test_nested_source_scopes_restore_before_the_outer_operation_resumes():
    source = BinaryGrid(1, 2, 2)
    with protect_source(source), sandbox_sources():
        with sandbox_sources():
            source[0] = 2
        assert source.known == (0, 0)
        assert any(owner is source for owner in _PROTECTED_SOURCES.get())
    assert _PROTECTED_SOURCES.get() == ()


def test_worker_payload_omits_source_trails_and_unpicklable_derived_caches(monkeypatch):
    source = BinaryGrid(1, 2, 2)
    source.add_rule_checked(CapturedRule(source))
    def sentinel():
        return None
    source.cached_struct("not-transferable", lambda: sentinel)
    source.cached_rule_struct("not-transferable", lambda: sentinel)
    source.cached_guarantee_struct("not-transferable", lambda: sentinel)
    original = source._struct_cache
    outer = source.trail_mark()
    with validation_context(source):
        payload = parallel._serialize_worker_root(source.deepcopy())
    assert source._struct_cache is original and original["not-transferable"] is sentinel
    assert [frame.token for frame in source._trail_state.marks] == [outer]
    monkeypatch.setattr(parallel, "_WORKER_ROOT_GRID", None)
    parallel._init_worker(payload)
    root = parallel._WORKER_ROOT_GRID
    owner = next(iter(root.rules)).source
    for item in (root, owner):
        assert not item._trail_state.marks and not item._trail_state.entries
        assert item._struct_cache == item._rule_cache == item._guarantee_cache == {}
        assert all(c._trail_state is item._trail_state for c in item._candidates)
    assert {tuple(s) for s in parallel._solve_branch((0, 1, -1))} == {(1, 1), (1, 2)}
    assert not owner._trail_state.marks
    source.trail_undo(outer)
    assert not _WORKER_SERIALIZATION.get()


def test_a_clone_can_register_an_additional_captured_owner(monkeypatch):
    source = BinaryGrid(1, 2, 2)
    source.add_rule_checked(CapturedRule(source))
    middle = source.deepcopy()
    middle.add_rule_checked(TaggedRule(middle))
    assert middle._extension_sources == (source, middle)
    monkeypatch.setattr(parallel, "_WORKER_ROOT_GRID", None)
    parallel._init_worker(parallel._serialize_worker_root(middle.deepcopy()))
    root = parallel._WORKER_ROOT_GRID
    for value in (1, 2):
        assert {tuple(s) for s in parallel._solve_branch((1, value, -1))} == {(1, value), (2, value)}
        assert all(owner.known == (0, 0) for owner in root._extension_sources)
    assert _PROTECTED_SOURCES.get() == ()


@pytest.mark.parametrize("failure", (RuntimeError, KeyboardInterrupt))
def test_worker_failure_preserves_sources_and_allows_another_task(monkeypatch, failure):
    source = BinaryGrid(1, 2, 2)
    source.add_rule_checked(CapturedRule(source))
    monkeypatch.setattr(parallel, "_WORKER_ROOT_GRID", None)
    parallel._init_worker(parallel._serialize_worker_root(source.deepcopy()))
    root = parallel._WORKER_ROOT_GRID
    owner = next(iter(root.rules)).source
    original = CapturedRule.apply

    def fail(self, known, candidates, guarantees=None):
        self.source[0] = 2
        raise failure("worker application")

    with monkeypatch.context() as patch:
        patch.setattr(CapturedRule, "apply", fail)
        with pytest.raises(failure, match="worker application"):
            parallel._solve_branch((1, 1, -1))
    assert CapturedRule.apply is original
    assert root.known == owner.known == (0, 0)
    assert not root._trail_state.marks and not owner._trail_state.marks
    assert {tuple(s) for s in parallel._solve_branch((1, 2, -1))} == {(1, 2), (2, 2)}
    assert _PROTECTED_SOURCES.get() == ()


def test_serialization_failure_resets_its_context_and_caller():
    source = BinaryGrid(1, 2, 2)
    source.add_rule_checked(CapturedRule(source))
    def unpicklable():
        return None

    source.unpicklable_extension_field = unpicklable
    with pytest.raises((AttributeError, pickle.PicklingError)):
        parallel._serialize_worker_root(source.deepcopy())
    assert not _WORKER_SERIALIZATION.get()
    assert _PROTECTED_SOURCES.get() == ()
    assert not source._trail_state.marks


@pytest.mark.parametrize("method", [name for name in ("spawn", "forkserver") if name in multiprocessing.get_all_start_methods()])
@pytest.mark.parametrize("cap", (-1, 1, 3), ids=("all", "cap1", "cap3"))
def test_real_workers_match_oracle_and_preserve_captured_sources(method, cap, tmp_path):
    root = Path(__file__).resolve().parents[1]
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(root)
    result = subprocess.run(
        [sys.executable, str(root / "tests" / "review_round3_worker_probe.py"), method, str(cap)],
        cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "worker source isolation verified" in result.stdout


def test_native_clone_does_not_retain_its_source():
    source = Grid(1, 2, 2)
    source.add_rule_checked(ElementsAtMostOnce(source, cells=(0, 1)))
    assert source.deepcopy()._extension_sources == ()
    assert {tuple(s) for s in solve(source, log_level=-1)} == {(1, 2), (2, 1)}
