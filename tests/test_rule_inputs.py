import pickle

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.sumrules import SumAndElementsAtMostOnce, SumRule
from gridsolver.rules.uneq import DiffGe2Rule, UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.propagation import apply_rules


@pytest.mark.parametrize(
    "cells, message",
    [
        ([0, 4], "outside 0..3"),
        ([-1, 0], "outside 0..3"),
        ([(0, 0), (2, 0)], "outside a 2x2 grid"),
        ([(0, 0), (0, 2)], "outside a 2x2 grid"),
    ],
)
def test_rule_rejects_any_out_of_grid_cell_instead_of_dropping_it(cells, message):
    grid = Grid(2)

    with pytest.raises(ValueError, match=message):
        ElementsAtMostOnce(grid, cells=cells)


def test_rule_cell_creator_rejects_a_partially_out_of_grid_result():
    grid = Grid(2)

    with pytest.raises(ValueError, match="outside 0..3"):
        ElementsAtMostOnce(
            grid,
            cell_creator=lambda rule: [0, 1, 4],
        )


def test_arithmetic_rule_does_not_silently_weaken_an_invalid_cage():
    grid = Grid(2)

    with pytest.raises(ValueError, match="outside 0..3"):
        SumRule(grid, cells=[0, 4], mysum=3)

    assert all(
        not isinstance(rule, SumRule)
        for rule in grid.rules
    )


@pytest.mark.parametrize("rule_cls", [UneqRule, DiffGe2Rule])
@pytest.mark.parametrize(
    "origin_cell, related_cells",
    [
        ((0, 0), [(-1, 0), (0, -1), (0, 1), (1, 0)]),
        (0, [-1, 4, 1, 2]),
    ],
)
def test_relation_rule_clips_outside_related_neighbours(
    rule_cls,
    origin_cell,
    related_cells,
):
    grid = Grid(2)

    rule = rule_cls(
        grid,
        origin_cell=origin_cell,
        rel_cells=related_cells,
    )

    assert rule.origin_cell == 0
    assert rule.rel_cells == frozenset({1, 2})
    assert rule.cells == (0, 1, 2)


@pytest.mark.parametrize("rule_cls", [UneqRule, DiffGe2Rule])
def test_relation_rule_still_rejects_an_outside_origin(rule_cls):
    grid = Grid(2)

    with pytest.raises(ValueError, match="outside a 2x2 grid"):
        rule_cls(grid, origin_cell=(-1, 0), rel_cells=[(0, 0)])


@pytest.mark.parametrize("rule_cls", [UneqRule, DiffGe2Rule])
def test_relation_rule_rejects_a_neighbourhood_entirely_outside_grid(rule_cls):
    grid = Grid(2)

    with pytest.raises(ValueError, match="no related cells inside the grid"):
        rule_cls(
            grid,
            origin_cell=(0, 0),
            rel_cells=[(-1, 0), (0, -1)],
        )


@pytest.mark.parametrize("rule_cls", [UneqRule, DiffGe2Rule])
def test_relation_rule_does_not_clip_malformed_or_mixed_related_cells(rule_cls):
    grid = Grid(2)

    with pytest.raises(TypeError, match="Invalid rule coordinate"):
        rule_cls(
            grid,
            origin_cell=(0, 0),
            rel_cells=[(-1, 0), "not-a-coordinate"],
        )
    with pytest.raises(TypeError, match="must not mix integer and coordinate forms"):
        rule_cls(grid, origin_cell=0, rel_cells=[4, (0, 1)])


def test_bulk_rule_extension_is_atomic_when_a_later_rule_is_invalid():
    grid = Grid(2)
    before_rules = grid.rules.copy()
    before_cache = grid._struct_cache

    with pytest.raises(ValueError, match="outside 0..3"):
        grid.ext_rules(
            ElementsAtMostOnce,
            kwargs_list=[
                {"cells": [0, 1]},
                {"cells": [2, 4]},
            ],
        )

    assert grid.rules == before_rules
    assert grid._struct_cache is before_cache


