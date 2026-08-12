import pytest

from gridsolver.abstract_grids.grid_loading import create_from_file
from gridsolver.grid_classes.compact_grid import CompactGrid
from gridsolver.grid_classes.path_puzzles import Hidato
from gridsolver.grid_classes.slitherlink import Slitherlink


def test_compact_grid_rejects_unhashable_keys_and_lookups():
    with pytest.raises(TypeError, match="keys must be hashable"):
        CompactGrid(([0],), max_elem=1)

    grid = CompactGrid(((0, 0),), max_elem=1)
    with pytest.raises(TypeError, match="keys must be hashable"):
        grid.compact_cell([0, 0])


def test_values_by_key_validates_types_and_domain():
    grid = CompactGrid(("a", "b"), max_elem=2)

    assert grid.values_by_key((0, 2)) == {"a": 0, "b": 2}
    with pytest.raises(TypeError, match="integer sequence"):
        grid.values_by_key("12")
    with pytest.raises(TypeError, match="compact cell 1"):
        grid.values_by_key((1, True))
    with pytest.raises(ValueError, match=r"outside 0\.\.2"):
        grid.values_by_key((1, 3))


@pytest.mark.parametrize(
    "factory, rows, message",
    (
        (Hidato.from_board, ("12", "34"), "Path board row 0 must not be text"),
        (Slitherlink, ("12", "34"), "Slitherlink clue grid row 0 must not be text"),
    ),
)
def test_rectangular_puzzle_rows_reject_ambiguous_text_rows(
    factory, rows, message
):
    with pytest.raises(TypeError, match=message):
        factory(rows)


def test_standard_file_loader_accepts_bom_and_semicolon_comments(tmp_path):
    puzzle = tmp_path / "latin.pzl"
    puzzle.write_text(
        "; retained source comment\n"
        "\ufeffLatinSquare::\n"
        ". .\n"
        ". .\n",
        encoding="utf-8",
    )

    grid = create_from_file(puzzle, space_sep=True)

    assert grid.rows == grid.cols == 2


def test_compact_indexing_resolves_board_keys_not_internal_tuples():
    # regression: the inherited 1xN (row, col) math silently aliased board
    # keys — grid[(0, 1)] read internal cell 1, which is board key (1, 0)
    grid = Hidato(2, 2, blocked=[(0, 0)])
    grid.load_key_values({(0, 1): 1})

    assert grid[(0, 1)] == 1
    assert grid[grid.compact_cell((0, 1))] == 1
    grid[(1, 0)] = 2
    assert grid[(1, 0)] == 2
    with pytest.raises(KeyError, match="Unknown puzzle key"):
        grid[(0, 0)]  # blocked cells are not variables
