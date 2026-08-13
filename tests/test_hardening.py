import ast
from itertools import permutations, product
from pathlib import Path

import pytest

from gridsolver.abstract_grids.grid import Grid
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.abstract_grids.pretty_print import PrettyPrintArgs, pretty_print
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.latins_square import LatinSquare
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, Rule
from gridsolver.rules.sumrules import DiffRule, DivRule, ProdRule, SumRule
from gridsolver.solver import solver
from gridsolver.solver.solve_fish import finned_fish, fish


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
    assert solver.solve(Grid(1), max_sols=0) == set()


def test_capped_solution_subset_is_deterministic_across_process_modes():
    first = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    second = solver.solve(_small_sudoku(), log_level=0, max_sols=2)
    parallel = solver.solve(
        _small_sudoku(),
        log_level=0,
        max_sols=2,
        processes=2,
    )
    assert len(first) == 2
    assert first == second == parallel


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


def test_pretty_print_defaults_render_without_optional_structures():
    rendered = pretty_print(2, 2, 2, [1, 0, 0, 2])

    assert "1" in rendered
    assert "2" in rendered
    assert rendered.endswith("\n")


def test_pretty_print_candidate_mode_requires_complete_candidates():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(ValueError, match="candidates are required"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], args=args)
    with pytest.raises(ValueError, match="Expected 4 candidate sets"):
        pretty_print(
            2,
            2,
            2,
            [0, 0, 0, 0],
            candidates=[{1, 2}],
            args=args,
        )


def test_pretty_print_rejects_invalid_shape_before_rendering():
    with pytest.raises(TypeError, match="rows must be an integer"):
        pretty_print(True, 2, 2, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="max_elem must be positive"):
        pretty_print(2, 2, 0, [0, 0, 0, 0])
    with pytest.raises(ValueError, match="Expected 4 known values"):
        pretty_print(2, 2, 2, [0])
    with pytest.raises(TypeError, match="known must be a sequence"):
        pretty_print(1, 1, 1, "0")


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


def test_pretty_print_args_validate_separator_domains():
    with pytest.raises(TypeError, match="sep_up must be an integer"):
        PrettyPrintArgs(sep_up=True)
    with pytest.raises(ValueError, match="sep_up must be between 0 and 2"):
        PrettyPrintArgs(sep_up=3)
    with pytest.raises(ValueError, match="sep_in_ve must be between 0 and 4"):
        PrettyPrintArgs(sep_in_ve=-1)
    with pytest.raises(TypeError, match="print_candidates must be a boolean"):
        PrettyPrintArgs(print_candidates=1)


def test_pretty_print_args_validate_inner_grid_dimensions_and_parent():
    with pytest.raises(TypeError, match="inner_grid_row"):
        PrettyPrintArgs(inner_grid_row="square")
    with pytest.raises(ValueError, match="inner_grid_col"):
        PrettyPrintArgs(inner_grid_col=-1)
    with pytest.raises(TypeError, match="args must be a PrettyPrintArgs"):
        PrettyPrintArgs(args=object())

    parent = PrettyPrintArgs(inner_grid_row="sqrt", sep_in_ho=4)
    child = PrettyPrintArgs(args=parent, sep_in_ho=1)
    assert child.inner_grid_row == "sqrt"
    assert child.sep_in_ho == 1


@pytest.mark.parametrize("bad", (True, 1.5, -1, 3))
def test_pretty_print_rejects_invalid_known_values(bad):
    error = TypeError if isinstance(bad, (bool, float)) else ValueError
    with pytest.raises(error):
        pretty_print(1, 1, 2, [bad])


def test_pretty_print_validates_candidate_domains_and_shapes():
    args = PrettyPrintArgs(print_candidates=True)

    with pytest.raises(TypeError, match=r"candidates\[0\]"):
        pretty_print(1, 1, 2, [0], candidates=[1], args=args)
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(1, 1, 2, [0], candidates=[{True}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{0}], args=args)
    with pytest.raises(ValueError, match="outside 1..2"):
        pretty_print(1, 1, 2, [0], candidates=[{3}], args=args)


