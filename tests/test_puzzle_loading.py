"""Family loaders: cage targets, coordinates, inequalities and transactional loads.

KenKen, Killer, Futoshiki and Sudoku inputs are validated before anything is
mutated, a failed load leaves the grid retryable, and malformed cage targets
are rejected rather than rewritten.
"""

import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file, create_from_str, create_from_str_and_class
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken, _CellTuple
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.sumrules import DivRule, SumAndElementsAtMostOnce
from gridsolver.solver import solver


def _cage_fixture(family):
    if family == "kenken":
        return Kenken(None, 2), "aaaa", "a+0.6", "a+6"
    return (
        KillerSudoku(None, 2, 2, 2, 2),
        "aaaabbbbccccdddd", "a0.10b10c10d10", "a10b10c10d10",
    )


@pytest.mark.parametrize("family", ("kenken", "killersudoku"))
@pytest.mark.parametrize("space_sep", (False, True))
@pytest.mark.parametrize("row_wise", (False, True))
@pytest.mark.parametrize("route", ("direct", "explicit", "prefixed", "file", "iterable"))
def test_malformed_cage_targets_are_never_rewritten(
    family, space_sep, row_wise, route, tmp_path,
):
    grid, layout, bad_dictionary, good_dictionary = _cage_fixture(family)
    source = grid.deepcopy()
    separator = "\u2003" if space_sep else ""
    rendered_layout = separator.join(layout)
    options = {"space_sep": space_sep, "row_wise": row_wise}

    def load(dictionary):
        text = f"{rendered_layout}:{dictionary}"
        if route == "direct":
            grid.load(text, **options)
            return grid
        if route == "explicit":
            return create_from_str_and_class(text, family, **options)
        if route == "prefixed":
            return create_from_str(f"{family}::{text}", **options)
        if route == "file":
            path = tmp_path / "puzzle.pzl"
            path.write_text(f"{family}::{text}", encoding="utf-8")
            return create_from_file(path, **options)
        tokens = (part for part in (*layout, ":", dictionary))
        return create_from_str_and_class(tokens, family, **options)

    with pytest.raises(ValueError):
        load(bad_dictionary)
    assert grid == source
    assert not grid.has_been_filled
    result = load(good_dictionary)
    assert result.has_been_filled
    expected = [6] if family == "kenken" else [10] * 4
    assert sorted(rule.sum for rule in result.rules if hasattr(rule, "sum")) == expected


@pytest.mark.parametrize("family", ("kenken", "killersudoku"))
def test_cage_dictionary_whitespace_is_removed_without_blank_conversion(family):
    grid, layout, _, dictionary = _cage_fixture(family)
    grid.load(f"{layout}:" + "\t\u2003\n".join(dictionary))
    assert grid.has_been_filled


def test_futoshiki_direct_load_accepts_whitespace_separated_multiline_input():
    spaced = Futoshiki(2)
    spaced.load("""
        . .
        . .
        - -
        - -
    """, space_sep=True)

    compact = Futoshiki(2)
    compact.load("....----")
    assert spaced == compact


def test_futoshiki_failed_load_is_transactional_and_retryable():
    grid = Futoshiki(2)
    original_rules = grid.rules.copy()

    with pytest.raises(ValueError, match="inequality symbol"):
        grid.load("....---x")

    assert not grid.has_been_filled
    assert grid.known == (0, 0, 0, 0)
    assert grid.rules == original_rules

    grid.load("....----")
    assert grid.has_been_filled


def test_kenken_colon_division_operator_and_generator_input():
    direct = Kenken(n=2)
    direct.load("aabb:a:2b:2")

    streamed = Kenken(n=2)
    streamed.load(iter(("aabb", ":", "a:2b:2")))

    assert direct == streamed
    division_rules = direct.get_rules_of_type(DivRule)
    assert len(division_rules) == 2
    assert all(type(rule) is DivRule for rule in division_rules)