@pytest.mark.parametrize(
    "guarantee, error, message",
    [
        ((1, frozenset({0}), 2, 2), TypeError, "Guarantee instances"),
        (Guarantee(True, frozenset({0}), 2, 2), TypeError, "values must be integers"),
        (Guarantee(0, frozenset({0}), 2, 2), ValueError, "outside 1..2"),
        (Guarantee(3, frozenset({0}), 2, 2), ValueError, "outside 1..2"),
        (Guarantee(1, frozenset({0}), True, 2), TypeError, "rows must be an integer"),
        (Guarantee(1, frozenset({0}), 2, 3), ValueError, "do not match"),
        (Guarantee(1, frozenset(), 2, 2), ValueError, "must not be empty"),
        (Guarantee(1, frozenset({True}), 2, 2), TypeError, "cells must be integers"),
        (Guarantee(1, frozenset({4}), 2, 2), ValueError, "outside 0..3"),
    ],
)
def test_guarantee_inputs_are_validated_before_mutation(
    guarantee,
    error,
    message,
):
    grid = Grid(2)
    struct_cache = grid.cached_struct("sentinel", object)
    guarantee_cache = grid.cached_guarantee_struct("sentinel", object)
    struct_mapping = grid._struct_cache
    guarantee_mapping = grid._guarantee_cache
    mark = grid.trail_mark()

    with pytest.raises(error, match=message):
        grid.add_gtee_checked(guarantee)

    assert not grid.guarantees
    assert not grid.guarantees_ia
    assert not grid._trail_state.entries
    assert grid._struct_cache is struct_mapping
    assert grid._guarantee_cache is guarantee_mapping
    assert grid._struct_cache["sentinel"] is struct_cache
    assert grid._guarantee_cache["sentinel"] is guarantee_cache
    grid.trail_undo(mark)


def test_guarantee_is_canonicalised_and_rolls_back_transactionally():
    grid = Grid(2)
    source = Guarantee(1, [0, 1, 1], 2, 2)
    expected = Guarantee(1, frozenset({0, 1}), 2, 2)
    mark = grid.trail_mark()

    grid.add_gtee_checked(source)

    assert grid.guarantees == {expected}
    assert grid._trail_state.entries[-1] == ("gt+", expected)

    grid.trail_undo(mark)
    assert not grid.guarantees
    assert not grid.guarantees_ia
    assert not grid._trail_state.entries


def test_kenken_rejects_unused_definitions_atomically_and_is_retryable():
    grid = Kenken(n=2)
    before_rules = grid.rules.copy()

    with pytest.raises(ValueError, match="Unused KenKen"):
        grid.load_with_dic(
            "aabb",
            {
                "a": ("+", 3),
                "b": ("+", 3),
                "z": ("+", 1),
            },
        )

    assert not grid.has_been_filled
    assert grid.rules == before_rules

    grid.load_with_dic("aabb", {"a": ("+", 3), "b": ("+", 3)})
    assert grid.has_been_filled


def test_killer_rejects_unused_definitions_atomically_and_is_retryable():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    before_rules = grid.rules.copy()
    layout = "aaaabbbbccccdddd"

    with pytest.raises(ValueError, match="Unused Killer Sudoku"):
        grid.load_with_dic(
            layout,
            {"a": 10, "b": 10, "c": 10, "d": 10, "z": 1},
        )

    assert not grid.has_been_filled
    assert grid.rules == before_rules

    grid.load_with_dic(layout, {"a": 10, "b": 10, "c": 10, "d": 10})
    assert grid.has_been_filled



def test_registered_rules_are_immutable_and_hash_stable():
    grid = Grid(2)
    rule = SumRule(grid, cells=[1, 0], mysum=3)
    grid.add_rule_checked(rule)
    original_hash = hash(rule)

    assert rule.cells == (0, 1)
    assert rule in grid.rules

    with pytest.raises(AttributeError, match="immutable"):
        rule.cells = (0,)
    with pytest.raises(AttributeError, match="immutable"):
        rule.len_cells = 1
    with pytest.raises(AttributeError, match="immutable"):
        rule.sum = 4
    with pytest.raises(TypeError):
        rule.cells[0] = 1

    assert hash(rule) == original_hash
    assert rule in grid.rules


