"""Exact equivalence guards for the shared candidate-bitset power actions."""

from __future__ import annotations

import itertools

import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.rules.rules import Guarantee, InvalidGrid
from gridsolver.solver.candidate_topology import CandidateTopology, cells_mask
from gridsolver.solver.solve_als import cell_houses
from gridsolver.solver.solve_empty_rectangle import empty_rectangle
from gridsolver.solver.solve_locked_candidate import locked_candidate
from gridsolver.solver.solve_skyscraper import skyscraper
from tests.test_differential import (
    _grid_from_completions,
    _solution_pair_at_distance,
)


def _legacy_locked_candidate(grid: Sudoku) -> None:
    houses = grid.full_houses
    candidates = grid._candidates
    known = grid._known
    for first, second in itertools.combinations(houses, 2):
        intersection = first & second
        if (
            not intersection
            or len(intersection) == len(first)
            or len(intersection) == len(second)
        ):
            continue
        first_only = first - intersection
        second_only = second - intersection
        for value in range(1, grid.max_elem + 1):
            if not any(
                known[cell] == 0 and value in candidates[cell]
                for cell in first_only
            ) and any(
                known[cell] == 0 and value in candidates[cell]
                for cell in intersection
            ):
                for cell in second_only:
                    candidates[cell].discard(value)

            if not any(
                known[cell] == 0 and value in candidates[cell]
                for cell in second_only
            ) and any(
                known[cell] == 0 and value in candidates[cell]
                for cell in intersection
            ):
                for cell in first_only:
                    candidates[cell].discard(value)


def _legacy_skyscraper(grid: Sudoku) -> None:
    houses = grid.full_houses
    candidates = grid._candidates
    known = grid._known
    houses_by_cell = cell_houses(grid, houses)

    for value in range(1, grid.max_elem + 1):
        conjugate_pairs: list[tuple[int, int]] = []
        for house in houses:
            locations = [
                cell
                for cell in house
                if known[cell] == 0 and value in candidates[cell]
            ]
            if len(locations) == 2:
                conjugate_pairs.append((locations[0], locations[1]))

        for pair_index, (first_a, first_b) in enumerate(conjugate_pairs):
            for second_a, second_b in conjugate_pairs[pair_index + 1 :]:
                cells4 = {first_a, first_b, second_a, second_b}
                if len(cells4) != 4:
                    continue
                for base_a, top_a in (
                    (first_a, first_b),
                    (first_b, first_a),
                ):
                    for base_b, top_b in (
                        (second_a, second_b),
                        (second_b, second_a),
                    ):
                        if not any(
                            base_b in house
                            for house in houses_by_cell[base_a]
                        ):
                            continue
                        sees_first: set[int] = set()
                        for house in houses_by_cell[top_a]:
                            sees_first.update(house)
                        sees_second: set[int] = set()
                        for house in houses_by_cell[top_b]:
                            sees_second.update(house)
                        for cell in sees_first & sees_second - cells4:
                            if known[cell] == 0:
                                candidates[cell].discard(value)
                                if not candidates[cell]:
                                    raise InvalidGrid()


def _legacy_empty_rectangle(grid: Sudoku) -> None:
    houses = grid.full_houses
    if len(houses) < 3:
        return
    candidates = grid._candidates
    known = grid._known
    semi_strong = grid.semi_strong_links
    guarantees = grid.guarantee_cells_by_value
    houses_by_cell = cell_houses(grid, houses)

    for box in houses:
        for value in range(1, grid.max_elem + 1):
            box_values = frozenset(
                cell
                for cell in box
                if known[cell] == 0 and value in candidates[cell]
            )
            if len(box_values) < 3:
                continue
            if not any(cells <= box for cells in guarantees[value]):
                continue

            touching = []
            seen_ids: set[int] = set()
            for cell in box_values:
                for house in houses_by_cell[cell]:
                    if house is not box and id(house) not in seen_ids:
                        seen_ids.add(id(house))
                        touching.append(house)

            for row_house in touching:
                rest = box_values - row_house
                if not rest or rest == box_values:
                    continue
                for col_house in touching:
                    if col_house is row_house or not rest <= col_house:
                        continue
                    for first in row_house:
                        if first in box or not semi_strong[value][first]:
                            continue
                        for second in semi_strong[value][first]:
                            if second in box:
                                continue
                            second_houses = houses_by_cell[second]
                            for cell in col_house:
                                if (
                                    cell in box
                                    or cell == second
                                    or known[cell] > 0
                                    or value not in candidates[cell]
                                ):
                                    continue
                                if any(cell in house for house in second_houses):
                                    candidates[cell].discard(value)
                                    if not candidates[cell]:
                                        raise InvalidGrid()


