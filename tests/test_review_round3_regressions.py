"""Regression coverage for the source-owner and branch-metadata lifecycle.

Run in a checkout with its declared Python 3.14+ runtime:
    python -X dev -m pytest -q tests/test_review_round3_regressions.py

Seven of the original nine cases failed on the reviewed commit 90985e0. No production code is
patched, no checks are mocked out, and the worker tests invoke the production
initializer/branch functions without creating unmanaged child processes.
"""

from itertools import product
import pickle

import pytest

from gridsolver.abstract_grids.extension_scope import _PROTECTED_SOURCES
from gridsolver.abstract_grids.grid import Grid, TechniqueProfile
from gridsolver.rules.rules import Rule
from gridsolver.solver import solve_parallel as parallel
from gridsolver.solver.solver import solve
from gridsolver.solver.validation import validation_context


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
    actual = {tuple(solution) for solution in solve(source, log_level=-1)}
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
    assert {tuple(solution) for solution in solve(source, log_level=-1)} == set(
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
