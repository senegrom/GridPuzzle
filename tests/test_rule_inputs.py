import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules.rules import Guarantee
from gridsolver.rules.sumrules import SumRule
from gridsolver.rules.unique import ElementsAtMostOnce


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
