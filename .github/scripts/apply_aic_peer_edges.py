"""Use the complete peer graph for AIC same-value weak edges."""

from pathlib import Path


TOPOLOGY = Path("gridsolver/solver/candidate_topology.py")
AIC = Path("gridsolver/solver/solve_aic.py")
TEST = Path("tests/test_aic_visibility.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    TOPOLOGY,
    '''        houses = tuple(
            house
            for house in grid.unique_rule_cells
            if len(house) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)
''',
    '''        unique_groups = tuple(grid.unique_rule_cells)
        houses = tuple(
            group
            for group in unique_groups
            if len(group) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)
''',
    "unique-group collection",
)
replace_once(
    TOPOLOGY,
    '''            # Complete houses remain authoritative even when their pairwise
            # UneqRule materialisation has not run yet. Explicit UneqRule
            # relations add equally valid non-house visibility (anti-king,
            # anti-knight, custom extensions, and similar constraints).
            peers = [cells_mask(links) for links in grid.weak_links]
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    peers[cell] |= house_mask & ~(1 << cell)
            return tuple(peers)
''',
    '''            # Every at-most-once group creates pairwise visibility, even
            # when it is smaller than a complete house. Explicit UneqRule
            # relations add non-group visibility (anti-king, anti-knight,
            # custom extensions, and similar constraints).
            peers = [cells_mask(links) for links in grid.weak_links]
            for group in unique_groups:
                group_mask = cells_mask(group)
                for cell in group:
                    peers[cell] |= group_mask & ~(1 << cell)
            return tuple(peers)
''',
    "peer-mask construction",
)

replace_once(
    AIC,
    "from collections import deque\n",
    "from collections import deque\nfrom collections.abc import Iterator\n",
    "AIC imports",
)
replace_once(
    AIC,
    '''type Node = tuple[int | frozenset[int], int]


# noinspection PyProtectedMember
''',
    '''type Node = tuple[int | frozenset[int], int]


def _same_value_weak_pairs(
    topology: CandidateTopology,
) -> Iterator[tuple[Node, Node]]:
    """Yield each unordered same-value peer pair exactly once."""
    for value in range(1, topology.grid.max_elem + 1):
        remaining = topology.candidate_masks[value]
        while remaining:
            first_bit = remaining & -remaining
            first = first_bit.bit_length() - 1
            remaining ^= first_bit
            for second in iter_cells(topology.peer_masks[first] & remaining):
                yield (first, value), (second, value)


# noinspection PyProtectedMember
''',
    "AIC weak-pair helper",
)
replace_once(
    AIC,
    '''    # Same-value weak links within complete houses.
    for house_mask in topology.house_masks:
        for value in range(1, grid.max_elem + 1):
            cells = tuple(
                iter_cells(house_mask & topology.candidate_masks[value])
            )
            for index, first in enumerate(cells):
                for second in cells[index + 1:]:
                    add_link(weak, (first, value), (second, value))
                    add_link(weak, (second, value), (first, value))
''',
    '''    # Same-value weak links over the complete peer graph. Iterating the
    # remaining bit mask emits each edge once, avoiding duplicates when two
    # cells share a row and a box (or multiple custom constraints).
    for first, second in _same_value_weak_pairs(topology):
        add_link(weak, first, second)
        add_link(weak, second, first)
''',
    "AIC same-value weak links",
)

TEST.write_text(
    '''from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_aic import _same_value_weak_pairs


def _cell_pairs(topology: CandidateTopology) -> set[tuple[int, int, int]]:
    return {
        (first[0], second[0], first[1])
        for first, second in _same_value_weak_pairs(topology)
    }


def test_aic_weak_pairs_include_explicit_non_house_relation():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[2]))

    pairs = _cell_pairs(CandidateTopology.build(grid))

    assert {(0, 2, value) for value in range(1, 4)} <= pairs


def test_aic_weak_pairs_include_partial_at_most_once_group():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 2]))

    topology = CandidateTopology.build(grid)
    pairs = _cell_pairs(topology)

    assert topology.houses == ()
    assert {(0, 2, value) for value in range(1, 4)} <= pairs


def test_aic_weak_pairs_are_unique_across_overlapping_houses():
    topology = CandidateTopology.build(Sudoku(2, 2, 2, 2))
    pairs = list(_same_value_weak_pairs(topology))

    assert len(pairs) == len(set(pairs))
    # A blank 4x4 Sudoku has 56 unordered peer pairs, for each of 4 values.
    assert len(pairs) == 224


def test_candidate_visibility_includes_partial_uniqueness_without_helper():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 2]))

    topology = CandidateTopology.build(grid)

    assert topology.peer_masks[0] & (1 << 2)
    assert topology.peer_masks[2] & (1 << 0)
''',
    encoding="utf-8",
)
