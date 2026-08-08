from gridsolver.abstract_grids.grid import Grid
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
