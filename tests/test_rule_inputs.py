import pytest

from gridsolver.abstract_grids.grid import Grid
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
