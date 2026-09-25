"""Public model inputs are validated explicitly, never by assert.

Grid and ImmutableGrid construction, coordinates, loads, equality, hashing
and write-once size metadata; rule cell sets; guarantee ordering and cache
lifetime; fish sizes; and a scan that keeps optimization-sensitive asserts
out of the production sources.
"""

import ast
import copy
import pickle
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid, pairs
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.slitherlink import Slitherlink
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.solver.solve_fish import finned_fish, fish


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


def test_grid_load_validates_the_complete_payload_before_mutating():
    grid = Grid(2, max_elem=4)

    with pytest.raises(TypeError, match="integers or strings"):
        grid.load([1, 2, 3, 4.0])
    assert not grid.has_been_filled
    assert grid.known == (0, 0, 0, 0)

    with pytest.raises(TypeError, match="integers or strings"):
        grid.load([1, 2, 3, True])
    assert not grid.has_been_filled
    assert grid.known == (0, 0, 0, 0)

    with pytest.raises(ValueError, match="outside"):
        grid.load([1, 2, 3, 5])
    assert not grid.has_been_filled
    assert grid.known == (0, 0, 0, 0)
    assert all(possible == {1, 2, 3, 4} for possible in grid._candidates)

    grid.load([1, 2, 3, 4])
    assert grid.known == (1, 3, 2, 4)


def test_rule_rejects_empty_outside_or_duplicate_cell_sets():
    grid = Grid(2)
    with pytest.raises(ValueError, match="must not be empty"):
        _NoOpRule(grid, cells=[])
    with pytest.raises(ValueError, match="outside a 2x2 grid"):
        _NoOpRule(grid, cells=[(9, 9)])
    with pytest.raises(ValueError, match="unique"):
        _NoOpRule(grid, cells=[0, 0])


def test_immutable_grid_validates_shape_domain_and_hides_backing_array():
    with pytest.raises(ValueError, match="Expected 2"):
        ImmutableGrid([1], rows=1, cols=2, max_elem=2)
    with pytest.raises(ValueError, match="non-negative"):
        ImmutableGrid([1, -1], rows=1, cols=2, max_elem=2)
    with pytest.raises(ValueError, match="outside"):
        ImmutableGrid([1, 3], rows=1, cols=2, max_elem=2)

    grid = ImmutableGrid([1, 2], rows=1, cols=2, max_elem=2)
    known = grid.known
    original_hash = hash(grid)

    assert known == (1, 2)
    with pytest.raises(TypeError):
        known[0] = 2
    assert grid.known == (1, 2)
    assert hash(grid) == original_hash


def test_smallest_guarantee_uses_a_stable_total_order():
    grid = Grid(2)
    expected = Guarantee(1, frozenset({2, 3}), grid.rows, grid.cols)
    grid.guarantees.update(
        {
            Guarantee(2, frozenset({0, 1}), grid.rows, grid.cols),
            expected,
            Guarantee(1, frozenset({0, 1, 2}), grid.rows, grid.cols),
        }
    )

    assert grid.get_smallest_guarantee() == expected


def test_guarantee_cache_survives_rule_churn_only():
    grid = Grid(2)
    builds = 0

    def build():
        nonlocal builds
        builds += 1
        return object()

    first = grid.cached_guarantee_struct("sentinel", build)
    grid.add_rule_checked(_NoOpRule(grid, cells=[0]))
    assert grid.cached_guarantee_struct("sentinel", build) is first
    assert builds == 1

    guarantee = Guarantee(1, frozenset({0}), grid.rows, grid.cols)
    grid.add_gtee_checked(guarantee)
    second = grid.cached_guarantee_struct("sentinel", build)
    assert second is not first
    assert builds == 2

    clone = grid.deepcopy()
    assert clone._guarantee_cache == {}


@pytest.mark.parametrize("action", (fish, finned_fish))
def test_fish_size_is_validated_without_assertions(action):
    grid = Grid(1)

    with pytest.raises(TypeError, match="max_fish must be an integer"):
        action(grid, True)
    with pytest.raises(TypeError, match="max_fish must be an integer"):
        action(grid, 2.5)
    with pytest.raises(ValueError, match="max_fish must be at least 2"):
        action(grid, 1)


def test_production_sources_do_not_use_optimization_sensitive_assertions():
    root = Path(__file__).resolve().parents[1] / "gridsolver"
    violations = []

    for path in root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        violations.extend(
            f"{path.relative_to(root.parent)}:{node.lineno}"
            for node in ast.walk(tree)
            if isinstance(node, ast.Assert)
        )

    assert not violations, (
        "Production correctness checks must not disappear under python -O; "
        f"replace assertions with explicit exceptions: {violations}"
    )


