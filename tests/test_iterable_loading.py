from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.grid_loading import create_from_str_and_class
from gridsolver.grid_classes.latins_square import LatinSquare
from gridsolver.util import flatten


def test_flatten_recurses_into_one_shot_iterables_at_every_depth():
    nested = (
        value
        for value in (
            (item for item in (1, 2)),
            [item for item in (3, 4)],
            ((item for item in (5, 6)),),
        )
    )

    assert flatten(nested) == [1, 2, 3, 4, 5, 6]


def test_flatten_keeps_nested_text_and_bytes_atomic():
    assert flatten([["12"], (value for value in (b"34", bytearray(b"56")))]) == [
        "12",
        b"34",
        bytearray(b"56"),
    ]
    # Preserve the historical top-level behaviour: a top-level string is itself
    # the outer iterable, while nested text values are scalar puzzle tokens.
    assert flatten("12") == ["1", "2"]


def test_grid_load_accepts_generators_for_outer_and_inner_rows():
    rows = (
        (value for value in row)
        for row in (
            (1, 2),
            (2, 1),
        )
    )
    grid = Grid(2)

    grid.load(rows, row_wise=True)

    assert grid.known == (1, 2, 2, 1)


def test_grid_load_validates_fully_nested_generators_before_mutating():
    rows = (
        (value for value in row)
        for row in (
            (1, 2),
            (2, 3),
        )
    )
    grid = Grid(2)

    try:
        grid.load(rows, row_wise=True)
    except ValueError as exc:
        assert "outside 0..2" in str(exc)
    else:
        raise AssertionError("Out-of-domain generator input must be rejected")

    assert grid.known == (0, 0, 0, 0)
    assert not grid.has_been_filled


def test_dot_blank_tokens_match_compact_nested_and_generator_routes():
    compact = create_from_str_and_class("1..2", "latinsquare")
    tokens = create_from_str_and_class(
        (token for token in ("1", ".", ".", "2")),
        "latinsquare",
    )
    nested = LatinSquare(2)
    nested.load((("1", " . "), (".", "2")))

    assert tokens == compact
    assert nested == compact
    assert compact.known == (1, 0, 0, 2)


def test_dot_blank_tokens_accept_bytes_and_bytearray():
    byte_grid = Grid(1)
    bytearray_grid = Grid(1)

    byte_grid.load([b" . "])
    bytearray_grid.load([bytearray(b" . ")])

    assert byte_grid.known == (0,)
    assert bytearray_grid.known == (0,)
    assert byte_grid.has_been_filled
    assert bytearray_grid.has_been_filled


def test_flatten_rejects_self_referential_iterables():
    import pytest

    values: list = [1, 2, 3]
    values.append(values)
    with pytest.raises(ValueError, match="self-referential"):
        flatten(values)

    grid = LatinSquare(2)
    cyclic: list = [1, 2, 3]
    cyclic.append(cyclic)
    with pytest.raises(ValueError, match="self-referential"):
        grid.load(cyclic)
    assert not grid.has_been_filled  # rejection happens before any mutation

    sibling = [1, 2]
    assert flatten([sibling, sibling]) == [1, 2, 1, 2]  # reuse is not a cycle

def test_class_explicit_factory_infers_shape_from_nested_generators():
    rows = (
        (value for value in row)
        for row in (
            (1, 2),
            (2, 1),
        )
    )

    grid = create_from_str_and_class(rows, "latinsquare")

    assert isinstance(grid, LatinSquare)
    assert grid.known == (1, 2, 2, 1)


def test_class_explicit_factory_rejects_nested_cycles_before_construction():
    import pytest

    values: list = [1, 2, 3]
    values.append(values)

    with pytest.raises(ValueError, match="self-referential"):
        create_from_str_and_class(values, "latinsquare")
