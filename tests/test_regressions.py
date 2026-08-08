from contextvars import Context

import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus, pairs
from gridsolver.abstract_grids.gridsize_container import GridSizeContainer
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import InvalidGrid, Rule
from gridsolver.rules.sumrules import DiffRule, DivRule, SumAndElementsAtMostOnce
from gridsolver.solver import solve_forcing_chain as forcing_chain_module
from gridsolver.solver import solver
from gridsolver.solver.atomic_solver import AtomicSolver
from gridsolver.solver.propagation import propagate_basic
from gridsolver.solver.solve_nishio import nishio
from gridsolver.util import peek


class _PeelOneCandidatePerPass(Rule):
    """Synthetic monotone rule whose fixpoint requires several passes."""

    def apply(self, known, candidates, guarantees=None):
        cell_candidates = candidates[self.cells[0]]
        if len(cell_candidates) > 1:
            cell_candidates.remove(max(cell_candidates))
        return False, None, None


class _RejectValueWithoutMutating(Rule):
    """Report a contradiction without relying on an emptied candidate set."""

    def __init__(self, grid, cell, rejected):
        super().__init__(grid, cells=[cell])
        self.rejected = rejected

    def apply(self, known, candidates, guarantees=None):
        if known[self.cells[0]] == self.rejected:
            raise InvalidGrid()
        return False, None, None

    def __hash__(self):
        return hash((super().__hash__(), self.rejected))

    def __eq__(self, other):
        return super().__eq__(other) and self.rejected == other.rejected


def test_basic_trial_propagation_tracks_candidate_only_progress():
    grid = Grid(1, 1, max_elem=4)
    grid.add_rule_checked(_PeelOneCandidatePerPass(grid, cells=[0]))

    assert propagate_basic(grid) == SolveStatus.SOLVED
    assert grid[0] == 1
    assert grid.get_candidates(0) == {1}


def test_atomic_solver_uses_invalid_exception_without_candidate_mutation():
    grid = Grid(1, 1, max_elem=2)
    grid.add_rule_checked(_RejectValueWithoutMutating(grid, cell=0, rejected=2))
    grid[0] = 2

    assert AtomicSolver(grid, [], set()).solve_atomic() == SolveStatus.INVALID
    assert grid.is_valid


def test_nishio_uses_the_returned_invalid_status():
    grid = Grid(1, 1, max_elem=2)
    grid.add_rule_checked(_RejectValueWithoutMutating(grid, cell=0, rejected=2))

    nishio(grid)
    assert grid.get_candidates(0) == {1}


def test_forcing_chain_guard_is_context_local():
    flag = forcing_chain_module._in_forcing_chain
    token = flag.set(True)
    try:
        assert bool(flag)
        assert Context().run(bool, flag) is False
    finally:
        flag.reset(token)
    assert not flag


def test_parallel_trials_work_with_python_314_start_methods():
    puzzle = "12344321........"
    sequential = Sudoku(2, 2, 2, 2)
    sequential.load(puzzle)
    parallel = Sudoku(2, 2, 2, 2)
    parallel.load(puzzle)

    sequential_solutions = solver.solve(sequential, log_level=0)
    parallel_solutions = solver.solve(parallel, log_level=0, processes=2)

    assert len(sequential_solutions) == 4
    assert sequential_solutions == parallel_solutions


def test_peek_consumes_only_the_first_item_eagerly():
    seen = []

    def source():
        for value in range(3):
            seen.append(value)
            yield value

    first, replay = peek(source())
    assert first == 0
    assert seen == [0]
    assert list(replay) == [0, 1, 2]


def test_grid_load_accepts_nested_one_shot_iterables():
    rows = (row for row in ((1, 2), (3, 4)))
    grid = Grid(2, max_elem=4)
    grid.load(rows)

    assert [[grid[(row, col)] for col in range(2)] for row in range(2)] == [[1, 2], [3, 4]]


def test_grid_clone_preserves_fill_state():
    grid = Grid(2)
    grid.load("....")
    clone = grid.deepcopy()

    assert clone.has_been_filled
    with pytest.raises(RuntimeError, match="filled once"):
        clone.load("....")


def test_grid_rejects_invalid_dimensions_without_asserts():
    with pytest.raises(ValueError, match="positive"):
        Grid(0)


def test_sudoku_rejects_inconsistent_box_dimensions():
    with pytest.raises(ValueError, match="same square grid"):
        Sudoku(2, 2, 2, 3)


def test_pairs_rejects_an_unpaired_final_value():
    with pytest.raises(ValueError, match="unpaired"):
        list(pairs((0, 1, 2)))


def test_immutable_grid_identity_includes_value_domain():
    small_domain = ImmutableGrid([1, 2], rows=1, cols=2, max_elem=2)
    larger_domain = ImmutableGrid([1, 2], rows=1, cols=2, max_elem=3)

    assert small_domain != larger_domain
    assert len({small_domain, larger_domain}) == 2


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


def test_division_rule_does_not_accept_a_rounded_float_ratio():
    base = 2 ** 60
    almost_three_times = 3 * base + 1
    rule = DivRule(GridSizeContainer(1, 2, almost_three_times), cells=[0, 1], target=3)
    candidates = ({almost_three_times}, {base})

    with pytest.raises(InvalidGrid):
        rule.apply([almost_three_times, base], candidates)


def test_arithmetic_rules_validate_public_inputs():
    grid_size = GridSizeContainer(1, 2, 2)
    with pytest.raises(ValueError, match="positive"):
        DivRule(grid_size, cells=[0, 1], target=0)
    with pytest.raises(ValueError, match="exactly two"):
        DivRule(grid_size, cells=[0], target=2)
    with pytest.raises(ValueError, match="non-negative"):
        DiffRule(grid_size, cells=[0, 1], target=-1)


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