def test_immutable_grid_hash_is_lazy_stable_and_clone_safe():
    import pickle

    grid = ImmutableGrid((1, 2, 2, 1), 2, 2, 2)
    assert "_ImmutableGrid__hash" not in grid.__dict__
    first = hash(grid)
    assert grid.__dict__["_ImmutableGrid__hash"] == first
    assert hash(ImmutableGrid((1, 2, 2, 1), 2, 2, 2)) == first
    assert hash(pickle.loads(pickle.dumps(grid))) == first

    # mutable grids never pay for the hash, and field-copied clones keep
    # the same attribute shape (the eager hash used to exist only on the
    # original)
    mutable = Grid(2)
    clone = mutable.deepcopy()
    assert "_ImmutableGrid__hash" not in mutable.__dict__
    assert "_ImmutableGrid__hash" not in clone.__dict__
    assert ImmutableGrid.__hash__(clone) == ImmutableGrid.__hash__(mutable)


def test_negative_scalar_indexes_never_wrap_to_the_last_cell():
    from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
    from gridsolver.grid_classes.path_puzzles import Numbrix

    immutable = ImmutableGrid((1, 2, 2, 1), 2)
    mutable = Grid(2)
    compact = Numbrix.from_board(((0, 0), (0, 0)))

    for grid in (immutable, mutable, compact):
        with pytest.raises(IndexError):
            _ = grid[-1]

    for grid in (immutable, mutable):
        with pytest.raises(IndexError):
            _ = grid[(-1,)]

    for grid in (mutable, compact):
        with pytest.raises(IndexError):
            grid[-1] = 1
        with pytest.raises(IndexError):
            grid.get_candidates(-1)
        assert grid.known == (0,) * grid.len


def test_grid_rejects_invalid_dimensions_without_asserts():
    with pytest.raises(ValueError, match="positive"):
        Grid(0)


def test_sudoku_rejects_inconsistent_box_dimensions():
    with pytest.raises(ValueError, match="same square grid"):
        Sudoku(2, 2, 2, 3)


def test_pairs_rejects_an_unpaired_final_value():
    with pytest.raises(ValueError, match="unpaired"):
        list(pairs((0, 1, 2)))


@pytest.mark.parametrize('factory', (
    lambda: GridSizeContainer(1, 2, 2),
    lambda: ImmutableGrid([1, 2], 1, 2, 2),
    lambda: Grid(1, 2, 2),
    lambda: Sudoku(2, 2, 2, 2),
    lambda: Slitherlink([[None]]),
))
def test_size_metadata_is_write_once_and_not_deletable(factory):
    original = factory()
    for value in (original, copy.copy(original), copy.deepcopy(original),
                  pickle.loads(pickle.dumps(original))):
        size = (value.rows, value.cols, value.max_elem, value.len)
        for attribute in ('rows', 'cols', 'max_elem', 'len'):
            with pytest.raises(AttributeError, match='read-only'):
                setattr(value, attribute, getattr(value, attribute))
            with pytest.raises(AttributeError, match='read-only'):
                setattr(value, attribute, 999)
            with pytest.raises(AttributeError, match='read-only'):
                delattr(value, attribute)
        assert (value.rows, value.cols, value.max_elem, value.len) == size
        with pytest.raises(AttributeError, match='read-only'):
            GridSizeContainer.__init__(value, 4, 5, 6)
        assert (value.rows, value.cols, value.max_elem, value.len) == size


@pytest.mark.parametrize('protocol', (0, pickle.DEFAULT_PROTOCOL, pickle.HIGHEST_PROTOCOL))
def test_solution_hash_and_membership_survive_copy_pickle_and_rejected_mutation(protocol):
    first = ImmutableGrid([1, 2], 1, 2, 2)
    equivalent = ImmutableGrid([1, 2], 1, 2, 2)
    solutions = {first}
    mapping = {first: 'solution'}
    before = hash(first)
    for attribute in ('rows', 'cols', 'max_elem', 'len'):
        with pytest.raises(AttributeError):
            setattr(first, attribute, 3)
    for other in (equivalent, copy.deepcopy(first), pickle.loads(pickle.dumps(first, protocol))):
        assert first == other and hash(other) == before
        assert other in solutions and mapping[other] == 'solution'
        assert len(solutions | {other}) == 1


def test_mutable_grid_still_accepts_values_and_trail_rollback():
    grid = Grid(1, 2, 2)
    mark = grid.trail_mark()
    grid[0] = 1
    grid.trail_undo(mark)
    assert grid.known == (0, 0)
    grid.load([1, 2])
    assert grid.known == (1, 2)
