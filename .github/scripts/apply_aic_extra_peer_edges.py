"""Add only non-house same-value weak edges to the existing AIC graph."""

from pathlib import Path


TOPOLOGY = Path("gridsolver/solver/candidate_topology.py")
AIC = Path("gridsolver/solver/solve_aic.py")
TEST = Path("tests/test_aic_extra_visibility.py")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one marker, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    TOPOLOGY,
    '''    peer_masks: tuple[int, ...]
    candidate_masks: tuple[int, ...]
''',
    '''    peer_masks: tuple[int, ...]
    extra_peer_masks: tuple[int, ...]
    candidate_masks: tuple[int, ...]
''',
    "topology dataclass fields",
)
replace_once(
    TOPOLOGY,
    '''        houses = tuple(
            house
            for house in grid.unique_rule_cells
            if len(house) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)

        def build_peer_masks() -> tuple[int, ...]:
            # Complete houses remain authoritative even when their pairwise
            # UneqRule materialisation has not run yet. Explicit UneqRule
            # relations add equally valid non-house visibility (anti-king,
            # anti-knight, custom extensions, and similar constraints).
            peers = [cells_mask(links) for links in grid.weak_links]
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    peers[cell] |= house_mask & ~(1 << cell)
            return tuple(peers)

        peer_masks = grid.cached_rule_struct(
            "cell_peer_masks",
            build_peer_masks,
        )
''',
    '''        unique_groups = tuple(grid.unique_rule_cells)
        houses = tuple(
            group
            for group in unique_groups
            if len(group) == grid.max_elem
        )
        house_masks = tuple(cells_mask(house) for house in houses)

        def build_peer_masks() -> tuple[tuple[int, ...], tuple[int, ...]]:
            house_peers = [0] * grid.len
            for house, house_mask in zip(houses, house_masks):
                for cell in house:
                    house_peers[cell] |= house_mask & ~(1 << cell)

            # Start from complete-house visibility, then add partial
            # at-most-once groups and explicit UneqRule relations.
            peers = house_peers.copy()
            for group in unique_groups:
                if len(group) == grid.max_elem:
                    continue
                group_mask = cells_mask(group)
                for cell in group:
                    peers[cell] |= group_mask & ~(1 << cell)
            for cell, links in enumerate(grid.weak_links):
                peers[cell] |= cells_mask(links)

            return tuple(house_peers), tuple(peers)

        house_peer_masks, peer_masks = grid.cached_rule_struct(
            "cell_peer_masks",
            build_peer_masks,
        )
        extra_peer_masks = tuple(
            peers & ~house_peers
            for peers, house_peers in zip(peer_masks, house_peer_masks)
        )
''',
    "topology peer-mask construction",
)
replace_once(
    TOPOLOGY,
    '''            peer_masks=peer_masks,
            candidate_masks=tuple(per_value),
''',
    '''            peer_masks=peer_masks,
            extra_peer_masks=extra_peer_masks,
            candidate_masks=tuple(per_value),
''',
    "topology constructor",
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


def _extra_same_value_weak_pairs(
    topology: CandidateTopology,
) -> Iterator[tuple[Node, Node]]:
    """Yield non-house same-value peer pairs once in stable cell order."""
    if not any(topology.extra_peer_masks):
        return
    for value in range(1, topology.grid.max_elem + 1):
        remaining = topology.candidate_masks[value]
        while remaining:
            first_bit = remaining & -remaining
            first = first_bit.bit_length() - 1
            remaining ^= first_bit
            extra = topology.extra_peer_masks[first] & remaining
            for second in iter_cells(extra):
                yield (first, value), (second, value)


# noinspection PyProtectedMember
''',
    "AIC extra-pair helper",
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

    if not strong:
''',
    '''    # Same-value weak links within complete houses retain the established
    # fast path. Add only the genuinely missing non-house peer edges afterwards.
    for house_mask in topology.house_masks:
        for value in range(1, grid.max_elem + 1):
            cells = tuple(
                iter_cells(house_mask & topology.candidate_masks[value])
            )
            for index, first in enumerate(cells):
                for second in cells[index + 1:]:
                    add_link(weak, (first, value), (second, value))
                    add_link(weak, (second, value), (first, value))

    for first, second in _extra_same_value_weak_pairs(topology):
        add_link(weak, first, second)
        add_link(weak, second, first)

    if not strong:
''',
    "AIC extra weak edges",
)

TEST.write_text(
    '''from gridsolver.abstract_grids.grid import Grid
from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.uneq import UneqRule
from gridsolver.rules.unique import ElementsAtMostOnce
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_aic import _extra_same_value_weak_pairs


def _pairs(topology: CandidateTopology) -> set[tuple[int, int, int]]:
    return {
        (first[0], second[0], first[1])
        for first, second in _extra_same_value_weak_pairs(topology)
    }


def test_standard_sudoku_has_no_extra_aic_peer_edges():
    topology = CandidateTopology.build(Sudoku(2, 2, 2, 2))

    assert not any(topology.extra_peer_masks)
    assert list(_extra_same_value_weak_pairs(topology)) == []


def test_explicit_non_house_relation_becomes_extra_aic_edge():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(UneqRule(grid, origin_cell=0, rel_cells=[2]))

    topology = CandidateTopology.build(grid)

    assert topology.extra_peer_masks[0] & (1 << 2)
    assert topology.extra_peer_masks[2] & (1 << 0)
    assert {(0, 2, value) for value in range(1, 4)} <= _pairs(topology)


def test_partial_uniqueness_group_becomes_extra_aic_edge():
    grid = Grid(1, 3, max_elem=3)
    grid.add_rule_checked(ElementsAtMostOnce(grid, cells=[0, 2]))

    topology = CandidateTopology.build(grid)

    assert topology.houses == ()
    assert topology.peer_masks[0] & (1 << 2)
    assert topology.peer_masks[2] & (1 << 0)
    assert {(0, 2, value) for value in range(1, 4)} <= _pairs(topology)


def test_extra_aic_pairs_are_emitted_once_for_overlapping_constraints():
    grid = Grid(1, 4, max_elem=4)
    grid.add_rules_checked(
        (
            ElementsAtMostOnce(grid, cells=[0, 3]),
            UneqRule(grid, origin_cell=0, rel_cells=[3]),
        )
    )

    pairs = list(_extra_same_value_weak_pairs(CandidateTopology.build(grid)))

    assert len(pairs) == 4
    assert len(pairs) == len(set(pairs))
''',
    encoding="utf-8",
)