def test_kenken_failed_load_is_transactional_and_retryable():
    grid = Kenken(n=2)
    original_rules = grid.rules.copy()

    with pytest.raises(ValueError, match="operator"):
        grid.load("aabb:a?3b+3")

    assert not grid.has_been_filled
    assert grid.rules == original_rules

    grid.load("aabb:a+3b+3")
    assert grid.has_been_filled


def test_kenken_accepts_plain_cage_tuples_like_killer_sudoku():
    # make_rule read the cage by attribute name, so a plain tuple died with
    # AttributeError before the operator was even looked at.
    cages = ((3, [(0, 0), (0, 1)], "+"), (2, (1, 0, 1, 1), "/"))
    plain = Kenken(cages, n=2)
    named = Kenken([_CellTuple(*cage) for cage in cages], n=2)

    assert plain == named
    assert len(solver.solve(plain, log_level=solver.QUIET)) == 2
    with pytest.raises(ValueError, match="Not supported operator 'x'"):
        Kenken([(3, [(0, 0)], "x")], n=3)


def test_killer_cages_accept_mixed_coordinate_representations():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    grid.ext_sum_cells([
        (3, (0, 0, 0, 1)),
        (7, [(1, 0), (1, 1)]),
    ])

    assert len(grid.get_rules_of_type(SumAndElementsAtMostOnce)) == 2


def test_killer_failed_load_is_transactional_and_retryable():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    original_rules = grid.rules.copy()
    layout = "aaaabbbbccccdddd"

    with pytest.raises(ValueError, match="Missing Killer Sudoku"):
        grid.load(layout + ":a10b10c10")

    assert not grid.has_been_filled
    assert grid.rules == original_rules

    grid.load(layout + ":a10b10c10d10")
    assert grid.has_been_filled
    assert len(grid.get_rules_of_type(SumAndElementsAtMostOnce)) == 4


def test_flat_cage_coordinates_reject_an_unpaired_coordinate_atomically():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    original_rules = grid.rules.copy()

    with pytest.raises(ValueError, match="row/column pairs"):
        grid.ext_sum_cells(
            [
                (3, (0, 0, 0, 1)),
                (3, (1, 0, 1)),
            ]
        )

    assert grid.rules == original_rules


@pytest.mark.parametrize(
    ("kwargs", "name"),
    (
        ({"rows_in_box": True, "cols_in_box": 1, "box_rows": 1, "box_cols": 1}, "rows_in_box"),
        ({"rows_in_box": 1, "cols_in_box": True, "box_rows": 1, "box_cols": 1}, "cols_in_box"),
        ({"rows_in_box": 1, "cols_in_box": 1, "box_rows": True, "box_cols": 1}, "box_rows"),
        ({"rows_in_box": 1, "cols_in_box": 1, "box_rows": 1, "box_cols": True}, "box_cols"),
        ({"rows_in_box": 1.0, "cols_in_box": 1, "box_rows": 1, "box_cols": 1}, "rows_in_box"),
    ),
)
def test_sudoku_box_dimensions_reject_coercive_values(kwargs, name):
    with pytest.raises(TypeError, match=rf"{name} must be an integer"):
        Sudoku(**kwargs)


@pytest.mark.parametrize("pair", (((0, 0), (3, 3)), ((0, 0), (1, 1))))
def test_futoshiki_rejects_non_adjacent_inequalities(pair):
    grid = Futoshiki(4)
    with pytest.raises(ValueError, match="adjacent"):
        grid.ext_ineqs([pair])
    assert not grid.rules_ia


def test_futoshiki_column_wise_load_rejects_inequality_symbols():
    grid = Futoshiki(4)
    grid.load("0" * 16 + "-" * 24, row_wise=False)  # no inequalities: fine

    transposed = Futoshiki(4)
    with pytest.raises(ValueError, match="row_wise"):
        transposed.load("0" * 16 + "<" + "-" * 23, row_wise=False)
