import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.rules.rules import Rule


class _NoOpRule(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, None, None


def test_grid_clone_preserves_name_and_fill_state():
    grid = Grid(2)
    grid.name = "source"
    grid.load("....")

    clone = grid.deepcopy()

    assert clone.name == "source"
    assert clone.has_been_filled
    with pytest.raises(RuntimeError, match="filled once"):
        clone.load("....")


def test_grid_size_requires_positive_non_boolean_integers():
    with pytest.raises(ValueError, match="positive"):
        GridSizeContainer(0)
    with pytest.raises(TypeError, match="integer"):
        GridSizeContainer(1.5)
    with pytest.raises(TypeError, match="integer"):
        GridSizeContainer(True)


def test_grid_equality_includes_shape_and_domain():
    flat = Grid(2, 8, max_elem=4)
    square = Grid(4, 4, max_elem=4)
    other_domain = Grid(4, 4, max_elem=5)

    assert flat != square
    assert square != other_domain


def test_grid_coordinates_and_assignments_are_validated():
    grid = Grid(2)

    with pytest.raises(IndexError, match="outside"):
        _ = grid[(2, 0)]
    with pytest.raises(IndexError, match="outside"):
        grid[(0, 2)] = 1
    with pytest.raises(ValueError, match="outside"):
        grid[0] = 3
    with pytest.raises(TypeError, match="integers"):
        grid[0] = 1.5

    grid[0] = 1
    with pytest.raises(ValueError, match="monotone"):
        grid[0] = 0
    with pytest.raises(ValueError, match="monotone"):
        grid[0] = 2


def test_rule_rejects_empty_or_fully_outside_cell_sets():
    grid = Grid(2)
    with pytest.raises(ValueError, match="must not be empty"):
        _NoOpRule(grid, cells=[])
    with pytest.raises(ValueError, match="no cells inside"):
        _NoOpRule(grid, cells=[(9, 9)])


def test_immutable_grid_validates_shape_and_hides_backing_array():
    with pytest.raises(ValueError, match="Expected 2"):
        ImmutableGrid([1], rows=1, cols=2, max_elem=2)
    with pytest.raises(ValueError, match="non-negative"):
        ImmutableGrid([1, -1], rows=1, cols=2, max_elem=2)

    grid = ImmutableGrid([1, 2], rows=1, cols=2, max_elem=2)
    known = grid.known
    original_hash = hash(grid)

    assert known == (1, 2)
    with pytest.raises(TypeError):
        known[0] = 2
    assert grid.known == (1, 2)
    assert hash(grid) == original_hash
