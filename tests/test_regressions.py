import pytest

from gridsolver.abstract_grids.grid import Grid, SolveStatus
from gridsolver.abstract_grids.immutable_grid import ImmutableGrid
from gridsolver.grid_classes.futoshiki import Futoshiki
from gridsolver.grid_classes.kenken import Kenken
from gridsolver.grid_classes.killer_sudoku import KillerSudoku
from gridsolver.rules.rules import InvalidGrid, Rule
from gridsolver.rules.sumrules import DivRule, SumAndElementsAtMostOnce
from gridsolver.solver.solve_forcing_net import _propagate_basic
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

    assert _propagate_basic(grid) == SolveStatus.SOLVED
    assert grid[0] == 1
    assert grid.get_candidates(0) == {1}


def test_nishio_uses_the_returned_invalid_status():
    grid = Grid(1, 1, max_elem=2)
    grid.add_rule_checked(_RejectValueWithoutMutating(grid, cell=0, rejected=2))

    nishio(grid)
    assert grid.get_candidates(0) == {1}


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


def test_kenken_colon_division_operator_and_generator_input():
    direct = Kenken(n=2)
    direct.load("aabb:a:2b:2")

    streamed = Kenken(n=2)
    streamed.load(iter(("aabb", ":", "a:2b:2")))

    assert direct == streamed
    assert len(direct.get_rules_of_type(DivRule)) == 2


def test_killer_cages_accept_mixed_coordinate_representations():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    grid.ext_sum_cells([
        (3, (0, 0, 0, 1)),
        (7, [(1, 0), (1, 1)]),
    ])

    assert len(grid.get_rules_of_type(SumAndElementsAtMostOnce)) == 2


def test_flat_cage_coordinates_reject_an_unpaired_coordinate():
    grid = KillerSudoku(None, 2, 2, 2, 2)
    with pytest.raises(ValueError, match="row/column pairs"):
        grid.ext_sum_cells([(3, (0, 0, 1))])