def test_hashing_a_rule_freezes_it_even_outside_a_grid():
    rule = ElementsAtMostOnce(Grid(2), cells=[0, 1])
    original_hash = hash(rule)

    with pytest.raises(AttributeError, match="immutable"):
        rule.cells = (0, 2)

    assert hash(rule) == original_hash


def test_frozen_rules_pickle_and_cached_properties_still_work():
    grid = Grid(2)
    cage = SumAndElementsAtMostOnce(grid, cells=[0, 1], mysum=3)
    grid.add_rule_checked(cage)

    assert cage.sum_candidates == (frozenset({1, 2}),)

    restored = pickle.loads(pickle.dumps(cage))
    assert restored == cage
    assert hash(restored) == hash(cage)
    assert restored.sum_candidates == cage.sum_candidates
    with pytest.raises(AttributeError, match="immutable"):
        restored.sum = 4


@pytest.mark.parametrize(
    "target, message",
    [
        (Grid(3), "dimensions"),
        (Grid(2, 2, max_elem=3), "value domain"),
    ],
)
def test_grid_rejects_rules_for_an_incompatible_shape_or_domain(target, message):
    source = Grid(2)
    rule = ElementsAtMostOnce(source, cells=[0, 1])
    target.cached_struct("sentinel", object)
    cache = target._struct_cache
    mark = target.trail_mark()

    with pytest.raises(ValueError, match=message):
        target.add_rule_checked(rule)

    assert not target.rules
    assert not target.rules_ia
    assert not target._trail_state.entries
    assert target._struct_cache is cache
    grid_cache_value = target._struct_cache["sentinel"]
    target.trail_undo(mark)
    assert target._struct_cache["sentinel"] is grid_cache_value


def test_grid_rejects_non_rules_and_pre_registration_cell_corruption():
    grid = Grid(2)
    with pytest.raises(TypeError, match="Rule instances"):
        grid.add_rule_checked(object())

    rule = ElementsAtMostOnce(grid, cells=[0, 1])
    rule.cells = (0, 4)
    with pytest.raises(ValueError, match="outside 0..3"):
        grid.add_rule_checked(rule)

    assert not grid.rules
    assert not rule._frozen



class _StructuralOutputRule(Rule):
    __slots__ = ("replacement_rules", "replacement_guarantees")

    def __init__(
        self,
        grid,
        *,
        replacement_rules=None,
        replacement_guarantees=None,
    ):
        super().__init__(grid, cells=[0])
        self.replacement_rules = replacement_rules
        self.replacement_guarantees = replacement_guarantees

    def apply(self, known, candidates, guarantees=None):
        return False, self.replacement_rules, self.replacement_guarantees


class _CountingGrid(Grid):
    def __init__(self):
        super().__init__(2)
        self.struct_invalidations = 0
        self.guarantee_invalidations = 0

    def _invalidate_struct_cache(self):
        self.struct_invalidations += 1
        super()._invalidate_struct_cache()

    def _invalidate_guarantee_cache(self):
        self.guarantee_invalidations += 1
        super()._invalidate_guarantee_cache()


def test_rule_batch_validates_every_item_before_first_mutation():
    grid = Grid(2)
    valid = ElementsAtMostOnce(grid, cells=[0, 1])
    incompatible = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])
    cache_value = grid.cached_struct("sentinel", object)
    cache = grid._struct_cache
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match="dimensions"):
        grid.add_rules_checked((valid, incompatible))

    assert not grid.rules
    assert not grid.rules_ia
    assert not grid._trail_state.entries
    assert grid._struct_cache is cache
    assert grid._struct_cache["sentinel"] is cache_value
    grid.trail_undo(mark)


