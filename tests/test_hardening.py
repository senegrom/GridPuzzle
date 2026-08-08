from itertools import permutations, product

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.latins_square import LatinSquare
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.sumrules import DiffRule, DivRule, ProdRule, SumRule
from gridsolver.solver import solver


class _NoOpRule(Rule):
    def apply(self, known, candidates, guarantees=None):
        return False, None, None


def _small_sudoku() -> Sudoku:
    grid = Sudoku(2, 2, 2, 2)
    grid.load("12344321........")
    return grid


def _latin_oracle(
    size: int,
    puzzle: str,
    inequalities: tuple[tuple[tuple[int, int], tuple[int, int]], ...] = (),
) -> set[tuple[int, ...]]:
    """Enumerate small Latin grids without using GridPuzzle rules."""
    givens = tuple(0 if token == "." else int(token, 36) for token in puzzle)
    row_options = tuple(permutations(range(1, size + 1)))
    solutions: set[tuple[int, ...]] = set()

    for rows in product(row_options, repeat=size):
        if any(
            given and rows[index // size][index % size] != given
            for index, given in enumerate(givens)
        ):
            continue
        if any(
            len({rows[row][col] for row in range(size)}) != size
            for col in range(size)
        ):
            continue
        if any(rows[lt[0]][lt[1]] >= rows[gt[0]][gt[1]] for lt, gt in inequalities):
            continue

        # ImmutableGrid stores cells column-major; the oracle generates rows.
        solutions.add(
            tuple(rows[row][col] for col in range(size) for row in range(size))
        )

    return solutions


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


def test_arithmetic_rule_targets_and_symmetric_identity_are_canonical():
    grid_size = GridSizeContainer(1, 2, max_elem=4)

    with pytest.raises(TypeError, match="integers"):
        SumRule(grid_size, cells=[0, 1], mysum=1.5)
    with pytest.raises(TypeError, match="integers"):
        ProdRule(grid_size, cells=[0, 1], target=True)
    with pytest.raises(TypeError, match="integers"):
        DiffRule(grid_size, cells=[0, 1], target="1")
    with pytest.raises(TypeError, match="integers"):
        DivRule(grid_size, cells=[0, 1], target=2.0)
    with pytest.raises(ValueError, match="positive"):
        ProdRule(grid_size, cells=[0, 1], target=0)

    forward_diff = DiffRule(grid_size, cells=[0, 1], target=1)
    reverse_diff = DiffRule(grid_size, cells=[1, 0], target=1)
    forward_div = DivRule(grid_size, cells=[0, 1], target=2)
    reverse_div = DivRule(grid_size, cells=[1, 0], target=2)

    assert forward_diff == reverse_diff
    assert hash(forward_diff) == hash(reverse_diff)
    assert forward_div == reverse_div
    assert hash(forward_div) == hash(reverse_div)


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


def test_solver_options_are_explicit():
    with pytest.raises(ValueError, match="max_sols"):
        solver.solve(Grid(1), max_sols=-2)
    with pytest.raises(TypeError, match="max_sols"):
        solver.solve(Grid(1), max_sols=True)
    with pytest.raises(ValueError, match="processes"):
        solver.solve(Grid(1), processes=-1)
    with pytest.raises(TypeError, match="processes"):
        solver.solve(Grid(1), processes=1.5)
    with pytest.raises(ValueError, match="depth_gate"):
        solver.solve(Grid(1), depth_gate=-1)
    with pytest.raises(TypeError, match="depth_gate"):
        solver.solve(Grid(1), depth_gate=True)
    with pytest.raises(TypeError, match="depth_gate"):
        solver.solve(Grid(1), depth_gate=1.5)

    assert solver.solve(Grid(1), max_sols=0, depth_gate=0) == set()


def test_capped_solution_subset_is_deterministic_across_process_modes():
    first = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    second = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    parallel = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        processes=2,
    )
    gated = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        depth_gate=0,
    )
    parallel_gated = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        processes=2,
        depth_gate=0,
    )
    after_gated = solver.solve(_small_sudoku(), log_level=0, max_sols=2)

    assert len(first) == 2
    assert first == second == parallel
    assert first == gated == parallel_gated == after_gated


@pytest.mark.parametrize("puzzle", [".........", "12......."])
def test_latin_solver_matches_independent_complete_oracle(puzzle: str):
    grid = LatinSquare(3)
    grid.load(puzzle)

    actual = {tuple(solution) for solution in solver.solve(grid, log_level=0)}
    expected = _latin_oracle(3, puzzle)

    assert actual == expected


def test_futoshiki_solver_matches_independent_complete_oracle():
    inequalities = (
        ((0, 0), (0, 1)),
        ((2, 2), (1, 2)),
    )
    grid = Futoshiki(3)
    grid.load("." * 9 + "-" * 12)
    grid.ext_ineqs(inequalities)

    actual = {tuple(solution) for solution in solver.solve(grid, log_level=0)}
    expected = _latin_oracle(3, "." * 9, inequalities)

    assert actual == expected
