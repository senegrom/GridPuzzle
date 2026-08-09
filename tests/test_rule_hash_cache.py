import base64
import pickle
import subprocess
import sys

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.rules import rules as rules_module
from gridsolver.rules.sumrules import (
    DiffRule,
    DivRule,
    ProdRule,
    SumAndElementsAtMostOnce,
    SumRule,
)
from gridsolver.rules.uneq import DiffGe2Rule, IneqRule, UneqRule
from gridsolver.rules.unique import ElementsAtLeastOnce, ElementsAtMostOnce


def _rules():
    grid = Grid(2, max_elem=4)
    return (
        ElementsAtMostOnce(grid, cells=[0, 1]),
        ElementsAtLeastOnce(grid, cells=[0, 1, 2, 3]),
        IneqRule(grid, gt_cell=1, lt_cell=0),
        UneqRule(grid, origin_cell=0, rel_cells=[1, 2]),
        DiffGe2Rule(grid, origin_cell=0, rel_cells=[1, 2]),
        SumRule(grid, cells=[0, 1], mysum=3),
        DiffRule(grid, cells=[0, 1], target=1),
        ProdRule(grid, cells=[0, 1], target=2),
        DivRule(grid, cells=[0, 1], target=2),
        SumAndElementsAtMostOnce(grid, cells=[0, 1], mysum=3),
    )


def _hash_in_fresh_interpreter(rule) -> int:
    payload = base64.b64encode(
        pickle.dumps(rule, protocol=pickle.HIGHEST_PROTOCOL)
    ).decode("ascii")
    code = (
        "import base64, pickle; "
        f"obj = pickle.loads(base64.b64decode({payload!r})); "
        "print(hash(obj))"
    )
    return int(
        subprocess.check_output(
            [sys.executable, "-c", code],
            text=True,
        ).strip()
    )


def test_repeated_base_hash_uses_the_cached_value(monkeypatch):
    rule = ElementsAtMostOnce(Grid(2), cells=[0, 1])
    first = hash(rule)

    assert rule._base_hash_cache == first
    assert rule._frozen

    def fail(rule_type):
        raise AssertionError("cached hashes must not rebuild the type tag")

    monkeypatch.setattr(rules_module, "_stable_rule_type_tag", fail)
    assert hash(rule) == first


def test_unfrozen_injected_cache_is_ignored_and_overwritten():
    grid = Grid(2)
    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    equivalent = ElementsAtMostOnce(grid, cells=[0, 1])
    rule._base_hash_cache = 1

    assert not rule._frozen
    assert hash(rule) == hash(equivalent)
    assert rule._frozen
    assert rule._base_hash_cache != 1


@pytest.mark.parametrize("rule", _rules())
def test_rule_hashes_are_stable_across_fresh_processes(rule):
    # Serialize before the first hash so the child must compute its own cache.
    child_hash = _hash_in_fresh_interpreter(rule)
    assert child_hash == hash(rule)


@pytest.mark.parametrize("rule", _rules())
def test_cached_rule_hash_survives_pickle_round_trip(rule):
    expected = hash(rule)
    restored = pickle.loads(
        pickle.dumps(rule, protocol=pickle.HIGHEST_PROTOCOL)
    )

    assert restored == rule
    assert restored._base_hash_cache == rule._base_hash_cache
    assert hash(restored) == expected
    with pytest.raises(AttributeError, match="immutable"):
        restored.cells = (0,)


def test_pre_hash_mutation_is_reflected_then_frozen():
    grid = Grid(2)
    rule = SumRule(grid, cells=[0, 1], mysum=3)
    rule.sum = 4
    equivalent = SumRule(grid, cells=[0, 1], mysum=4)

    assert hash(rule) == hash(equivalent)
    assert rule == equivalent
    with pytest.raises(AttributeError, match="immutable"):
        rule.sum = 5