def _candidate_state(grid: Sudoku) -> tuple[frozenset[int], ...]:
    return tuple(frozenset(possible) for possible in grid._candidates)


def _run(action, grid: Sudoku) -> type[Exception] | None:
    try:
        action(grid)
    except InvalidGrid:
        return InvalidGrid
    return None


def _assert_matches(reference, bitset_action, grid: Sudoku) -> None:
    expected = grid.deepcopy()
    actual = grid.deepcopy()

    reference_error = _run(reference, expected)
    topology = CandidateTopology.build(actual)
    bitset_error = _run(
        lambda target: bitset_action(target, topology),
        actual,
    )

    assert bitset_error is reference_error
    assert _candidate_state(actual) == _candidate_state(expected)


@pytest.mark.parametrize("distance", (8, 12, 16))
def test_bitset_locked_candidate_matches_legacy_on_oracle_states(distance):
    grid = _grid_from_completions(_solution_pair_at_distance(distance))
    _assert_matches(_legacy_locked_candidate, locked_candidate, grid)


@pytest.mark.parametrize("distance", (8, 12, 16))
def test_bitset_skyscraper_matches_legacy_on_oracle_states(distance):
    grid = _grid_from_completions(_solution_pair_at_distance(distance))
    _assert_matches(_legacy_skyscraper, skyscraper, grid)


def _empty_rectangle_grid() -> Sudoku:
    grid = Sudoku()
    for row, col in ((0, 0), (0, 2), (2, 0), (2, 2)):
        grid.get_candidates((row, col)).discard(1)
    index = {
        (row, col): row + col * 9
        for row in range(9)
        for col in range(9)
    }
    cross = frozenset(
        index[cell]
        for cell in ((1, 0), (1, 1), (1, 2), (0, 1), (2, 1))
    )
    grid.add_gtee_checked(Guarantee(1, cross, 9, 9))
    grid.add_gtee_checked(
        Guarantee(1, frozenset({index[1, 4], index[7, 4]}), 9, 9)
    )
    return grid


def test_bitset_empty_rectangle_matches_legacy_on_eliminating_state():
    _assert_matches(
        _legacy_empty_rectangle,
        empty_rectangle,
        _empty_rectangle_grid(),
    )


def test_candidate_topology_exposes_exact_per_cell_and_visibility_masks():
    grid = Sudoku(2, 2, 2, 2)
    grid.get_candidates(0).intersection_update({1, 3})
    grid.get_candidates(5).intersection_update({2, 4})
    grid[5] = 2

    topology = CandidateTopology.build(grid)

    for cell, possible in enumerate(grid._candidates):
        expected = 0 if grid._known[cell] else sum(1 << value for value in possible)
        assert topology.candidate_value_masks[cell] == expected
    for cell, houses in cell_houses(grid, grid.full_houses).items():
        expected = cells_mask(
            other
            for house in houses
            for other in house
            if other != cell
        )
        assert topology.house_peer_masks[cell] == expected
    for cell, links in enumerate(grid.weak_links):
        assert topology.weak_peer_masks[cell] == cells_mask(links)


def test_bitset_actions_reject_a_topology_from_another_grid():
    first = Sudoku(2, 2, 2, 2)
    second = Sudoku(2, 2, 2, 2)
    topology = CandidateTopology.build(first)

    for action in (locked_candidate, skyscraper, empty_rectangle):
        with pytest.raises(ValueError, match="another grid"):
            action(second, topology)