def test_pretty_print_validates_directed_adjacent_inequalities():
    args = PrettyPrintArgs(
        sep_in_ve=4,
        sep_in_ho=4,
        inner_grid_row=1,
        inner_grid_col=1,
    )

    rendered = pretty_print(2, 2, 2, [0, 0, 0, 0], args=args, ineqs={(0, 2)})
    assert "<" in rendered

    with pytest.raises(ValueError, match="exactly two cells"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 1, 2)})
    with pytest.raises(TypeError, match="must contain integers"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(False, 1)})
    with pytest.raises(ValueError, match="outside 0..3"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 4)})
    with pytest.raises(ValueError, match="must be distinct"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 0)})
    with pytest.raises(ValueError, match="not adjacent"):
        pretty_print(2, 2, 2, [0, 0, 0, 0], ineqs={(0, 3)})


def test_pretty_print_args_reject_zero_inner_dimensions_with_separators():
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        PrettyPrintArgs(sep_in_ve=1)
    with pytest.raises(ValueError, match="inner_grid_row must be positive"):
        PrettyPrintArgs(sep_in_ho=1)

    # Candidate rendering supplies its own one-cell inner grid.
    args = PrettyPrintArgs(print_candidates=True, sep_in_ve=1, sep_in_ho=1)
    rendered = pretty_print(1, 1, 2, [0], candidates=[{1, 2}], args=args)
    assert "1" in rendered and "2" in rendered


def test_pretty_print_revalidates_mutated_args_snapshot():
    args = PrettyPrintArgs()
    args.sep_in_ve = 1
    with pytest.raises(ValueError, match="inner_grid_col must be positive"):
        pretty_print(1, 1, 1, [0], args=args)


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


def test_pretty_print_edge_configs_render_aligned():
    # regression: borders without left/right edges, and zero-width
    # separators with an inner grid, produced ragged rows and crashed
    # the crossing fixer with IndexError
    for args in (
        PrettyPrintArgs(sep_up=2, sep_lo=2, sep_le=0, sep_ri=0),
        PrettyPrintArgs(
            sep_in_ve=0, inner_grid_col=2, inner_grid_row=1, sep_in_ho=1
        ),
    ):
        rendered = pretty_print(2, 4, 4, [1, 2, 3, 4, 4, 3, 2, 1], args=args)
        lines = [line for line in rendered.splitlines() if line]
        assert "#" not in rendered
        assert len({len(line) for line in lines}) == 1


def test_pretty_print_places_inequality_glyphs_with_drawn_separators():
    # regression: drawn vertical separators desynced the inequality-row
    # state machine, swallowing glyphs and leaking literal '#'
    rendered = pretty_print(
        3, 3, 3, [0] * 9,
        args=PrettyPrintArgs(
            sep_in_ve=1, sep_in_ho=4, inner_grid_row=1, inner_grid_col=1
        ),
        ineqs={(0, 1), (4, 5), (8, 7)},
    )
    lines = [line for line in rendered.splitlines() if line]
    gap_rows = [line for line in lines if "^" in line or "v" in line]
    assert "#" not in rendered
    assert len(gap_rows) == 2
    assert gap_rows[0].index("^") == 1 and "v" not in gap_rows[0]
    assert gap_rows[1].index("^") == 3 and gap_rows[1].index("v") == 5


def test_pretty_print_blank_cells_with_space_separators_keep_borders():
    # regression: a blank cell rendered as " " was misclassified as a
    # separator column when sep_in_ve=3, corrupting the border rows
    rendered = pretty_print(
        2, 3, 3, [0, 1, 2, 3, 0, 1],
        args=PrettyPrintArgs(
            sep_in_ve=3, sep_in_ho=1, inner_grid_row=1, inner_grid_col=1
        ),
    )
    lines = [line for line in rendered.splitlines() if line]
    assert "#" not in rendered
    assert len({len(line) for line in lines}) == 1


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
