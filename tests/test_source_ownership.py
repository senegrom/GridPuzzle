"""Captured source grids and their owners survive clones, pickling and workers.

An extension rule may capture the grid it was built for. Clones, pickles and
worker payloads keep that ownership, structural consumers discard metadata
writes, nested source scopes restore in order, and worker tasks isolate a
captured source between DFS siblings and between tasks. The worker tests
call the production initializer and branch functions in process, except
the real spawn/forkserver check, which runs source_ownership_worker_probe.py.
"""

import multiprocessing
import os
import pickle
import subprocess
import sys
from itertools import product
from pathlib import Path

import pytest

from gridsolver.abstract_grids.extension_scope import _PROTECTED_SOURCES, _WORKER_SERIALIZATION, protect_source, sandbox_sources
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
from gridsolver.solver.solver import QUIET, solve
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
        [sys.executable, str(root / "tests" / "source_ownership_worker_probe.py"), method, str(cap)],
        cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "worker source isolation verified" in result.stdout


def test_native_clone_does_not_retain_its_source():
    source = Grid(1, 2, 2)
    source.add_rule_checked(ElementsAtMostOnce(source, cells=(0, 1)))
    assert source.deepcopy()._extension_sources == ()
    assert {tuple(s) for s in solve(source, log_level=QUIET)} == {(1, 2), (2, 1)}


class _RulesOnlyGrid(Grid):
    technique_profile = TechniqueProfile.RULES_ONLY


class _CapturedSourceRule(Rule):
    """An ordinary, module-level, picklable rule holding its source grid."""

    def __init__(self, source):
        super().__init__(source, cells=(0, 1))
        self.source = source

    def apply(self, known, candidates, guarantees=None):
        return False, None, None


class _CapturedWriteRule(_CapturedSourceRule):
    """A hook whose incidental source writes must be rolled back."""

    def __hash__(self):
        # A valid metadata-independent hash makes the payload round-trip so
        # worker isolation can be tested independently of the cyclic-pickle bug.
        return 42

    def apply(self, known, candidates, guarantees=None):
        if known[1]:
            self.source[0] = known[1]
        return False, None, None


def _source(rule_class):
    source = _RulesOnlyGrid(1, 2, max_elem=2)
    source.add_rule_checked(rule_class(source))
    return source


@pytest.mark.parametrize("profile", tuple(TechniqueProfile))
def test_branch_metadata_cannot_silently_remove_valid_completions(profile):
    class ProfileGrid(Grid):
        technique_profile = profile

    source = ProfileGrid(1, 3, max_elem=2)
    armed = False
    observed = []

    class IncidentalMetadata(Rule):
        def __getattribute__(self, name):
            if armed and name == "cells":
                # The registered metadata is unchanged; only an incidental
                # mutation through the Grid-managed API is performed.
                source[0] = 2
            return super().__getattribute__(name)

        def apply(self, known, candidates, guarantees=None):
            return False, None, None

    class ReadsOriginalGiven(Rule):
        def apply(self, known, candidates, guarantees=None):
            observed.append(source.known)
            if source[0]:
                candidates[2].discard(source[0])
            return False, None, None

    source.add_rules_checked((
        IncidentalMetadata(source, cells=(0, 1)),
        ReadsOriginalGiven(source, cells=(0, 2)),
    ))
    armed = True
    actual = {tuple(solution) for solution in solve(source, log_level=QUIET)}
    expected = set(product((1, 2), repeat=3))
    assert source.known == (0, 0, 0)
    assert _PROTECTED_SOURCES.get() == ()
    assert actual == expected, (
        f"Missing {sorted(expected - actual)}; hooks saw {set(observed)}"
    )


def test_original_source_with_a_captured_rule_is_picklable():
    source = _source(_CapturedSourceRule)
    restored = pickle.loads(pickle.dumps(source))
    assert next(iter(restored.rules)).source is restored
    assert restored.known == (0, 0)


def test_api_clone_preserves_picklability_of_captured_source_rules():
    source = _source(_CapturedSourceRule)
    # Establish that the input is genuinely picklable before cloning it.
    pickle.loads(pickle.dumps(source))
    clone = source.deepcopy()
    restored = pickle.loads(pickle.dumps(clone))
    assert restored.known == (0, 0)
    assert len(restored.rules) == 1


def test_sequential_solver_discards_captured_source_writes():
    source = _source(_CapturedWriteRule)
    assert {tuple(solution) for solution in solve(source, log_level=QUIET)} == set(
        product((1, 2), repeat=2)
    )
    assert source.known == (0, 0)
    assert _PROTECTED_SOURCES.get() == ()


def _initialize_worker(monkeypatch):
    source = _source(_CapturedWriteRule)
    # Match public solve's protected source and cloned worker-payload lifecycle.
    with validation_context(source):
        payload = pickle.dumps(source.deepcopy(), protocol=pickle.HIGHEST_PROTOCOL)
    assert _PROTECTED_SOURCES.get() == ()
    pickle.loads(payload)  # This case deliberately avoids the pickle failure.
    monkeypatch.setattr(parallel, "_WORKER_ROOT_GRID", None)
    parallel._init_worker(payload)
    return parallel._WORKER_ROOT_GRID


@pytest.mark.parametrize("branch_value", (1, 2))
def test_worker_search_isolates_captured_source_between_dfs_siblings(
    monkeypatch, branch_value,
):
    _initialize_worker(monkeypatch)
    actual = {tuple(solution) for solution in parallel._solve_branch(
        (0, branch_value, -1)
    )}
    assert actual == {(branch_value, 1), (branch_value, 2)}
    assert _PROTECTED_SOURCES.get() == ()


def test_worker_task_does_not_poison_the_next_task(monkeypatch):
    root = _initialize_worker(monkeypatch)
    captured = next(iter(root.rules)).source
    assert captured.known == (0, 0)
    first = {tuple(solution) for solution in parallel._solve_branch((1, 1, -1))}
    assert first == {(1, 1), (2, 1)}
    assert captured.known == (0, 0), "Captured source leaked into the worker root"
    second = {tuple(solution) for solution in parallel._solve_branch((1, 2, -1))}
    assert second == {(1, 2), (2, 2)}