def test_guarantee_batch_validates_every_item_before_first_mutation():
    grid = Grid(2)
    valid = Guarantee(1, frozenset({0, 1}), 2, 2)
    invalid = Guarantee(3, frozenset({2, 3}), 2, 2)
    struct_value = grid.cached_struct("sentinel", object)
    guarantee_value = grid.cached_guarantee_struct("sentinel", object)
    struct_cache = grid._struct_cache
    guarantee_cache = grid._guarantee_cache
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match="outside 1..2"):
        grid.add_gtees_checked((valid, invalid))

    assert not grid.guarantees
    assert not grid.guarantees_ia
    assert not grid._trail_state.entries
    assert grid._struct_cache is struct_cache
    assert grid._guarantee_cache is guarantee_cache
    assert grid._struct_cache["sentinel"] is struct_value
    assert grid._guarantee_cache["sentinel"] is guarantee_value
    grid.trail_undo(mark)


def test_successful_batches_invalidate_each_cache_once_and_undo_exactly():
    grid = _CountingGrid()
    rules = (
        ElementsAtMostOnce(grid, cells=[0, 1]),
        ElementsAtMostOnce(grid, cells=[2, 3]),
    )
    guarantees = (
        Guarantee(1, frozenset({0, 1}), 2, 2),
        Guarantee(2, frozenset({2, 3}), 2, 2),
    )
    before = (
        grid.rules.copy(),
        grid.guarantees.copy(),
        grid._struct_cache,
        grid._guarantee_cache,
    )
    mark = grid.trail_mark()

    grid.add_rules_checked(rules)
    grid.add_gtees_checked(guarantees)

    assert grid.rules == set(rules)
    assert grid.guarantees == set(guarantees)
    assert grid.struct_invalidations == 2
    assert grid.guarantee_invalidations == 1
    assert [entry[0] for entry in grid._trail_state.entries] == [
        "rule+",
        "rule+",
        "gt+",
        "gt+",
    ]

    grid.trail_undo(mark)
    assert grid.rules == before[0]
    assert grid.guarantees == before[1]
    assert grid._struct_cache is before[2]
    assert grid._guarantee_cache is before[3]
    assert not grid._trail_state.entries


def test_rule_outputs_are_validated_before_source_deactivation():
    grid = Grid(2)
    valid = ElementsAtMostOnce(grid, cells=[1, 2])
    incompatible = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])
    source = _StructuralOutputRule(
        grid,
        replacement_rules=(valid, incompatible),
    )
    grid.add_rule_checked(source)
    cache_value = grid.cached_struct("sentinel", object)
    cache = grid._struct_cache
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match="dimensions"):
        apply_rules(grid)

    assert source in grid.rules
    assert valid not in grid.rules
    assert not grid.rules_ia
    assert not grid._trail_state.entries
    assert grid._struct_cache is cache
    assert grid._struct_cache["sentinel"] is cache_value
    grid.trail_undo(mark)


def test_invalid_guarantee_output_does_not_deactivate_satisfied_source():
    grid = Grid(2)
    invalid = Guarantee(3, frozenset({0}), 2, 2)
    source = _StructuralOutputRule(
        grid,
        replacement_rules=(),
        replacement_guarantees=(invalid,),
    )
    grid.add_rule_checked(source)
    mark = grid.trail_mark()

    with pytest.raises(ValueError, match="outside 1..2"):
        apply_rules(grid)

    assert source in grid.rules
    assert not grid.rules_ia
    assert not grid.guarantees
    assert not grid._trail_state.entries
    grid.trail_undo(mark)


def test_failed_rule_batch_does_not_freeze_the_valid_prefix():
    grid = Grid(2)
    valid = ElementsAtMostOnce(grid, cells=[0, 1])
    invalid = ElementsAtMostOnce(Grid(3), cells=[0, 1, 2])

    with pytest.raises(ValueError, match="dimensions"):
        grid.add_rules_checked((valid, invalid))

    assert not valid._frozen
    valid.cells = (0, 2)
    assert valid.cells == (0, 2)
